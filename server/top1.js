/**
 * 全服首富检测 + 播报（README §19 情绪放大器 ③「首富进房排面」）
 *
 * - 财富口径与 /api/game/leaderboard 完全一致：现金 + 持有店铺身价（基础价 × 1.5^(等级-1)）
 * - 第一名变更时向所有房间广播 `{ type: 'top1', payload }`（跨房间，和战报弹幕一样全局）
 * - 首富快照缓存在内存里，供 GET /api/game/state 与膜拜接口读取，避免每次请求都扫全表
 * - 低于 TOP1_MIN_WEALTH 不算首富：新手拿着 50 万启动金不该触发「首富驾临」播报
 */
import { query } from './db.js';
import { assetValueOf, findAsset } from '../shared/assets.js';
import { broadcastTop1 } from './chat.js';

/** 成为「全服首富」的最低身价（¥500 万），低于此值不播报 */
export const TOP1_MIN_WEALTH = 5_000_000;
/** 重算间隔：30s（与首富榜前端轮播刷新节奏一致） */
const REFRESH_MS = 30_000;

/** @type {{ userId: string, nickname: string, title: string, wealth: number } | null} */
let _cache = null;
let _timer = null;

/**
 * 全服财富榜（现金 + 店铺身价），按身价降序
 * @param {number} limit
 * @returns {Array<{ userId: string, nickname: string, title: string, balance: number, assetsValue: number, wealth: number }>}
 */
export function wealthRanking(limit = 10) {
  const users = query('SELECT id, nickname, title, balance FROM users');
  const shopRows = query('SELECT user_id, shop_id, level FROM player_shops');

  const portfolio = new Map();
  for (const row of shopRows) {
    const asset = findAsset(row.shop_id);
    if (!asset) continue;
    portfolio.set(row.user_id, (portfolio.get(row.user_id) || 0) + assetValueOf(asset, row.level));
  }

  return users
    .map((u) => {
      const balance = Math.floor(Number(u.balance) || 0);
      const assetsValue = portfolio.get(u.id) || 0;
      return {
        userId: u.id,
        nickname: u.nickname,
        title: u.title || '街头路人甲',
        balance,
        assetsValue,
        wealth: balance + assetsValue,
      };
    })
    .sort((a, b) => b.wealth - a.wealth)
    .slice(0, limit);
}

/** 当前首富（未达门槛返回 null） */
export function computeTop1() {
  const best = wealthRanking(1)[0];
  if (!best || best.wealth < TOP1_MIN_WEALTH) return null;
  return {
    userId: best.userId,
    nickname: best.nickname,
    title: best.title,
    wealth: best.wealth,
  };
}

/** 缓存的当前首富快照（给 state / 膜拜接口用） */
export function currentTop1() {
  return _cache;
}

/**
 * 重算首富，首富易主时全服播报
 * @param {{announce?: boolean}} [opts] announce=false 只更新缓存（启动建立基线用）
 */
export function refreshTop1({ announce = true } = {}) {
  const next = computeTop1();
  const prevId = _cache?.userId || null;
  const nextId = next?.userId || null;
  _cache = next;

  if (announce && nextId && nextId !== prevId) {
    try {
      broadcastTop1(next);
      console.log(`[top1] 首富易主 → ${next.nickname}（身价 ${next.wealth}）`);
    } catch (err) {
      console.warn('[top1] 播报失败:', err.message);
    }
  }
  return next;
}

/** 启动后台轮询（启动时只建立基线，不播报上一任首富） */
export function startTop1Watch(intervalMs = REFRESH_MS) {
  refreshTop1({ announce: false });
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => refreshTop1(), intervalMs);
  return _timer;
}
