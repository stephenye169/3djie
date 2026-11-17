/**
 * 街区众筹扩建 + 股份分红（GDD §4.3 联合投资 / §4.4 股票分红 的 MVP 落地）
 *
 * 流程：
 *   1. 店主对 tier ≥ 3 的自有黄金店铺发起众筹（目标 = 身价 × 50%，期限 24 小时）
 *   2. 任意玩家投入金币入股（10 万金币 = 1 股，按投入占目标比例持股份额）
 *   3. 众筹成功（到期满额 / 提前满额）→ 店铺等级 +1（扩建完成），租金收益的 40% 进入分红池
 *   4. 股东随时按持股比例领取分红池余额；股份不可转让（GDD §4.4：初期不做自由交易市场）
 *   5. 众筹失败（到期未达标）→ 全额退款
 *   6. 店铺被踢馆易主 → 项目解散，股东退 90% 原始投入（10% 为众筹风险折损）
 *
 * 资金守恒：入股的钱 → 成功归店主（扩建让渡 40% 租金给股东）；失败/解散退还股东。
 * 所有结算由服务端执行；每 60s 一次结算检查（到期判定 + 分红池累积）。
 */
import express from 'express';
import { query, run, deductBalance } from './db.js';
import { authMiddleware } from './auth.js';
import { settle, syncDerived, assetValue } from './economy.js';
import { broadcastBattle } from './chat.js';
import { findAsset, incomeOf, formatMoney } from '../shared/assets.js';

const router = express.Router();

export const SHARE_UNIT = 100_000;          // 10 万金币 = 1 股
export const CROWD_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CROWD_TARGET_RATIO = 0.5;      // 目标 = 店铺身价 × 50%
export const DIVIDEND_RATIO = 0.4;          // 店铺租金的 40% 进分红池
export const DISBAND_REFUND_RATIO = 0.9;    // 易主解散：股东退原始投入的 90%
const CHECK_INTERVAL_MS = 60_000;

const randomId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 发起众筹：仅店主本人，仅 tier ≥ 3 黄金店铺，同店同时只能有一个进行中项目 */
export function createProject(assetId, user) {
  const asset = findAsset(assetId);
  if (!asset) throw new CrowdError(404, '店铺不存在');
  if (asset.tier < 2) throw new CrowdError(409, '只有特色店铺及以上（tier ≥ 2）支持众筹扩建');

  const dup = query("SELECT id FROM crowd_projects WHERE shop_id = ? AND status IN ('active','funded')", [assetId])[0];
  if (dup) throw new CrowdError(409, '这家店已经有一个进行中的众筹项目');

  const shopRow = query('SELECT user_id, level FROM player_shops WHERE shop_id = ?', [assetId])[0];
  if (!shopRow) throw new CrowdError(409, '这家店还没有被玩家收购');
  if (shopRow.user_id !== user.id) throw new CrowdError(403, '只有店主本人可以发起扩建众筹');

  const value = assetValue(asset, shopRow.level);
  const target = Math.round(value * CROWD_TARGET_RATIO);
  const now = Date.now();

  const id = randomId();
  run(
    `INSERT INTO crowd_projects (id, shop_id, owner_id, target, raised, dividend_pool, last_pool_at, deadline, status, created_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, 'active', ?)`,
    [id, assetId, user.id, target, now, now + CROWD_WINDOW_MS, now]
  );
  broadcastCrowd(id, `【街区众筹】玩家【${user.nickname}】为【${asset.name}】发起扩建众筹，目标 ${formatMoney(target)}，24 小时内每股 ${formatMoney(SHARE_UNIT)} 入股！`);
  return projectPayload(id);
}

/** 入股：10 万金币 1 股的整数倍；满额自动提前成功 */
export function invest(projectId, user, amount) {
  const project = getProject(projectId, 'active');
  const asking = Math.floor(Number(amount) || 0);
  if (asking < SHARE_UNIT || asking % SHARE_UNIT !== 0) {
    throw new CrowdError(400, `入股金额必须是 ${formatMoney(SHARE_UNIT)} 的整数倍`);
  }
  if (Date.now() > project.deadline) {
    settleExpired(project);
    throw new CrowdError(409, '众筹已到期，正在结算');
  }

  settle(user.id);
  const row = query('SELECT balance FROM users WHERE id = ?', [user.id])[0];
  if (!row) throw new CrowdError(404, '用户不存在');
  if (!deductBalance(user.id, asking)) {
    const curBal = Number(row.balance || 0);
    throw new CrowdError(402, `资金不足，入股 ${formatMoney(asking)}，你还差 ${formatMoney(Math.max(0, asking - curBal))}`);
  }
  run('UPDATE crowd_projects SET raised = raised + ? WHERE id = ?', [asking, projectId]);
  run(
    `INSERT INTO crowd_shares (project_id, user_id, amount, claimed_pool, invested_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET amount = amount + excluded.amount`,
    [projectId, user.id, asking, Date.now()]
  );

  const fresh = query('SELECT raised, target, status FROM crowd_projects WHERE id = ?', [projectId])[0];
  console.log('[crowd] invest 后快照:', JSON.stringify(fresh), '触发条件:', Number(fresh.raised) >= Number(fresh.target));
  if (Number(fresh.raised) >= Number(fresh.target)) {
    settleFunded(projectId);
    console.log('[crowd] settleFunded 已执行');
  }
  return projectPayload(projectId);
}

/** 领取分红：可领 = 分红池 × 持股比例 − 已领累计 */
export function claimDividend(projectId, user) {
  const project = getProject(projectId, 'funded');
  const mine = query('SELECT amount, claimed_pool FROM crowd_shares WHERE project_id = ? AND user_id = ?', [projectId, user.id])[0];
  if (!mine) throw new CrowdError(403, '你不是这个项目的股东');

  const total = Number(query('SELECT SUM(amount) AS s FROM crowd_shares WHERE project_id = ?', [projectId])[0]?.s) || 0;
  const myShare = total > 0 ? mine.amount / total : 0;
  const claimable = Math.max(0, Math.floor(Number(project.dividend_pool) * myShare - Number(mine.claimed_pool)));
  if (claimable < 1) throw new CrowdError(409, '暂时没有可领取的分红，等店铺多收几轮租金再来');

  run('UPDATE users SET balance = balance + ? WHERE id = ?', [claimable, user.id]);
  run('UPDATE crowd_shares SET claimed_pool = claimed_pool + ? WHERE project_id = ? AND user_id = ?', [claimable, projectId, user.id]);
  return { claimable };
}

/** 每 60s：到期结算 + funded 项目的分红池累积（该店当前租金收益 × 40% × 流逝时长） */
export function tickCrowd() {
  const now = Date.now();

  // 分红池累积
  const funded = query("SELECT id, shop_id, dividend_pool, last_pool_at FROM crowd_projects WHERE status = 'funded'");
  for (const p of funded) {
    const shopRow = query('SELECT level FROM player_shops WHERE shop_id = ?', [p.shop_id])[0];
    if (!shopRow) continue;
    const asset = findAsset(p.shop_id);
    if (!asset) continue;
    const hours = Math.max(0, (now - Number(p.last_pool_at)) / 3_600_000);
    if (hours <= 0) continue;
    const poolAdd = Math.round(incomeOf(asset, Number(shopRow.level)) * 3600 * DIVIDEND_RATIO * hours);
    if (poolAdd > 0) {
      run('UPDATE crowd_projects SET dividend_pool = dividend_pool + ?, last_pool_at = ? WHERE id = ?', [poolAdd, now, p.id]);
    }
  }

  // 到期结算
  const expired = query("SELECT id FROM crowd_projects WHERE status = 'active' AND deadline <= ?", [now]);
  for (const p of expired) {
    const row = query('SELECT raised, target FROM crowd_projects WHERE id = ?', [p.id])[0];
    if (Number(row.raised) >= Number(row.target)) settleFunded(p.id);
    else settleRefunded(p.id);
  }
}

/** 众筹成功：店铺等级 +1（扩建完成）+ 状态转 funded + 众筹款归店主 */
function settleFunded(projectId) {
  const project = query('SELECT id, shop_id, owner_id, raised, status FROM crowd_projects WHERE id = ?', [projectId])[0];
  if (!project || project.status !== 'active') return;
  run("UPDATE crowd_projects SET status = 'funded', settled_at = ?, last_pool_at = ? WHERE id = ?", [Date.now(), Date.now(), projectId]);
  run('UPDATE player_shops SET level = level + 1 WHERE shop_id = ? AND user_id = ?', [project.shop_id, project.owner_id]);
  // 众筹款归店主（扩建资金）
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [Math.round(project.raised), project.owner_id]);
  syncDerivedSafe(project.owner_id);
  const asset = findAsset(project.shop_id);
  broadcastCrowd(projectId, `【众筹成功】玩家【${ownerNick(project.owner_id)}】的【${asset?.name || project.shop_id}】扩建众筹达成，店铺升级 +1！租金收益的 40% 将按股份比例分给全体股东。`);
}

/** 众筹失败：全额退款 */
function settleRefunded(projectId) {
  const project = query('SELECT id, shop_id, owner_id, status FROM crowd_projects WHERE id = ?', [projectId])[0];
  if (!project || project.status !== 'active') return;
  refundAll(projectId, 1.0);
  run("UPDATE crowd_projects SET status = 'refunded', settled_at = ? WHERE id = ?", [Date.now(), projectId]);
  const asset = findAsset(project.shop_id);
  broadcastCrowd(projectId, `【众筹未达】【${asset?.name || project.shop_id}】的扩建众筹到期未达标，全部认缴资金已原路退还。`);
}

/** 店铺被踢馆易主：解散该项目，股东退 90% 原始投入（10% 众筹风险折损） */
export function disbandByShop(shopId) {
  const project = query("SELECT id, status FROM crowd_projects WHERE shop_id = ? AND status IN ('active','funded')", [shopId])[0];
  if (!project) return;
  refundAll(project.id, project.status === 'active' ? 1.0 : DISBAND_REFUND_RATIO);
  run("UPDATE crowd_projects SET status = 'disbanded', settled_at = ? WHERE id = ?", [Date.now(), project.id]);
  const asset = findAsset(shopId);
  broadcastCrowd(project.id, `【众筹解散】店铺【${asset?.name || shopId}】易主，扩建项目解散，股东按规则退款。`);
}

// ============ 内部工具 ============

class CrowdError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function getProject(projectId, status) {
  const p = query('SELECT * FROM crowd_projects WHERE id = ?', [projectId])[0];
  if (!p || p.status !== status) throw new CrowdError(409, '项目不存在或状态不符');
  return p;
}

function refundAll(projectId, ratio) {
  const shares = query('SELECT user_id, amount FROM crowd_shares WHERE project_id = ?', [projectId]);
  for (const s of shares) {
    const refund = Math.round(Number(s.amount) * ratio);
    if (refund > 0) run('UPDATE users SET balance = balance + ? WHERE id = ?', [refund, s.user_id]);
  }
}

function ownerNick(userId) {
  return query('SELECT nickname FROM users WHERE id = ?', [userId])[0]?.nickname || '店主';
}

function broadcastCrowd(projectId, content) {
  try {
    broadcastBattle({ id: randomId(), nickname: '街区众筹', content, ts: Date.now() });
  } catch { /* 战报失败不影响结算 */ }
}

function syncDerivedSafe(userId) {
  try {
    syncDerived(userId);
  } catch { /* 收益重算失败由下次 settle 兜底 */ }
}

function projectPayload(projectId) {
  const p = query('SELECT * FROM crowd_projects WHERE id = ?', [projectId])[0];
  const total = Number(query('SELECT SUM(amount) AS s FROM crowd_shares WHERE project_id = ?', [projectId])[0]?.s) || 0;
  const mine = query('SELECT amount FROM crowd_shares WHERE project_id = ? AND user_id = ?', [projectId, p.owner_id])[0];
  return { ...p, totalRaised: total, myAmount: Number(mine?.amount) || 0 };
}

// ============ 路由 ============

router.post('/create', authMiddleware, (req, res) => {
  try {
    res.json(createProject(String(req.body?.assetId), req.user));
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

router.post('/invest', authMiddleware, (req, res) => {
  try {
    res.json(invest(String(req.body?.projectId), req.user, req.body?.amount));
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

router.post('/claim', authMiddleware, (req, res) => {
  try {
    res.json(claimDividend(String(req.body?.projectId), req.user));
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message });
  }
});

/** 项目列表 + 我的股份（面板主数据源） */
router.get('/list', authMiddleware, (req, res) => {
  const projects = query('SELECT * FROM crowd_projects ORDER BY created_at DESC').map((p) => {
    const total = Number(query('SELECT SUM(amount) AS s FROM crowd_shares WHERE project_id = ?', [p.id])[0]?.s) || 0;
    const mine = query('SELECT amount, claimed_pool FROM crowd_shares WHERE project_id = ? AND user_id = ?', [p.id, req.user.id])[0];
    const asset = findAsset(p.shop_id);
    const shopRow = query('SELECT level FROM player_shops WHERE shop_id = ?', [p.shop_id])[0];
    const myShare = total > 0 && mine ? mine.amount / total : 0;
    return {
      ...p,
      shopName: asset?.name || p.shop_id,
      shopEmoji: asset?.emoji || '🏪',
      shopTier: asset?.tier,
      level: shopRow?.level ?? 0,
      totalRaised: total,
      myAmount: Number(mine?.amount) || 0,
      dividendClaimable: p.status === 'funded'
        ? Math.max(0, Math.floor(Number(p.dividend_pool) * myShare - Number(mine?.claimed_pool || 0)))
        : 0,
    };
  });
  res.json({ projects, shareUnit: SHARE_UNIT });
});

// 启动结算检查器
setInterval(() => { try { tickCrowd(); } catch (err) { console.warn('[crowd] 结算检查异常:', err.message); } }, CHECK_INTERVAL_MS);

export default router;
