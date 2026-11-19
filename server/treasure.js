/**
 * 街头经济闭环（后端定价，前端只负责表现）
 *
 *   POST /api/game/collect    金币雨 / 财阀金币箱拾取（服务端定价 + 防刷冷却）
 *   POST /api/game/bully      碰瓷 NPC 打脸彩蛋（每人每个 NPC 独立冷却）
 *   POST /api/game/dividend   家族分红一键领取（按持有资产离线累积）
 *
 * 前端不会拿到任何可篡改的奖励数值：金额全部在服务端生成。
 */
import express from 'express';
import { query, run, randomId } from './db.js';
import { authMiddleware } from './auth.js';
import { settle, activeBuffs } from './economy.js';
import { broadcastBattle } from './chat.js';
import { formatMoney, shopFlowTierFor, BUFF_TYPES, STAMINA_PICK_MIN } from '../shared/assets.js';
import {
  talentLevelOf, goldHandCritRate, goldHandCritReward, idleRentFactor,
} from '../shared/prestige.js';
import { findTauntNpc } from '../shared/tauntNpcs.js';
import { questProgress as quest, QUEST_COIN_BOX, QUEST_BULLY } from './quests.js';

const router = express.Router();

const COIN_GAP_MS = 450;          // 普通金币最短拾取间隔（防连点刷钱）
const BOX_GAP_MS = 45_000;        // 财阀金币箱冷却
const NPC_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const DIVIDEND_REAL_CAP_MS = 24 * 60 * 60 * 1000;   // 真实离线上限 24h（衰减曲线封顶 12h 等效）
const DIVIDEND_BASE_PER_HOUR = 60_000;
/** 连锁经营：每多持有 1 家店，家族分红速率 +10% */
const DIVIDEND_SYNERGY_PER_SHOP = 0.1;
const DIVIDEND_PER_SHOP_PER_HOUR = 120_000;

/**
 * 衰减曲线：前 8h 100%，8–24h 线性衰减到"每多挂 1h 等效 0.25h"（即衰减至 25%），
 *          24h+ 封顶 12h 等效（比纯线性封顶 10h 多 2h，略给甜头激励挂机）。
 *
 *   有效收益（等效小时）
 *   12h ──────────── ──────────── ──────────── 封顶
 *     |          ╱
 *     |        ╱  ← 8–24h 线性衰减（边际从 1.0 降到 0.25）
 *     |      ╱
 *     |    ╱  ← 0–8h 原价
 *     |  ╱
 *     |╱
 *     ├──────────────────────────────────────────────→ 真实离线时长
 *    0h     8h                 24h
 */
export function effectiveHours(elapsedMs) {
  const h = elapsedMs / 3_600_000;
  if (h <= 8) return h;
  if (h >= 24) return 12;
  // 8–24h 线性：每真实 h 增加 0.25 等效 h
  const extra = (h - 8) * 0.25;
  return Math.min(12, 8 + extra);
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function balanceOf(userId) {
  return Math.floor(Number(query('SELECT balance FROM users WHERE id = ?', [userId])[0]?.balance) || 0);
}

/** 读某玩家的天赋等级表（talents_json -> {}） */
function talentsOf(userId) {
  const row = query('SELECT talents_json FROM users WHERE id = ?', [userId])[0];
  try { return JSON.parse(row?.talents_json || '{}'); } catch { return {}; }
}

/** 家族分红当前可领金额（带衰减曲线：前 8h 100%，8–24h 衰减，封顶 12h 等效） */
export function dividendStatus(userId) {
  const row = query(
    'SELECT last_dividend_at, created_at FROM users WHERE id = ?',
    [userId]
  )[0];
  if (!row) return { pending: 0, ratePerHour: 0, capHours: 12, seconds: 0, effectiveHours: 0 };

  const owned = Number(query(
    'SELECT COUNT(*) AS c FROM player_shops WHERE user_id = ?',
    [userId]
  )[0]?.c) || 0;

  const now = Date.now();
  const last = Number(row.last_dividend_at) > 0
    ? Number(row.last_dividend_at)
    : Number(row.created_at) || now;
  const realElapsed = Math.max(0, Math.min(now - last, DIVIDEND_REAL_CAP_MS));
  const effH = effectiveHours(realElapsed);
  const baseRate = DIVIDEND_BASE_PER_HOUR + owned * DIVIDEND_PER_SHOP_PER_HOUR;
  // 连锁经营 synergy：每多一家店，整体分红速率 +10%（与躺平收租天赋乘算）
  const synergyFactor = 1 + owned * DIVIDEND_SYNERGY_PER_SHOP;
  const ratePerHour = Math.round(
    baseRate * idleRentFactor(talentLevelOf(talentsOf(userId), 'idleRent')) * synergyFactor
  );

  return {
    pending: Math.floor(ratePerHour * effH),
    ratePerHour,
    capHours: 12,
    seconds: Math.floor(realElapsed / 1000),
    effectiveHours: Math.round(effH * 100) / 100,
    owned,
    synergyPct: Math.round((synergyFactor - 1) * 100),
  };
}

/** 拾取金币 / 金币箱 / 客源金币 */
router.post('/collect', authMiddleware, (req, res) => {
  const rawType = String(req.body?.type || 'coin');
  const type = rawType === 'box' ? 'box' : rawType === 'shopflow' ? 'shopflow' : 'coin';
  const shopId = type === 'shopflow' ? String(req.body?.shopId || '') : '';
  settle(req.user.id);

  const row = query(
    'SELECT balance, last_coin_at, last_box_at, stamina FROM users WHERE id = ?',
    [req.user.id]
  )[0];
  if (!row) return res.status(404).json({ error: '用户不存在' });

  // 体能门槛：低体能状态无法拾取任何金币——先去店里买点吃的补充能量
  const stamina = Number(row.stamina) || 0;
  if (stamina < STAMINA_PICK_MIN) {
    return res.status(409).json({
      error: `体能不足（${Math.floor(stamina)}），弯腰捡不动金币——去店里买点吃的补充能量`,
      stamina: Math.floor(stamina),
    });
  }

  const now = Date.now();
  const last = Number(type === 'box' ? row.last_box_at : row.last_coin_at) || 0;
  // 客源金币复用普通金币的冷却列：拾取节奏与金币雨一致，防止连点扫街
  const gap = type === 'box' ? BOX_GAP_MS : COIN_GAP_MS;
  if (now - last < gap) {
    return res.status(429).json({
      error: type === 'box' ? '这条街的金币箱刚被扫空，等一会儿再来' : '手速太快了，慢一点',
      retryMs: gap - (now - last),
    });
  }

  let reward;
  let crit = false;
  let royalty = 0;
  let royaltyTo = null;
  let flowIndex = -1;
  const buffs = activeBuffs(req.user.id);
  if (type === 'shopflow') {
    // 客源金币：店铺流水达档后门口刷新，拾取者拿全额，店铺收购人按档位分成
    const shop = query('SELECT flow_total FROM shops WHERE id = ?', [shopId])[0];
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    const t = shopFlowTierFor(shopId, shop.flow_total);
    if (t.index < 0) return res.status(409).json({ error: '这家店还没攒够客流，暂无客源金币' });
    flowIndex = t.index;
    reward = randomInt(20_000, 80_000) * (t.index + 1);
    if (buffs.coinUp) reward = Math.round(reward * BUFF_TYPES.coinUp.mult);
    const ownerRow = query('SELECT user_id FROM player_shops WHERE shop_id = ? LIMIT 1', [shopId])[0];
    if (ownerRow && ownerRow.user_id && ownerRow.user_id !== req.user.id) {
      royalty = Math.floor(reward * t.share);
      royaltyTo = ownerRow.user_id;
    }
  } else if (type === 'box') {
    reward = randomInt(800_000, 2_000_000);
    if (buffs.coinUp) reward = Math.round(reward * BUFF_TYPES.coinUp.mult);
  } else {
    // 点金手天赋：暴击率与暴击金额随等级提升；财运暴击 buff 提升暴击率
    const goldLv = talentLevelOf(talentsOf(req.user.id), 'goldHand');
    const critBonus = buffs.crit ? BUFF_TYPES.crit.mult : 0;
    crit = Math.random() < goldHandCritRate(goldLv) + critBonus;
    reward = crit ? goldHandCritReward(goldLv) : randomInt(20_000, 80_000);
    if (buffs.coinUp) reward = Math.round(reward * BUFF_TYPES.coinUp.mult);
  }

  const col = type === 'box' ? 'last_box_at' : 'last_coin_at';
  run(
    `UPDATE users SET balance = balance + ?, ${col} = ? WHERE id = ?`,
    [reward, now, req.user.id]
  );

  // 店主分成实时入账
  if (royalty > 0 && royaltyTo) {
    run(
      'UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?',
      [royalty, royalty, royaltyTo]
    );
  }

  // 大额和金币箱上全服战报，制造「别人在爆金币」的围观感
  if (type === 'box' || crit) {
    const label = type === 'box' ? '财阀金币箱' : '金币雨暴击';
    broadcastBattle({
      id: `${req.user.id}-${now}`,
      nickname: '街头爆料',
      content: `【街头爆金币】玩家【${req.user.nickname}】在青果巷捡到${label}，${formatMoney(reward)} 当场到账！`,
      ts: now,
    });
  }
  if (type === 'box') quest(req.user.id, QUEST_COIN_BOX, 1);

  res.json({
    ok: true, type, reward, crit, balance: balanceOf(req.user.id),
    shopId: type === 'shopflow' ? shopId : undefined,
    flowIndex: type === 'shopflow' ? flowIndex : undefined,
    royalty: type === 'shopflow' ? royalty : undefined,
  });
});

/** 碰瓷 NPC：打脸成功后爆金币 */
router.post('/bully', authMiddleware, (req, res) => {
  const npc = findTauntNpc(String(req.body?.npcId || ''));
  if (!npc) return res.status(404).json({ error: '这个人已经跑了' });

  settle(req.user.id);

  const now = Date.now();
  const claim = query(
    'SELECT claimed_at FROM npc_claims WHERE user_id = ? AND npc_id = ?',
    [req.user.id, npc.id]
  )[0];
  if (claim && now - Number(claim.claimed_at) < NPC_COOLDOWN_MS) {
    const wait = Math.ceil((NPC_COOLDOWN_MS - (now - claim.claimed_at)) / 60000);
    return res.status(429).json({ error: `他已经被你打脸过了，${wait} 分钟后再来碰瓷` });
  }

  run(
    'INSERT OR REPLACE INTO npc_claims (user_id, npc_id, claimed_at) VALUES (?, ?, ?)',
    [req.user.id, npc.id, now]
  );
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [npc.reward, req.user.id]);

  // 打脸彩蛋赠礼：送一张当日有效的 9 折优惠券（店内购物自动抵扣）
  const dayEnd = new Date(); dayEnd.setHours(24, 0, 0, 0);
  const couponId = randomId();
  run(
    'INSERT INTO coupons (id, user_id, discount, expires_at) VALUES (?, ?, ?, ?)',
    [couponId, req.user.id, 0.9, dayEnd.getTime()]
  );

  broadcastBattle({
    id: `${req.user.id}-${now}`,
    nickname: '打脸名场面',
    content: `【打脸名场面】玩家【${req.user.nickname}】在${npc.place}用钞能力当场羞辱${npc.name}，${formatMoney(npc.reward)} 秒到账！`,
    ts: now,
  });
  quest(req.user.id, QUEST_BULLY, 1);

  res.json({
    ok: true,
    reward: npc.reward,
    text: npc.success,
    couponGranted: true,
    balance: balanceOf(req.user.id),
    nextAt: now + NPC_COOLDOWN_MS,
  });
});

/** 家族分红一键领取 */
router.post('/dividend', authMiddleware, (req, res) => {
  settle(req.user.id);
  const status = dividendStatus(req.user.id);
  if (status.pending < 1) {
    return res.status(409).json({ error: '分红还在累积，再挂一会儿吧' });
  }

  const now = Date.now();
  run(
    'UPDATE users SET balance = balance + ?, last_dividend_at = ? WHERE id = ?',
    [status.pending, now, req.user.id]
  );

  res.json({
    ok: true,
    reward: status.pending,
    seconds: status.seconds,
    balance: balanceOf(req.user.id),
  });
});

export default router;
