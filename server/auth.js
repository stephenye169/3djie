/**
 * 鉴权路由：注册 / 登录
 * - 用 bcryptjs 存密码散列（经验 2194915 明确要求慢哈希 + 带盐）
 * - JWT 签名，前端存 localStorage 后续请求带 Authorization: Bearer <token>
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initDb, findUserByUsername, findUserById, insertUser, randomId } from './db.js';

const router = express.Router();
const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'qingguo-dev-secret-change-me';
const TOKEN_TTL = '7d';

// 管理员白名单（逗号分隔），默认只有种子账号 admin
const ADMIN_USERS = (process.env.ADMIN_USERS || process.env.ADMIN_USERNAME || 'admin')
  .split(',').map((s) => s.trim()).filter(Boolean);

// 确保 DB 已初始化
initDb();

router.post('/register', async (req, res) => {
  const { username, password, nickname, variant } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: '用户名 3–20 字' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  const existing = findUserByUsername(username);
  if (existing) return res.status(409).json({ error: '用户名已存在' });

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = Date.now();
  const user = {
    id: randomId(),
    username,
    password: hash,
    nickname: nickname || username,
    variant: variant === 'female' ? 'female' : 'male',
    balance: 500000, // 开局首桶金：刚好够买第一家奶茶铺
    created_at: now,
  };
  insertUser(user);

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({
    token,
    user: findUserById(user.id), // 不带 password
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

  const user = findUserByUsername(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  res.json({ token, user: findUserById(user.id) });
});

/** 鉴权中间件：解析 Bearer token 到 req.user */
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '需要登录' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token 无效或已过期' });
  }
}

/** 管理员中间件：必须先用 authMiddleware 填好 req.user */
export function adminMiddleware(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '需要登录' });
  if (!ADMIN_USERS.includes(req.user.username)) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

export { JWT_SECRET, ADMIN_USERS };
export default router;
