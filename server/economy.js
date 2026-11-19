/**
 * 经济数值公共层：持有查询、收租结算、冗余字段同步
 * game.js 与 capital.js 共用，避免循环依赖
 */
import { query, run } from './db.js';
import { OFFLINE_CAP_MS, findAsset, incomeOf, titleFor, BUFF_TYPES } from '../shared/assets.js';

/** 该玩家已收购的店铺 */
export function listOwned(userId) {
  return query(
    'SELECT shop_id, user_id, level, acquired_at FROM player_shops WHERE user_id = ? ORDER BY acquired_at',
    [userId]
  );
}

/** 活跃 buff：读取 buffs_json 过滤过期，按类型取最晚到期（game.js / treasure.js / economy.js 共用）
 *  返回 {type: until 绝对到期时间戳}——只做存在性/时效判断 */
export function activeBuffs(userId) {
  const row = query('SELECT buffs_json FROM users WHERE id = ?', [userId])[0];
  let raw = {};
  try { raw = JSON.parse(row?.buffs_json || '{}'); } catch { raw = {}; }
  const now = Date.now();
  const out = {};
  for (const [type, v] of Object.entries(raw)) {
    const until = typeof v === 'object' && v ? Number(v.until) : Number(v);
    if (until > now) out[type] = until;
  }
  return out;
}

/** 活跃 buff 详情：{type: {until, total 总时长 ms}}——供前端进度条渲染；旧格式 total = null */
export function activeBuffDetails(userId) {
  const row = query('SELECT buffs_json FROM users WHERE id = ?', [userId])[0];
  let raw = {};
  try { raw = JSON.parse(row?.buffs_json || '{}'); } catch { raw = {}; }
  const now = Date.now();
  const out = {};
  for (const [type, v] of Object.entries(raw)) {
    if (typeof v === 'object' && v) {
      const until = Number(v.until);
      if (until > now) out[type] = { until, total: Number(v.total) || null };
    } else {
      const until = Number(v);
      if (until > now) out[type] = { until, total: null }; // 旧格式无总时长，前端降级纯秒数
    }
  }
  return out;
}

/** 由持有列表算总每秒收益 */
export function totalIncome(owned) {
  return owned.reduce((sum, s) => {
    const asset = findAsset(s.shop_id);
    return asset ? sum + incomeOf(asset, s.level) : sum;
  }, 0);
}

/** 资产当前身价：基础价 × 1.5^(装修等级-1) */
export function assetValue(asset, level = 1) {
  return Math.round(asset.price * Math.pow(1.5, Math.max(0, level - 1)));
}

/** 惰性结算：把上次结算到现在的租金一次性发放（日进斗金 buff 期间收益 ×1.25） */
export function settle(userId) {
  const row = query('SELECT balance, income_per_sec, total_earned, last_tick FROM users WHERE id = ?', [userId])[0];
  if (!row) return { seconds: 0, earnings: 0 };

  const now = Date.now();
  const last = Number(row.last_tick) > 0 ? Number(row.last_tick) : now;
  const elapsed = Math.max(0, Math.min(now - last, OFFLINE_CAP_MS));
  let rate = Number(row.income_per_sec) || 0;
  const buffs = activeBuffs(userId);
  if (buffs.income) rate = Math.round(rate * BUFF_TYPES.income.mult);
  const earnings = Math.round(rate * elapsed / 1000);

  if (earnings > 0) {
    run(
      'UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, last_tick = ? WHERE id = ?',
      [earnings, earnings, now, userId]
    );
  } else {
    run('UPDATE users SET last_tick = ? WHERE id = ?', [now, userId]);
  }
  return { seconds: Math.floor(elapsed / 1000), earnings };
}

/** 重算冗余字段（收入 / 称号），有变化才写盘 */
export function syncDerived(userId, owned = listOwned(userId)) {
  const income = totalIncome(owned);
  const title = titleFor(owned.length);
  const current = query('SELECT income_per_sec, title, balance, rebirth_count FROM users WHERE id = ?', [userId])[0];
  if (!current) return { income, title };
  if (Number(current.income_per_sec) !== income || current.title !== title) {
    run('UPDATE users SET income_per_sec = ?, title = ?, last_tick = ? WHERE id = ?',
      [income, title, Date.now(), userId]);
  }
  checkAssetMilestone(userId, owned, Number(current.balance) || 0);
  return { income, title };
}

/**
 * 资产里程碑全服通告（GDD §5.4）：总资产（店铺身价合计 + 现金）突破档位时全服战报。
 * 已达最高档记录在 quest_progress（quest_id = 'milestone'），跨档才广播，不重复。
 */
const ASSET_MILESTONES = [
  { v: 1e8, label: '1 亿' },
  { v: 1e9, label: '10 亿' },
  { v: 1e10, label: '100 亿' },
  { v: 1e11, label: '1000 亿' },
  { v: 5e11, label: '5000 亿' },
];

async function checkAssetMilestone(userId, owned, balance) {
  try {
    const total = owned.reduce((sum, s) => {
      const asset = findAsset(s.shop_id);
      return asset ? sum + assetValue(asset, s.level) : sum;
    }, 0) + balance;

    let reached = -1;
    for (let i = 0; i < ASSET_MILESTONES.length; i++) {
      if (total >= ASSET_MILESTONES[i].v) reached = i;
    }
    if (reached < 0) return;

    const row = query("SELECT progress FROM quest_progress WHERE user_id = ? AND quest_id = 'milestone'", [userId])[0];
    const prev = Number(row?.progress) ?? -1;
    if (reached <= prev) return; // 未跨新档

    // 新档：记录 + 全服战报（动态 import chat 避免 economy↔chat 循环依赖）
    if (row) run("UPDATE quest_progress SET progress = ? WHERE user_id = ? AND quest_id = 'milestone'", [reached, userId]);
    else run("INSERT INTO quest_progress (user_id, quest_id, progress, claimed) VALUES (?, 'milestone', ?, 0)", [userId, reached]);

    const nick = query('SELECT nickname FROM users WHERE id = ?', [userId])[0]?.nickname || '神秘富豪';
    const { broadcastBattle } = await import('./chat.js');
    broadcastBattle({
      id: `ms${userId}-${reached}-${Date.now()}`,
      nickname: '资产里程碑',
      content: `【身价里程碑】玩家【${nick}】总资产突破 ${ASSET_MILESTONES[reached].label}，街区格局再变！`,
      ts: Date.now(),
    });
  } catch (err) {
    console.warn('[economy] 里程碑检查异常:', err.message);
  }
}
