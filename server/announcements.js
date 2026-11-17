/**
 * 系统公告：公开读取 + 管理员增删改
 *
 * 公开：
 *   GET /api/announcements                 仅启用中的公告
 * 管理员（需 Bearer token，且账号在 ADMIN_USERS 白名单内）：
 *   GET    /api/admin/announcements        全部公告
 *   POST   /api/admin/announcements        { title, content, active? }
 *   PUT    /api/admin/announcements/:id    { title?, content?, active? }
 *   DELETE /api/admin/announcements/:id
 */
import express from 'express';
import { authMiddleware, adminMiddleware } from './auth.js';
import {
  listAnnouncements, getAnnouncement, insertAnnouncement, updateAnnouncement, deleteAnnouncement,
} from './db.js';

export const publicRouter = express.Router();

publicRouter.get('/', (_req, res) => {
  res.json(listAnnouncements(true));
});

export const adminRouter = express.Router();
adminRouter.use(authMiddleware, adminMiddleware);

adminRouter.get('/', (_req, res) => {
  res.json(listAnnouncements(false));
});

adminRouter.post('/', (req, res) => {
  const { title, content, active = 1 } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: '标题和内容必填' });
  if (String(title).length > 60) return res.status(400).json({ error: '标题最多 60 字' });
  if (String(content).length > 1000) return res.status(400).json({ error: '内容最多 1000 字' });
  const row = insertAnnouncement({ title: String(title), content: String(content), active });
  res.json(row);
});

adminRouter.put('/:id', (req, res) => {
  const { title, content, active } = req.body || {};
  if (title !== undefined && String(title).length > 60) return res.status(400).json({ error: '标题最多 60 字' });
  if (content !== undefined && String(content).length > 1000) return res.status(400).json({ error: '内容最多 1000 字' });
  const row = updateAnnouncement(req.params.id, { title, content, active });
  if (!row) return res.status(404).json({ error: '公告不存在' });
  res.json(row);
});

adminRouter.delete('/:id', (req, res) => {
  if (!getAnnouncement(req.params.id)) return res.status(404).json({ error: '公告不存在' });
  deleteAnnouncement(req.params.id);
  res.json({ ok: true });
});
