/**
 * 后端主入口（Express + ws）
 * 默认端口 3003，可通过 PORT 环境变量覆盖
 *
 * 路由：
 *   POST /api/auth/register          注册
 *   POST /api/auth/login             登录
 *   GET  /api/me                     当前登录用户（需 token）
 *   GET  /api/shops                  商铺列表
 *   GET  /api/shops/:id/products     某商铺商品
 *   GET  /api/shops/:id/flow         店铺消费流水与档位
 *   POST /api/orders                 下单（需 token；实付 10% 实时分给店铺收购人）
 *   GET  /api/inventory              我的库存（已购未转售商品）
 *   POST /api/orders/resell          转售库存商品（回收价 = 标价 85%~110% 随机）
 *   WS   /chat                       WebSocket 聊天
 *
 * 游戏接口（server/game.js）：
 *   GET  /api/game/state             资产状态 + 离线收益结算
 *   POST /api/game/acquire           收购资产
 *   POST /api/game/upgrade           豪华装修升级
 *   GET  /api/game/battles           全服战报
 * 资本轮回（server/prestige.js）：
 *   POST /api/game/prestige          500 亿身价清零重生换黑卡点数
 *   POST /api/game/talents           消耗黑卡点亮永久天赋
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { initDb, query, run, randomId, listUsersForAdmin, setChatBanned, deductBalance } from './db.js';
import { SHOP_ROYALTY_RATE, SHOP_RESELL_RATE_MIN, SHOP_RESELL_RATE_MAX, shopFlowTierFor } from '../shared/assets.js';
import authRouter, { authMiddleware, adminMiddleware } from './auth.js';
import { publicRouter as announcementsRouter, adminRouter as adminAnnouncementsRouter } from './announcements.js';
import { registerSocket, players, roomStats, ROOM_CAPACITY } from './chat.js';
import gameRouter from './game.js';
import treasureRouter from './treasure.js';
import questRouter from './quests.js';
import prestigeRouter from './prestige.js';
import crowdRouter, { tickCrowd } from './crowd.js';
import { initCapital } from './capital.js';
import { startTop1Watch } from './top1.js';

const PORT = Number(process.env.PORT || 3003);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// 托管 public/ 静态资源（admin.html 管理后台）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: Date.now(), players: players.size });
});

// 房间状态：前端选房 / 换房用（公开信息，无需鉴权）
app.get('/api/chat/rooms', (_req, res) => {
  res.json({ rooms: roomStats(), capacity: ROOM_CAPACITY });
});

// 鉴权路由
app.use('/api/auth', authRouter);

// 系统公告
app.use('/api/announcements', announcementsRouter);
app.use('/api/admin/announcements', adminAnnouncementsRouter);

// 游戏数值与收购
app.use('/api/game', gameRouter);
// 街头经济：金币拾取 / 碰瓷 NPC / 家族分红
app.use('/api/game', treasureRouter);
// 商业任务
app.use('/api/game', questRouter);
// 资本轮回：清零重生 + 永久天赋
app.use('/api/game', prestigeRouter);
// 街区众筹扩建 + 股份分红
app.use('/api/crowd', crowdRouter);

// 管理员 · 用户管理（禁止聊天）
app.get('/api/admin/users', authMiddleware, adminMiddleware, (_req, res) => {
  res.json(listUsersForAdmin());
});
app.post('/api/admin/users/:id/ban-chat', authMiddleware, adminMiddleware, (req, res) => {
  const rows = query('SELECT id, chat_banned FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '用户不存在' });
  if (rows[0].chat_banned) return res.json({ ok: true, chat_banned: 1 });
  setChatBanned(req.params.id, true);
  res.json({ ok: true, chat_banned: 1 });
});
app.post('/api/admin/users/:id/unban-chat', authMiddleware, adminMiddleware, (req, res) => {
  const rows = query('SELECT id, chat_banned FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '用户不存在' });
  if (!rows[0].chat_banned) return res.json({ ok: true, chat_banned: 0 });
  setChatBanned(req.params.id, false);
  res.json({ ok: true, chat_banned: 0 });
});

// 当前用户
app.get('/api/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// 商铺与商品
app.get('/api/shops', (_req, res) => {
  const rows = query('SELECT id, name, category, emoji, description, layout_z, side FROM shops WHERE active = 1 ORDER BY layout_z');
  res.json(rows);
});

app.get('/api/shops/:id/products', (req, res) => {
  const products = query('SELECT id, name, price, kind, buff FROM products WHERE shop_id = ? ORDER BY sort_order', [req.params.id]);
  res.json(products);
});

// 我的订单记录 + 可用优惠券（个人中心展示）
app.get('/api/orders/my', authMiddleware, (req, res) => {
  const now = Date.now();
  const orders = query(
    `SELECT o.id, o.qty, o.paid, o.created_at, p.name AS product_name
     FROM orders o LEFT JOIN products p ON p.id = o.product_id
     WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 20`,
    [req.user.id]
  );
  const coupons = query(
    'SELECT id, discount, expires_at FROM coupons WHERE user_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY expires_at',
    [req.user.id, now]
  );
  res.json({ orders, coupons });
});

/** 增益激活：解析商品 buff 编码写入 buffs_json（同类型重复激活叠加时长） */
function applyProductBuff(userId, buffStr, qty) {
  if (!buffStr) return { type: null, until: 0 };
  const [type, ms] = String(buffStr).split(':');
  const duration = Number(ms) || 0;
  if (!type || duration <= 0) return { type: null, until: 0 };
  const cur = query('SELECT buffs_json FROM users WHERE id = ?', [userId])[0]?.buffs_json;
  const buffs = (() => { try { return JSON.parse(cur || '{}'); } catch { return {}; } })();
  const now = Date.now();
  const base = Math.max(now, Number(buffs[type]) || now);
  const until = base + duration * qty;
  buffs[type] = until;
  run('UPDATE users SET buffs_json = ? WHERE id = ?', [JSON.stringify(buffs), userId]);
  return { type, until };
}

// 下单（每日限购 + 优惠券自动抵扣 + 写订单）
app.post('/api/orders', authMiddleware, (req, res) => {
  const { product_id, qty = 1 } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id 必填' });
  const q = Math.max(1, Math.min(99, Math.floor(Number(qty)) || 1));

  const prods = query('SELECT id, shop_id, name, price, kind, buff FROM products WHERE id = ?', [product_id]);
  if (prods.length === 0) return res.status(404).json({ error: '商品不存在' });
  const p = prods[0];

  // 每人每商品每日限购 3 件（防一键扫货）
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const bought = Number(query(
    'SELECT SUM(qty) AS s FROM orders WHERE user_id = ? AND product_id = ? AND created_at >= ?',
    [req.user.id, product_id, dayStart.getTime()]
  )[0]?.s) || 0;
  if (bought + q > 3) {
    return res.status(409).json({ error: `这件商品每人每日限购 3 件（今日已购 ${bought} 件）` });
  }

  // 优惠券自动抵扣：取最近过期的一张未用券（9 折）
  const coupon = query(
    'SELECT id, discount FROM coupons WHERE user_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY expires_at LIMIT 1',
    [req.user.id, Date.now()]
  )[0];
  const discount = coupon ? coupon.discount : 1;
  const total = Math.max(1, Math.round(p.price * q * discount));

  // 原子扣减余额，再插订单；用了券则标记核销
  if (!deductBalance(req.user.id, total)) {
    return res.status(402).json({ error: '余额不足' });
  }
  // daily 即食消耗品：买完立即消耗（resold=qty 标记），不进背包、不可转售
  const consumedNow = p.kind === 'daily' ? q : 0;
  run(
    'INSERT INTO orders (id, user_id, product_id, qty, resold, paid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [randomId(), req.user.id, product_id, q, consumedNow, total, Date.now()]
  );
  if (coupon) run('UPDATE coupons SET used_at = ? WHERE id = ?', [Date.now(), coupon.id]);

  // 店铺消费闭环：实付计入店铺流水；有收购人时实时分 10% 抽成（自己买自己店不抽成）
  run('UPDATE shops SET flow_total = flow_total + ? WHERE id = ?', [total, p.shop_id]);
  const ownerRow = query('SELECT user_id FROM player_shops WHERE shop_id = ? LIMIT 1', [p.shop_id])[0];
  let royalty = 0;
  if (ownerRow && ownerRow.user_id && ownerRow.user_id !== req.user.id) {
    royalty = Math.floor(total * SHOP_ROYALTY_RATE);
    if (royalty > 0) {
      run(
        'UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?',
        [royalty, royalty, ownerRow.user_id]
      );
    }
  }

  // 增益商品：daily 即食买完立即激活；boost 进背包由「使用」激活（互斥：用了的不能再卖）
  let buffType = null;
  let buffUntil = 0;
  if (p.kind === 'daily' && p.buff) {
    const applied = applyProductBuff(req.user.id, p.buff, q);
    buffType = applied.type;
    buffUntil = applied.until;
  }

  const remaining = Number(query('SELECT balance FROM users WHERE id = ?', [req.user.id])[0]?.balance ?? 0);
  res.json({
    ok: true, product: p, qty: q, total,
    couponUsed: !!coupon, discount: coupon ? Math.round((1 - discount) * 100) : 0,
    remaining: Math.max(0, Math.floor(remaining)),
    royalty, shopId: p.shop_id,
    buffType: buffType || null, buffUntil: buffUntil || null,
  });
});

// 我的库存（买入未消耗的商品；daily 即食买时已消耗自动消失，boost 待使用，permit 待收购/转售）
app.get('/api/inventory', authMiddleware, (req, res) => {
  const rows = query(
    `SELECT p.id AS product_id, p.name, p.price, p.kind, s.id AS shop_id, s.name AS shop_name, s.emoji,
            SUM(o.qty) AS bought, SUM(o.resold) AS resold
     FROM orders o
     JOIN products p ON p.id = o.product_id
     JOIN shops s ON s.id = p.shop_id
     WHERE o.user_id = ?
     GROUP BY p.id
     ORDER BY MAX(o.created_at) DESC`,
    [req.user.id]
  );
  res.json(rows
    .map((r) => ({
      product_id: r.product_id, name: r.name, price: Number(r.price),
      kind: r.kind || 'daily',
      shop_id: r.shop_id, shop_name: r.shop_name, emoji: r.emoji,
      qty: Math.max(0, Number(r.bought) - Number(r.resold)),
    }))
    .filter((r) => r.qty > 0));
});

// 转售：把已购商品卖给街面游客。
// 回收价 = 【实付单价】× 85%~95% 随机（服务端定率防作弊）：
//   - 无券买入：回收期望 90% < 100%，纯转售必亏
//   - 9 折券买入：按实付（标价×0.9）回收，期望 90%×0.9 = 81% < 90% 实付，同样必亏
//   → 彻底堵死「优惠券买入 + 转售」与「双人互刷」正期望套利
// daily 即食消耗品不可转售（买完即消耗，资产去向互斥）
app.post('/api/orders/resell', authMiddleware, (req, res) => {
  const { product_id, qty = 1 } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id 必填' });
  const q = Math.max(1, Math.min(99, Math.floor(Number(qty)) || 1));

  const prods = query('SELECT id, shop_id, name, price, kind FROM products WHERE id = ?', [product_id]);
  if (prods.length === 0) return res.status(404).json({ error: '商品不存在' });
  const p = prods[0];
  if (p.kind === 'daily') {
    return res.status(409).json({ error: '食品饮品类是即食消耗品，买下时已立即生效，不可转售' });
  }

  const agg = query(
    'SELECT SUM(qty) AS s, SUM(resold) AS r FROM orders WHERE user_id = ? AND product_id = ?',
    [req.user.id, product_id]
  )[0] || {};
  const avail = Math.max(0, Number(agg.s) - Number(agg.r));
  if (avail < q) return res.status(409).json({ error: `库存不足（可转售 ${avail} 件）` });

  const rate = SHOP_RESELL_RATE_MIN + Math.random() * (SHOP_RESELL_RATE_MAX - SHOP_RESELL_RATE_MIN);

  // FIFO 逐单按实付单价回收：paid/qty = 该单实际掏的钱（含券抵扣），券越深回收越少
  let left = q;
  let refund = 0;
  const fifo = query(
    'SELECT id, qty, resold, paid FROM orders WHERE user_id = ? AND product_id = ? ORDER BY created_at',
    [req.user.id, product_id]
  );
  for (const row of fifo) {
    if (left <= 0) break;
    const free = Number(row.qty) - Number(row.resold);
    if (free <= 0) continue;
    const take = Math.min(free, left);
    const paidPerUnit = Math.max(1, Math.round(Number(row.paid) / Math.max(1, Number(row.qty))));
    refund += Math.max(1, Math.round(paidPerUnit * rate)) * take;
    run('UPDATE orders SET resold = resold + ? WHERE id = ?', [take, row.id]);
    left -= take;
  }
  refund = Math.max(1, refund);
  const unit = Math.max(1, Math.round(refund / q));

  run(
    'UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?',
    [refund, refund, req.user.id]
  );
  const remaining = Number(query('SELECT balance FROM users WHERE id = ?', [req.user.id])[0]?.balance ?? 0);
  res.json({
    ok: true, product: { id: p.id, name: p.name }, qty: q, refund, unit,
    rate: Math.round(rate * 100), remaining: Math.max(0, Math.floor(remaining)),
  });
});

// 使用功能商品（boost 专用）：从背包消耗 1 件 → 激活 buff。
// 资产去向互斥：使用后库存即减，不能再转售；daily 即食买时已生效（无库存）；permit 无 buff 不可使用
app.post('/api/inventory/use', authMiddleware, (req, res) => {
  const { product_id } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id 必填' });

  const prods = query('SELECT id, shop_id, name, price, kind, buff FROM products WHERE id = ?', [product_id]);
  if (prods.length === 0) return res.status(404).json({ error: '商品不存在' });
  const p = prods[0];
  if (p.kind !== 'boost') {
    return res.status(409).json({ error: '该商品不是可使用的功能商品（即食品买时已生效，材料无需使用）' });
  }
  if (!p.buff) return res.status(409).json({ error: '该商品没有增益效果' });

  const agg = query(
    'SELECT SUM(qty) AS s, SUM(resold) AS r FROM orders WHERE user_id = ? AND product_id = ?',
    [req.user.id, product_id]
  )[0] || {};
  const avail = Math.max(0, Number(agg.s) - Number(agg.r));
  if (avail < 1) return res.status(409).json({ error: '背包里没有这件商品' });

  // FIFO 消耗 1 件（与转售同一套库存机制——消耗后自动从背包消失）
  let need = 1;
  const fifo = query(
    'SELECT id, qty, resold FROM orders WHERE user_id = ? AND product_id = ? ORDER BY created_at',
    [req.user.id, product_id]
  );
  for (const row of fifo) {
    if (need <= 0) break;
    const free = Number(row.qty) - Number(row.resold);
    if (free <= 0) continue;
    const take = Math.min(free, need);
    run('UPDATE orders SET resold = resold + ? WHERE id = ?', [take, row.id]);
    need -= take;
  }

  const applied = applyProductBuff(req.user.id, p.buff, 1);
  const remaining = Number(query('SELECT balance FROM users WHERE id = ?', [req.user.id])[0]?.balance ?? 0);
  res.json({
    ok: true, product: { id: p.id, name: p.name }, used: 1,
    buffType: applied.type, buffUntil: applied.until,
    remaining: Math.max(0, Math.floor(remaining)),
  });
});

// 某店铺消费流水与档位（商品卡/资产卡进度条展示；餐饮店门槛减半）
app.get('/api/shops/:id/flow', (req, res) => {
  const row = query('SELECT flow_total FROM shops WHERE id = ?', [req.params.id])[0];
  const flow = Number(row?.flow_total) || 0;
  const t = shopFlowTierFor(req.params.id, flow);
  res.json({
    shop_id: req.params.id, flow_total: flow,
    tier_index: t.index, share: t.share,
    next_tier: t.next === null ? null : Math.round(t.next / (t.restaurant ? 2 : 1)),
    restaurant: t.restaurant,
  });
});

// 已达流水档位的店铺列表（前端在其门口刷「客源金币」；餐饮店门槛减半）
app.get('/api/shops/flowtiers', (_req, res) => {
  const rows = query('SELECT id, flow_total FROM shops WHERE active = 1');
  const shops = rows
    .map((r) => ({ shopId: r.id, tierIndex: shopFlowTierFor(r.id, r.flow_total).index }))
    .filter((r) => r.tierIndex >= 0);
  res.json(shops);
});

// 错误兜底
app.use((err, _req, res, _next) => {
  console.error('[express]', err);
  res.status(500).json({ error: '服务器错误' });
});

async function start() {
  await initDb();
  console.log('[db] SQLite initialized');
  initCapital(); // 清理上次进程残留的踢馆记录
  tickCrowd(); // 启动时先跑一轮众筹结算（补上停机期间的分红累积与到期判定）
  startTop1Watch(); // 全服首富检测：易主时跨房间播报（启动只建立基线）

  const server = http.createServer(app);

  // WebSocket 聊天（和 HTTP 同端口）
  const wss = new WebSocketServer({ server, path: '/chat' });
  wss.on('connection', (ws, req) => registerSocket(ws, req));
  console.log('[ws] /chat endpoint ready');

  server.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('server failed:', err);
  process.exit(1);
});