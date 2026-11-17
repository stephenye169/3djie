/**
 * 资本踢馆（PvP 争夺商铺）
 *
 * 规则：
 * - 攻击方出价 = 当前资产身价 × 1.5，创建时立即扣款（托管）
 * - 原店主有 15 秒窗口「强力护盘」，护盘价 = 攻击方出价 × 1.5
 * - 护盘成功：店铺保留，攻击方资金作为赔偿转给原店主
 * - 护盘失败/认栽/超时：店铺易主，攻击方出价不予退还
 * - 同一店铺同时只允许一场踢馆；结算后该店铺进入 5 分钟冷却
 */
import { query, run, randomId, deductBalance } from './db.js';
import { settle, syncDerived, assetValue } from './economy.js';
import { findAsset, assetValueOf, formatMoney } from '../shared/assets.js';
import { sendToUser, broadcastBattle } from './chat.js';
import { disbandByShop } from './crowd.js';
import { questProgress as quest } from './quests.js';
import {
  QUEST_DEFEND, QUEST_CAPTURE,
} from './quests.js';

export const ATTACK_WINDOW_MS = 15_000;
const ATTACK_MULTIPLIER = 1.5;
const DEFEND_MULTIPLIER = 1.5;
const COOLDOWN_MS = 5 * 60 * 1000;

/** attackId -> attack（进行中的踢馆） */
const pending = new Map();

/** 返回店铺冷却剩余毫秒（0 表示可攻），从 SQLite 读。
 * 到期的记录顺手 DELETE，避免 shop_cooldowns 无限堆积。 */
function shopCooldownUntil(shopId) {
  const row = query('SELECT cool_until FROM shop_cooldowns WHERE shop_id = ?', [shopId])[0];
  const until = Number(row?.cool_until) || 0;
  if (!until) return 0;
  const now = Date.now();
  if (now >= until) {
    run('DELETE FROM shop_cooldowns WHERE shop_id = ? AND cool_until <= ?', [shopId, now]);
    return 0;
  }
  return until;
}

/** 批量查一批 shopId 的剩余冷却毫秒。state 接口给前端用 */
export function shopCooldowns(shopIds) {
  if (!shopIds?.length) return new Map();
  const rows = query('SELECT shop_id, cool_until FROM shop_cooldowns WHERE shop_id IN ('
    + shopIds.map(() => '?').join(',') + ')', shopIds);
  const now = Date.now();
  const out = new Map();
  for (const row of rows) {
    const until = Number(row.cool_until);
    if (now < until) out.set(row.shop_id, until - now);
  }
  // 顺便清理全部已过期记录
  try { run('DELETE FROM shop_cooldowns WHERE cool_until <= ?', [now]); } catch { /* 忽略 */ }
  return out;
}

function setShopCooldown(shopId, until) {
  run(
    `INSERT INTO shop_cooldowns (shop_id, cool_until) VALUES (?, ?)
     ON CONFLICT(shop_id) DO UPDATE SET cool_until = excluded.cool_until`,
    [shopId, until]
  );
}

class CapitalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ownerOf(shopId) {
  return query(
    `SELECT ps.user_id AS userId, ps.level, u.nickname
     FROM player_shops ps JOIN users u ON u.id = ps.user_id
     WHERE ps.shop_id = ?`,
    [shopId]
  )[0] || null;
}

/**
 * 普通店铺（tier 1）易主后的保护期：几个小时就够——
 * 玩家不会全天守店，游戏是娱乐，不需要 7 天这么长的保护。
 */
export const TIER1_PROTECT_HOURS = 4;
export const TIER1_PROTECT_MS = TIER1_PROTECT_HOURS * 60 * 60 * 1000;

/**
 * 普通店铺保护期：店铺易主后 N 小时内不可被踢馆（按店铺计，不按账号）。
 * 收购和踢馆易主都会写入 acquired_at，两种来源都享有短暂保护。
 */
export function tier1Protection(shopId) {
  const row = query('SELECT acquired_at FROM player_shops WHERE shop_id = ?', [shopId])[0];
  if (!row) return { protected: false, hoursLeft: 0 };
  const left = TIER1_PROTECT_MS - (Date.now() - Number(row.acquired_at || 0));
  return left > 0
    ? { protected: true, hoursLeft: Math.ceil(left / 3_600_000) }
    : { protected: false, hoursLeft: 0 };
}

/**
 * 新手安全期：注册 4 小时内 或 总资产（现金 + 店铺身价）≤ 1000 万的玩家，
 * 名下普通店铺（tier 1）免疫被踢馆，避免老玩家开小号收割新人。
 * 两个条件是「或」：任一成立即受保护；卖出店铺/花掉现金都不影响注册时长这一条。
 */
export const NEWBIE_AGE_MS = 4 * 60 * 60 * 1000;
export const NEWBIE_ASSET_CAP = 10_000_000;

export function isNewPlayer(userId) {
  const row = query('SELECT created_at, balance FROM users WHERE id = ?', [userId])[0];
  if (!row) return { isNew: false, reason: null, hoursLeft: 0 };

  const ageMs = Date.now() - Number(row.created_at || 0);
  if (ageMs >= 0 && ageMs < NEWBIE_AGE_MS) {
    return { isNew: true, reason: 'register', hoursLeft: Math.ceil((NEWBIE_AGE_MS - ageMs) / 3_600_000) };
  }

  const shops = query('SELECT shop_id AS shopId, level FROM player_shops WHERE user_id = ?', [userId]);
  let total = Number(row.balance || 0);
  for (const s of shops) {
    const asset = findAsset(s.shopId);
    if (asset) total += assetValue(asset, s.level);
  }
  if (total <= NEWBIE_ASSET_CAP) {
    return { isNew: true, reason: 'assets', hoursLeft: 0 };
  }
  return { isNew: false, reason: null, hoursLeft: 0 };
}

/** 启动时把上次进程残留的进行中记录标记过期，并清理所有已到期的冷却记录 */
export function initCapital() {
  try {
    run("UPDATE shop_attacks SET status = 'expired', resolved_at = ? WHERE status = 'pending'", [Date.now()]);
  } catch (err) {
    console.warn('[capital] 清理残留踢馆失败:', err.message);
  }
  try {
    run('DELETE FROM shop_cooldowns WHERE cool_until <= ?', [Date.now()]);
  } catch (err) {
    console.warn('[capital] 清理过期冷却失败:', err.message);
  }
}

/** 当前正在进行的踢馆（按店铺或按防守者） */
export function pendingForShop(shopId) {
  for (const attack of pending.values()) {
    if (attack.shopId === shopId) return attack;
  }
  return null;
}

export function incomingAttack(userId) {
  for (const attack of pending.values()) {
    if (attack.defenderId === userId) return attack;
  }
  return null;
}

function toPayload(attack) {
  return {
    attackId: attack.id,
    shopId: attack.shopId,
    shopName: attack.shopName,
    attackerId: attack.attackerId,
    attackerNick: attack.attackerNick,
    defenderId: attack.defenderId,
    defenderNick: attack.defenderNick,
    bid: attack.bid,
    defendCost: attack.defendCost,
    penalty: attack.penalty || 0,
    settledPrice: attack.settledPrice ?? attack.bid,
    expiresAt: attack.expiresAt,
    ...counterRangeOf(attack),
    counterActive: !!attack.counter,
  };
}

/** 发起踢馆 */
export function createAttack(attacker, assetId) {
  const asset = findAsset(assetId);
  if (!asset) throw new CapitalError(404, '资产不存在');

  const owner = ownerOf(assetId);
  if (!owner) throw new CapitalError(409, '这家店还没有被玩家收购，直接收购即可');
  if (owner.userId === attacker.id) throw new CapitalError(409, '这是你自己的店');

  if (pendingForShop(assetId)) throw new CapitalError(409, '这家店正在被踢馆，等这场结束再来');

  const waitUntil = shopCooldownUntil(assetId);
  if (waitUntil) {
    const wait = Math.ceil((waitUntil - Date.now()) / 1000);
    throw new CapitalError(409, `这条街刚打完一场，${wait} 秒后再来`);
  }

  // 普通店铺保护：刚易主 4 小时内，或店主人人处于新手安全期（注册 4h 内 / 总资产 ≤1000 万）
  if (asset.tier === 1) {
    const guard = tier1Protection(assetId);
    if (guard.protected) {
      throw new CapitalError(409, `🛡 这家普通店铺刚易主，还在保护期内（约剩 ${guard.hoursLeft} 小时），暂不可踢馆`);
    }
    const newbie = isNewPlayer(owner.userId);
    if (newbie.isNew) {
      const why = newbie.reason === 'register'
        ? `对方注册不足 4 小时（还剩约 ${newbie.hoursLeft} 小时）`
        : '对方总资产不足 1000 万';
      throw new CapitalError(409, `🛡 这家普通店铺受新手保护：${why}，暂不可踢馆`);
    }
  }

  const value = assetValue(asset, owner.level);
  const bid = Math.round(value * ATTACK_MULTIPLIER);
  const defendCost = Math.round(bid * DEFEND_MULTIPLIER);

  settle(attacker.id);
  const row = query('SELECT balance, nickname FROM users WHERE id = ?', [attacker.id])[0];
  if (!row) throw new CapitalError(404, '用户不存在');
  if (!deductBalance(attacker.id, bid)) {
    const curBal = Number(row.balance || 0);
    throw new CapitalError(402, `资金不足，踢馆需要 ${formatMoney(bid)}，你还差 ${formatMoney(Math.max(0, bid - curBal))}`);
  }

  const now = Date.now();
  const attack = {
    id: randomId(),
    shopId: assetId,
    shopName: asset.name,
    attackerId: attacker.id,
    attackerNick: row.nickname,
    defenderId: owner.userId,
    defenderNick: owner.nickname,
    level: owner.level,
    bid,
    defendCost,
    createdAt: now,
    expiresAt: now + ATTACK_WINDOW_MS,
    timer: null,
  };

  run(
    `INSERT INTO shop_attacks
       (id, shop_id, attacker_id, defender_id, bid, defend_cost, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [attack.id, assetId, attack.attackerId, attack.defenderId, bid, defendCost, now, attack.expiresAt]
  );

  pending.set(attack.id, attack);
  attack.timer = setTimeout(() => resolveCapture(attack.id, 'timeout'), ATTACK_WINDOW_MS);

  sendToUser(attack.defenderId, { type: 'shop_attack', payload: toPayload(attack) });
  return toPayload(attack);
}

/** 原店主护盘 */
export function defend(attackId, user) {
  const attack = pending.get(attackId);
  if (!attack) throw new CapitalError(409, '这场踢馆已经结束了');
  if (attack.defenderId !== user.id) throw new CapitalError(403, '这不是你的资产');

  if (Date.now() >= attack.expiresAt) {
    resolveCapture(attackId, 'timeout');
    throw new CapitalError(409, '护盘超时，店铺已经易主');
  }

  settle(user.id);
  const row = query('SELECT balance FROM users WHERE id = ?', [user.id])[0];
  if (!row) throw new CapitalError(404, '用户不存在');
  if (!deductBalance(user.id, attack.defendCost)) {
    const curBal = Number(row.balance || 0);
    throw new CapitalError(
      402,
      `护盘需要 ${formatMoney(attack.defendCost)}，你还差 ${formatMoney(Math.max(0, attack.defendCost - curBal))}`
    );
  }
  // 攻击方的托管资金作为赔偿转给原店主
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [attack.bid, user.id]);

  clearTimeout(attack.timer);
  pending.delete(attack.id);
  setShopCooldown(attack.shopId, Date.now() + COOLDOWN_MS);

  run("UPDATE shop_attacks SET status = 'defended', resolved_at = ? WHERE id = ?", [Date.now(), attack.id]);

  quest(attack.defenderId, QUEST_DEFEND, 1);

  const message = `【资本对决】玩家【${attack.defenderNick}】怒掷 ${formatMoney(attack.defendCost)} 强力护盘，当场把【${attack.attackerNick}】的恶意收购打回原形！`;
  finish(attack, 'defended', message);
  return { status: 'defended', message, bid: attack.bid };
}

/** 原店主认栽：直接判负 */
export function surrender(attackId, user) {
  const attack = pending.get(attackId);
  if (!attack) throw new CapitalError(409, '这场踢馆已经结束了');
  if (attack.defenderId !== user.id) throw new CapitalError(403, '这不是你的资产');
  resolveCapture(attackId, 'surrendered');
  return { status: 'captured' };
}

/** 攻击方成功截胡（含原店主认栽 / 离线超时 / 还价成交三种） */
function resolveCapture(attackId, reason, settlePrice = null) {
  const attack = pending.get(attackId);
  if (!attack) return;

  const amount = Math.round(settlePrice ?? attack.bid);
  attack.settledPrice = amount; // 下发 shop_attack_result 时前端展示实际成交价

  clearTimeout(attack.timer);
  pending.delete(attackId);
  setShopCooldown(attack.shopId, Date.now() + COOLDOWN_MS);

  // 店铺易主：先删原店主记录，再写入攻击方
  run('DELETE FROM player_shops WHERE user_id = ? AND shop_id = ?', [attack.defenderId, attack.shopId]);
  run(
    'INSERT OR REPLACE INTO player_shops (user_id, shop_id, level, acquired_at) VALUES (?, ?, ?, ?)',
    [attack.attackerId, attack.shopId, attack.level, Date.now()]
  );

  run("UPDATE shop_attacks SET status = 'captured', resolved_at = ? WHERE id = ?", [Date.now(), attackId]);

  // 店铺易主：进行中的众筹项目解散，股东按规则退款（众筹风险折损）
  try { disbandByShop(attack.shopId); } catch (err) { console.warn('[capital] 众筹解散失败:', err.message); }

  // 收购成交：成交价全额打入原店主账户。
  // 离线被收购 = 按系统价强制变现，不倒赔违约金——店铺是资产，成交即钱货两讫。
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, attack.defenderId]);

  syncDerived(attack.defenderId);
  syncDerived(attack.attackerId);

  quest(attack.attackerId, QUEST_CAPTURE, 1);

  const fineText = reason === 'surrendered'
    ? `【${attack.defenderNick}】主动接受报价，${formatMoney(amount)} 收购款已入账`
    : reason === 'countered'
      ? `【${attack.defenderNick}】还价 ${formatMoney(amount)}，【${attack.attackerNick}】爽快应价——收购款已入账`
      : `【${attack.defenderNick}】当前离线，店铺按 ${formatMoney(amount)} 强制成交，收购款已入其账户（上线即可见）`;
  const message = `【全服通告】玩家【${attack.attackerNick}】出资 ${formatMoney(amount)} 强行收购了【${attack.shopName}】——${fineText}！`;
  finish(attack, 'captured', message);
}

// ============ 在线议价收购（README §12）============

/** 还价幅度：1.2–2.0 倍系统出价，每场一次，由服务端强制约束 */
export const COUNTER_MIN_RATIO = 1.2;
export const COUNTER_MAX_RATIO = 2.0;

/** 还价区间（下发前端做滑条范围） */
function counterRangeOf(attack) {
  return {
    counterMin: Math.round(attack.bid * COUNTER_MIN_RATIO),
    counterMax: Math.round(attack.bid * COUNTER_MAX_RATIO),
  };
}

/**
 * 被踢者还价：一次机会，价格必须落在 [bid×1.2, bid×2.0]。
 * 主倒计时不暂停——攻击方须在剩余时间内响应，到期未响应按原出价成交。
 */
export function counterOffer(attackId, userId, price) {
  const attack = pending.get(attackId);
  if (!attack) throw new CapitalError(409, '这场踢馆已经结束了');
  if (attack.defenderId !== userId) throw new CapitalError(403, '这不是你的资产');
  if (attack.counterOnce) throw new CapitalError(409, '本轮谈判已经还过价了，一场只有一次机会');

  const asking = Math.floor(Number(price) || 0);
  const { counterMin, counterMax } = counterRangeOf(attack);
  if (!Number.isFinite(asking) || asking < counterMin || asking > counterMax) {
    throw new CapitalError(400, `还价必须在 ${formatMoney(counterMin)} ~ ${formatMoney(counterMax)} 之间（系统约束，不是随便出）`);
  }

  attack.counter = asking;
  attack.counterOnce = true;

  const payload = { ...toPayload(attack), counterPrice: asking, ...counterRangeOf(attack) };
  sendToUser(attack.attackerId, { type: 'counter_pending', payload }); // 攻击方弹还价请求
  return payload;
}

/**
 * 攻击方对还价的回应：
 * - accept：补齐差价（price - bid），按还价立即成交
 * - reject：还价作废，主倒计时照常，到期按原出价成交
 */
export function counterReply(attackId, userId, accept) {
  const attack = pending.get(attackId);
  if (!attack) throw new CapitalError(409, '这场踢馆已经结束了');
  if (attack.attackerId !== userId) throw new CapitalError(403, '只有发起踢馆的一方可以回应还价');
  if (!attack.counter) throw new CapitalError(409, '对方没有待处理的还价');

  const price = attack.counter;

  if (!accept) {
    attack.counter = null; // 还价作废（还价机会仍视为已用），照常对抗
    sendToUser(attack.defenderId, { type: 'counter_rejected', payload: toPayload(attack) });
    return { status: 'rejected', price };
  }

  // 同意：攻击者补齐差价（托管金 bid 之外的部分）
  settle(attack.attackerId);
  const row = query('SELECT balance FROM users WHERE id = ?', [userId])[0];
  if (!row) throw new CapitalError(404, '用户不存在');
  const extra = price - attack.bid;
  if (extra > 0 && !deductBalance(userId, extra)) {
    const curBal = Number(row.balance || 0);
    throw new CapitalError(402, `接受还价需要补差 ${formatMoney(extra)}，你还差 ${formatMoney(Math.max(0, extra - curBal))}——可拒绝还价继续对抗`);
  }
  attack.counter = null;

  // 按还价成交：易主 + 成交价全额入原店主账户
  resolveCapture(attackId, 'countered', price);
  return { status: 'countered', price };
}

/** 双端结果推送 + 全服战报 */
function finish(attack, outcome, message) {
  const payload = {
    ...toPayload(attack),
    outcome,
    message,
  };
  sendToUser(attack.attackerId, { type: 'shop_attack_result', payload });
  sendToUser(attack.defenderId, { type: 'shop_attack_result', payload });
  broadcastBattle({ id: randomId(), nickname: '资本对决', content: message, ts: Date.now() });
}