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
 *   POST /api/orders                 下单（需 token）
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
  const products = query('SELECT id, name, price FROM products WHERE shop_id = ? ORDER BY sort_order', [req.params.id]);
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

// 下单（每日限购 + 优惠券自动抵扣 + 写订单）
app.post('/api/orders', authMiddleware, (req, res) => {
  const { product_id, qty = 1 } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'product_id 必填' });
  const q = Math.max(1, Math.min(99, Math.floor(Number(qty)) || 1));

  const prods = query('SELECT shop_id, name, price FROM products WHERE id = ?', [product_id]);
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
  run(
    'INSERT INTO orders (id, user_id, product_id, qty, paid, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [randomId(), req.user.id, product_id, q, total, Date.now()]
  );
  if (coupon) run('UPDATE coupons SET used_at = ? WHERE id = ?', [Date.now(), coupon.id]);

  const remaining = Number(query('SELECT balance FROM users WHERE id = ?', [req.user.id])[0]?.balance ?? 0);
  res.json({
    ok: true, product: p, qty: q, total,
    couponUsed: !!coupon, discount: coupon ? Math.round((1 - discount) * 100) : 0,
    remaining: Math.max(0, Math.floor(remaining)),
  });
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