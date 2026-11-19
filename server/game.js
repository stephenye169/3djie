/**
 * 游戏数值与收购接口
 *
 * 路由：
 *   GET  /api/game/state            玩家资产、持有店铺、离线收益、进行中的踢馆
 *   POST /api/game/acquire          收购无主资产
 *   POST /api/game/upgrade          豪华装修升级
 *   POST /api/game/attack           对他人店铺发起资本踢馆
 *   POST /api/game/defend           原店主强力护盘
 *   POST /api/game/surrender        原店主认栽
 *   GET  /api/game/battles          全服战报（弹幕历史）
 *   POST /api/game/worship          膜拜全服首富领红包（每人每小时一次）
 *   POST /api/game/teleport         地图模式点击传送（每次扣除 ¥10 万）
 */
import express from 'express';
import { query, run, randomId, addBalance, deductBalance } from './db.js';
import { authMiddleware } from './auth.js';
import { broadcastBattle } from './chat.js';
import { listOwned, settle, syncDerived, activeBuffDetails } from './economy.js';
import { createAttack, defend, surrender, incomingAttack, pendingForShop, shopCooldowns, TIER1_PROTECT_MS, isNewPlayer } from './capital.js';
import { dividendStatus } from './treasure.js';
import { questsFor } from './quests.js';
import {
  ASSETS, MAX_LEVEL, PRESTIGE_THRESHOLD, TELEPORT_COST, findAsset, assetValueOf, incomeOf, upgradeCostOf,
  titleFor, nextTitle, formatMoney,
  ACQUIRE_PERMITS, ACQUIRE_RARE, ACQUIRE_MIN_SHOPS,
} from '../shared/assets.js';
import {
  prestigePointsOf, talentLevelOf, dominationFactor,
} from '../shared/prestige.js';
import { totalPortfolioValue } from './prestige.js';
import { currentTop1, wealthRanking, TOP1_MIN_WEALTH } from './top1.js';

const router = express.Router();

/** 资产 -> 当前归属（可能为空） */
function ownerMap() {
  const rows = query(
    `SELECT ps.shop_id, ps.user_id, ps.level, ps.acquired_at, u.nickname
     FROM player_shops ps JOIN users u ON u.id = ps.user_id`
  );
  return new Map(rows.map((r) => [r.shop_id, r]));
}

/** 玩家 permit 库存（按商品名汇总，收购门槛用） */
function permitStock(userId) {
  const rows = query(
    `SELECT p.name, SUM(o.qty) AS s, SUM(o.resold) AS r
     FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.user_id = ? AND p.kind = 'permit'
     GROUP BY p.name`,
    [userId]
  );
  return new Map(rows.map((r) => [r.name, Math.max(0, Number(r.s) - Number(r.r))]));
}

/** 某资产的收购门槛检查结果（前端展示 + 服务端校验共用） */
function unlockStatus(asset, stock, ownedCount) {
  const permits = ACQUIRE_PERMITS[asset.tier] || [];
  const rare = ACQUIRE_RARE[asset.tier] || null;
  const minShops = ACQUIRE_MIN_SHOPS[asset.tier] || 0;
  const required = [
    ...permits.map((name) => ({ name, need: 1, have: stock.get(name) || 0 })),
    ...(rare ? [{ name: rare, need: 1, have: stock.get(rare) || 0 }] : []),
    ...(minShops ? [{ name: `持有店铺 ≥ ${minShops}`, need: minShops, have: ownedCount, isShop: true }] : []),
  ];
  return { required, met: required.every((r) => r.have >= r.need) };
}

/** 组装给前端的完整状态 */
function buildState(userId) {
  const user = query(
    `SELECT id, nickname, balance, title, income_per_sec, total_earned, stamina,
            rebirth_count, black_card_points, talents_json
     FROM users WHERE id = ?`,
    [userId]
  )[0];
  if (!user) return null;

  const owned = listOwned(userId);
  const { income, title } = syncDerived(userId, owned);
  const owners = ownerMap();
  const ownedMap = new Map(owned.map((s) => [s.shop_id, s]));
  const cooldowns = shopCooldowns(ASSETS.map((a) => a.id));
  const newbieCache = new Map();
  const stock = permitStock(userId);
  const buffs = activeBuffDetails(userId);

  const incoming = incomingAttack(userId);
  const talents = JSON.parse(user.talents_json || '{}');
  const domFactor = dominationFactor(talentLevelOf(talents, 'capitalDomination'));
  const totalValue = totalPortfolioValue(userId);

  const assets = ASSETS.map((asset) => {
    const mine = ownedMap.get(asset.id);
    const owner = owners.get(asset.id);
    const protectLeftMs = owner && asset.tier === 1
      ? TIER1_PROTECT_MS - (Date.now() - Number(owner.acquired_at || 0))
      : 0;
    // 新手安全期：注册 4h 内 或 总资产 ≤1000 万（按 owner 缓存，避免每家店重复扫库）
    let newbie = null;
    if (owner && asset.tier === 1) {
      if (!newbieCache.has(owner.user_id)) newbieCache.set(owner.user_id, isNewPlayer(owner.user_id));
      newbie = newbieCache.get(owner.user_id);
    }
    const ownerProtected = protectLeftMs > 0 || !!newbie?.isNew;
    // 收购门槛（tier≥2 需要 permit 材料 / 黄金店还要稀有材料与持有店铺数）
    const unlock = !ownedMap.has(asset.id)
      ? unlockStatus(asset, stock, owned.length)
      : null;
    return {
      id: asset.id,
      name: asset.name,
      emoji: asset.emoji,
      tier: asset.tier,
      price: asset.price,
      // 折后收购价（资本压制天赋）：踢馆身价仍按原价 assetValueOf 计算，不受折扣影响
      acquirePrice: Math.round(asset.price * domFactor),
      baseIncome: asset.baseIncome,
      manager: asset.manager,
      taunt: asset.taunts?.[0] || '',
      owned: !!mine,
      level: mine ? mine.level : (owner ? owner.level : 0),
      income: mine ? incomeOf(asset, mine.level) : 0,
      // 折后装修价（资本压制天赋同样生效）
      upgradeCost: mine ? Math.round((upgradeCostOf(asset, mine.level) || 0) * domFactor) || null : null,
      ownerId: owner ? owner.user_id : null,
      ownerNick: owner ? owner.nickname : null,
      attacking: !!pendingForShop(asset.id),
      cooldownMs: cooldowns.get(asset.id) || 0,
      // 普通店铺保护：易主 4 小时内 / owner 处于新手安全期
      ownerProtected,
      ownerProtectedHours: protectLeftMs > 0 ? Math.ceil(protectLeftMs / 3_600_000) : 0,
      ownerProtectedReason: protectLeftMs > 0 ? 'transfer' : (newbie?.isNew ? newbie.reason : null),
      unlock,
    };
  });

  return {
    user: {
      id: user.id,
      nickname: user.nickname,
      balance: Math.floor(user.balance),
      title,
      incomePerSec: income,
      totalEarned: Math.floor(user.total_earned),
      rebirthCount: user.rebirth_count,
      stamina: Math.round(Number(user.stamina) || 0),
      blackCardPoints: user.black_card_points,
      talents,
    },
    ownedCount: owned.length,
    totalAssets: ASSETS.length,
    nextTitle: nextTitle(owned.length),
    buffs,
    dividend: dividendStatus(userId),
    prestige: {
      totalValue,
      threshold: PRESTIGE_THRESHOLD,
      ready: totalValue >= PRESTIGE_THRESHOLD,
      pointsPreview: prestigePointsOf(totalValue),
    },
    incomingAttack: incoming ? {
      attackId: incoming.id,
      shopId: incoming.shopId,
      shopName: incoming.shopName,
      attackerNick: incoming.attackerNick,
      bid: incoming.bid,
      defendCost: incoming.defendCost,
      expiresAt: incoming.expiresAt,
    } : null,
    assets,
    quests: questsFor(userId),
  };
}

/** 玩家资料卡（GDD §5.3 玩家资料查看）：公开信息（昵称/称号/身价/店铺列表），不含现金余额 */
router.get('/profile/:userId', authMiddleware, (req, res) => {
  const target = query(
    'SELECT id, nickname, variant, title, total_earned, income_per_sec, rebirth_count, black_card_points, created_at FROM users WHERE id = ?',
    [req.params.userId]
  )[0];
  if (!target) return res.status(404).json({ error: '玩家不存在' });

  const owned = listOwned(target.id);
  const shops = owned.map((s) => {
    const asset = findAsset(s.shop_id);
    return {
      shopId: s.shop_id,
      name: asset?.name || s.shop_id,
      emoji: asset?.emoji || '🏪',
      tier: asset?.tier || 0,
      level: s.level,
      incomePerSec: incomeOf(asset, s.level),
      acquiredAt: s.acquired_at,
    };
  });
  const totalShopValue = owned.reduce((sum, s) => {
    const asset = findAsset(s.shop_id);
    return asset ? sum + assetValueOf(asset, s.level) : sum;
  }, 0);

  res.json({
    user: {
      id: target.id,
      nickname: target.nickname,
      variant: target.variant,
      title: target.title,
      rebirthCount: target.rebirth_count,
      registeredAt: target.created_at,
    },
    totalShopValue,
    totalEarned: Math.floor(target.total_earned),
    incomePerSec: target.income_per_sec,
    shops,
  });
});

/** 写战报并广播给全服（失败不影响主流程） */
function publishBattle(userId, nickname, content) {
  try {
    run(
      'INSERT INTO battle_logs (id, user_id, nickname, content, created_at) VALUES (?, ?, ?, ?, ?)',
      [randomId(), userId, nickname, content, Date.now()]
    );
  } catch (err) {
    console.warn('[game] 战报落库失败:', err.message);
  }
  broadcastBattle({ id: randomId(), nickname, content, ts: Date.now() });
}

// ============ 接口 ============

router.get('/state', authMiddleware, (req, res) => {
  const offline = settle(req.user.id);
  const state = buildState(req.user.id);
  if (!state) return res.status(404).json({ error: '用户不存在' });
  state.offline = offline.seconds >= 60 && offline.earnings > 0
    ? { seconds: offline.seconds, earnings: offline.earnings }
    : { seconds: 0, earnings: 0 };
  res.json(state);
});

/**
 * 新手引导「龙王归来体验卡」：一次性空投 5000 万启动金
 * 用 intro_grants 表做幂等，防止反复注册刷启动金
 */
router.post('/intro/grant', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const row = query('SELECT nickname FROM users WHERE id = ?', [userId])[0];
  if (!row) return res.status(404).json({ error: '用户不存在' });
  if (query('SELECT 1 AS x FROM intro_grants WHERE user_id = ?', [userId])[0]) {
    return res.status(409).json({ error: '体验卡已经领过了' });
  }

  const AMOUNT = 50_000_000;
  run('INSERT INTO intro_grants (user_id, amount, granted_at) VALUES (?, ?, ?)', [userId, AMOUNT, Date.now()]);
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [AMOUNT, userId]);
  publishBattle(userId, row.nickname, `【${row.nickname}】激活「龙王归来」体验卡，新手逆袭基金 ¥5,000 万到账`);

  const balance = query('SELECT balance FROM users WHERE id = ?', [userId])[0]?.balance || 0;
  res.json({ amount: AMOUNT, balance });
});

router.post('/acquire', authMiddleware, (req, res) => {
  const assetId = String(req.body?.assetId || '');
  const asset = findAsset(assetId);
  if (!asset) return res.status(404).json({ error: '资产不存在' });

  const owner = ownerMap().get(assetId);
  if (owner && owner.user_id === req.user.id) return res.status(409).json({ error: '这家已经是你的了' });
  if (owner) {
    return res.status(409).json({ error: `已被【${owner.nickname}】独占，去门口发起资本踢馆吧` });
  }

  settle(req.user.id);
  const row = query('SELECT balance, nickname, talents_json FROM users WHERE id = ?', [req.user.id])[0];
  if (!row) return res.status(404).json({ error: '用户不存在' });

  // 收购门槛：tier≥2 需要 permit 材料组合（收购时消耗），黄金店额外要稀有材料 + 持有店铺数
  const owned = listOwned(req.user.id);
  const stock = permitStock(req.user.id);
  const unlock = unlockStatus(asset, stock, owned.length);
  if (!unlock.met) {
    const missing = unlock.required
      .filter((r) => r.have < r.need)
      .map((r) => (r.isShop ? `${r.name}（现有 ${r.have}）` : `${r.name} ×${r.need - r.have}`))
      .join('、');
    return res.status(409).json({ error: `收购门槛未达成，还缺：${missing}`, unlock });
  }

  // 资本压制天赋：收购价打折（踢馆身价不受影响）
  const price = Math.round(asset.price * dominationFactor(
    talentLevelOf(JSON.parse(row.talents_json || '{}'), 'capitalDomination')
  ));
  if (!deductBalance(req.user.id, price)) {
    const curBal = Number(row.balance || 0);
    return res.status(402).json({
      error: '资金不足',
      need: price,
      balance: Math.floor(curBal),
      short: Math.ceil(Math.max(0, price - curBal)),
    });
  }

  // 消耗收购材料（FIFO 标记 resold，与转售同一套库存机制）
  const usedPermits = [...(ACQUIRE_PERMITS[asset.tier] || []), ...(ACQUIRE_RARE[asset.tier] ? [ACQUIRE_RARE[asset.tier]] : [])];
  for (const permitName of usedPermits) {
    let need = 1;
    const fifo = query(
      `SELECT o.id, o.qty, o.resold FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.user_id = ? AND p.name = ? AND p.kind = 'permit'
       ORDER BY o.created_at`,
      [req.user.id, permitName]
    );
    for (const o of fifo) {
      if (need <= 0) break;
      const free = Number(o.qty) - Number(o.resold);
      if (free <= 0) continue;
      const take = Math.min(free, need);
      run('UPDATE orders SET resold = resold + ? WHERE id = ?', [take, o.id]);
      need -= take;
    }
  }

  run(
    'INSERT INTO player_shops (user_id, shop_id, level, acquired_at) VALUES (?, ?, 1, ?)',
    [req.user.id, assetId, Date.now()]
  );

  const { title } = syncDerived(req.user.id, listOwned(req.user.id));
  publishBattle(
    req.user.id,
    row.nickname,
    `玩家【${row.nickname}】甩出黑卡，${formatMoney(price)} 收购【${asset.name}】！`
  );

  const state = buildState(req.user.id);
  res.json({ ok: true, title, asset: state.assets.find((a) => a.id === assetId), state });
});

router.post('/upgrade', authMiddleware, (req, res) => {
  const assetId = String(req.body?.assetId || '');
  const asset = findAsset(assetId);
  if (!asset) return res.status(404).json({ error: '资产不存在' });

  const mine = query(
    `SELECT ps.level, u.talents_json FROM player_shops ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.user_id = ? AND ps.shop_id = ?`,
    [req.user.id, assetId]
  )[0];
  if (!mine) return res.status(409).json({ error: '你还没有收购这家店' });
  const level = Number(mine.level) || 1;
  if (level >= MAX_LEVEL) return res.status(409).json({ error: '已经是顶级豪华装修' });

  // 资本压制天赋：装修价同折扣
  const cost = Math.round((upgradeCostOf(asset, level) || 0) * dominationFactor(
    talentLevelOf(JSON.parse(mine.talents_json || '{}'), 'capitalDomination')
  ));
  settle(req.user.id);
  const row = query('SELECT balance FROM users WHERE id = ?', [req.user.id])[0];
  if (!row) return res.status(404).json({ error: '用户不存在' });
  if (!deductBalance(req.user.id, cost)) {
    const curBal = Number(row.balance || 0);
    return res.status(402).json({
      error: '资金不足',
      need: cost,
      balance: Math.floor(curBal),
      short: Math.ceil(Math.max(0, cost - curBal)),
    });
  }
  run('UPDATE player_shops SET level = ? WHERE user_id = ? AND shop_id = ?', [level + 1, req.user.id, assetId]);
  syncDerived(req.user.id);

  const state = buildState(req.user.id);
  res.json({ ok: true, level: level + 1, state });
});

router.post('/attack', authMiddleware, (req, res) => {
  try {
    const attack = createAttack(req.user, String(req.body?.assetId || ''));
    res.json({ ok: true, attack });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/defend', authMiddleware, (req, res) => {
  try {
    const result = defend(String(req.body?.attackId || ''), req.user);
    res.json({ ok: true, ...result, state: buildState(req.user.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/surrender', authMiddleware, (req, res) => {
  try {
    const result = surrender(String(req.body?.attackId || ''), req.user);
    res.json({ ok: true, ...result, state: buildState(req.user.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/battles', (_req, res) => {
  const rows = query(
    'SELECT id, nickname, content, created_at FROM battle_logs ORDER BY created_at DESC LIMIT 40'
  );
  res.json(rows.map((r) => ({ id: r.id, nickname: r.nickname, content: r.content, ts: r.created_at })));
});

const LEADERBOARD_SIZE = 10;

/** 全服首富榜：现金 + 持有店铺身价，Top 10（与 top1.js 同一份聚合，避免两份口径漂移） */
router.get('/leaderboard', authMiddleware, (_req, res) => {
  const entries = wealthRanking(LEADERBOARD_SIZE).map((e, index) => ({
    rank: index + 1,
    id: e.userId,
    nickname: e.nickname,
    title: e.title,
    balance: e.balance,
    assetsValue: e.assetsValue,
    totalValue: e.wealth,
  }));
  res.json({ entries, updatedAt: Date.now() });
});

// ============ 膜拜首富·领红包（README §19 ③） ============

const WORSHIP_REWARD = 50_000;             // ¥5 万，系统发放（不扣首富的钱）
const WORSHIP_COOLDOWN_MS = 60 * 60 * 1000; // 每人每小时一次

/** 上次膜拜时间（0 = 从未） */
function lastWorshipAt(userId) {
  const row = query('SELECT last_at FROM worship_logs WHERE user_id = ?', [userId])[0];
  return row?.last_at || 0;
}

/**
 * 膜拜全服首富：领 ¥5 万红包
 * - 目标必须是**当前**全服首富（快照由 top1.js 每 30s 重算），不能膜拜自己
 * - 每人每小时一次；金额固定 ¥5 万，由系统发放
 * - 发放流水写 transaction_logs，便于对账
 */
router.post('/worship', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const targetId = String(req.body?.userId || '');
  if (!targetId) return res.status(400).json({ error: 'userId 必填' });
  if (targetId === userId) return res.status(400).json({ error: '自己膜拜自己可不算数' });

  const top = currentTop1();
  if (!top || top.userId !== targetId) {
    return res.status(409).json({ error: '对方已经不是全服首富了，膜拜无效' });
  }

  const wait = WORSHIP_COOLDOWN_MS - (Date.now() - lastWorshipAt(userId));
  if (wait > 0) {
    return res.status(429).json({
      error: `膜拜红包每小时一次，还要等 ${Math.ceil(wait / 60000)} 分钟`,
      cooldownMs: wait,
    });
  }

  settle(userId);
  const now = Date.now();
  if (lastWorshipAt(userId)) {
    run('UPDATE worship_logs SET last_at = ? WHERE user_id = ?', [now, userId]);
  } else {
    run('INSERT INTO worship_logs (user_id, last_at) VALUES (?, ?)', [userId, now]);
  }

  const balance = addBalance(userId, WORSHIP_REWARD);
  run(
    'INSERT INTO transaction_logs (id, user_id, kind, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [randomId(), userId, 'worship', WORSHIP_REWARD, `膜拜首富 ${top.nickname}`, now]
  );

  const nickname = query('SELECT nickname FROM users WHERE id = ?', [userId])[0]?.nickname || '路人';
  publishBattle(
    userId,
    nickname,
    `💎 ${nickname} 膜拜首富「${top.nickname}」，领走 ¥${formatMoney(WORSHIP_REWARD)} 红包`
  );

  res.json({
    ok: true,
    reward: WORSHIP_REWARD,
    balance,
    cooldownMs: WORSHIP_COOLDOWN_MS,
    top1: top,
  });
});

// ============ 地图点击传送（¥10 万/次） ============

router.post('/teleport', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const shopId = String(req.body?.shopId || '');
  const asset = shopId ? findAsset(shopId) : null;

  settle(userId);
  const row = query('SELECT balance FROM users WHERE id = ?', [userId])[0];
  if (!row) return res.status(404).json({ error: '用户不存在' });

  if (!deductBalance(userId, TELEPORT_COST)) {
    const curBal = Number(row.balance || 0);
    return res.status(402).json({
      error: `余额不足，地图传送需要 ¥${formatMoney(TELEPORT_COST)}`,
      need: TELEPORT_COST,
      balance: Math.floor(curBal),
      short: Math.ceil(Math.max(0, TELEPORT_COST - curBal)),
    });
  }

  const now = Date.now();
  const note = asset ? `地图传送至【${asset.name}】` : '地图传送';
  run(
    'INSERT INTO transaction_logs (id, user_id, kind, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [randomId(), userId, 'teleport', -TELEPORT_COST, note, now]
  );

  const balance = Math.floor(Number(query('SELECT balance FROM users WHERE id = ?', [userId])[0]?.balance || 0));
  res.json({ ok: true, cost: TELEPORT_COST, balance, shopId: asset?.id || null });
});

export default router;