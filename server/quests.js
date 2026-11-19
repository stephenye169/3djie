/**
 * 商业任务系统（GDD 4.2）
 *
 * 固定 4 个常驻任务，玩家达成进度后可随时领取一次性奖励。
 * 进度完全由服务端事件累加，不能从前端直接领。
 *
 *   POST /api/game/quests/walked  { meters }      前端定期上报走路米数（累加）
 *   POST /api/game/quests/claim   { questId }     领取奖励（只能 claim 一次）
 *
 * 事件埋点（内部 helper）：
 *   quest(userId, QUEST_COIN_BOX, 1)     treasure.js collect(type==='box')
 *   quest(userId, QUEST_BULLY, 1)        treasure.js bully
 *   quest(userId, QUEST_SHOP_COUNT, n)   game.js acquire / sell（用持有店铺数覆盖）
 *   quest(userId, QUEST_WALK, meters)    前端定期上报
 *   quest(userId, QUEST_DEFEND, 1)       capital.js defend
 *   quest(userId, QUEST_CAPTURE, 1)      capital.js resolveCapture
 */
import express from 'express';
import { query, run } from './db.js';
import { authMiddleware } from './auth.js';
import { settle } from './economy.js';
import { formatMoney } from '../shared/assets.js';

export const QUEST_COIN_BOX = 'coin_box';
export const QUEST_BULLY = 'bully';
export const QUEST_WALK = 'walk';
export const QUEST_DEFEND = 'defend';
export const QUEST_CAPTURE = 'capture';

export const QUEST_DEFS = {
  [QUEST_COIN_BOX]: {
    id: QUEST_COIN_BOX,
    title: '财阀金币箱猎人',
    desc: '在青果巷捡到 3 个金色大宝箱',
    goal: 3,
    reward: 500_000,
    unit: '个',
  },
  [QUEST_BULLY]: {
    id: QUEST_BULLY,
    title: '打脸名场面',
    desc: '找势利眼 NPC 碰瓷一次',
    goal: 1,
    reward: 1_000_000,
    unit: '次',
  },
  [QUEST_WALK]: {
    id: QUEST_WALK,
    title: '百步穿街',
    desc: '在青果巷步行累计 2000 米',
    goal: 2000,
    reward: 300_000,
    unit: '米',
  },
  [QUEST_DEFEND]: {
    id: QUEST_DEFEND,
    title: '护盘大鳄',
    desc: '成功保住自家店铺一次',
    goal: 1,
    reward: 1_500_000,
    unit: '次',
  },
  [QUEST_CAPTURE]: {
    id: QUEST_CAPTURE,
    title: '野蛮收购',
    desc: '从其他玩家手里抢下一家店',
    goal: 1,
    reward: 3_000_000,
    unit: '家',
  },
};

/**
 * 事件累加：服务端任何地方调用 quest(userId, type, delta) 即可
 * 超过 goal 后进度会停在 goal，不会继续涨。
 */
export function questProgress(userId, type, delta = 1) {
  const def = QUEST_DEFS[type];
  if (!def) return;
  if (delta <= 0) return;

  const row = query(
    'SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND quest_id = ?',
    [userId, type]
  )[0];

  if (row && Number(row.claimed)) return; // 已经领过了

  const newProgress = Math.min((Number(row?.progress) || 0) + delta, def.goal);
  run(
    `INSERT INTO quest_progress (user_id, quest_id, progress, claimed)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(user_id, quest_id) DO UPDATE SET progress = excluded.progress`,
    [userId, type, newProgress]
  );
}

/** 给玩家的完整任务面板数据 */
export function questsFor(userId) {
  const rows = query(
    'SELECT quest_id, progress, claimed FROM quest_progress WHERE user_id = ?',
    [userId]
  );
  const map = new Map(rows.map((r) => [r.quest_id, r]));

  return Object.values(QUEST_DEFS).map((def) => {
    const row = map.get(def.id);
    const progress = Math.min(Number(row?.progress) || 0, def.goal);
    return {
      id: def.id,
      title: def.title,
      desc: def.desc,
      goal: def.goal,
      progress,
      reward: def.reward,
      claimed: !!Number(row?.claimed),
      done: progress >= def.goal,
      unit: def.unit,
    };
  });
}

// ---- HTTP 路由 ----
const router = express.Router();

router.get('/quests', authMiddleware, (req, res) => {
  res.json({ ok: true, quests: questsFor(req.user.id) });
});

router.post('/quests/claim', authMiddleware, (req, res) => {
  const questId = String(req.body?.questId || '');
  const def = QUEST_DEFS[questId];
  if (!def) return res.status(400).json({ error: '任务不存在' });

  settle(req.user.id);
  const row = query(
    'SELECT progress, claimed FROM quest_progress WHERE user_id = ? AND quest_id = ?',
    [req.user.id, questId]
  )[0];
  if (!row) {
    return res.status(409).json({ error: '任务尚未完成' });
  }
  if (Number(row.claimed)) {
    return res.status(409).json({ error: '已经领取过了' });
  }
  const progress = Number(row.progress);
  if (progress < def.goal) {
    return res.status(409).json({
      error: `还差 ${def.goal - progress}${def.unit}`,
      progress, goal: def.goal,
    });
  }

  run('UPDATE quest_progress SET claimed = 1 WHERE user_id = ? AND quest_id = ?', [req.user.id, questId]);
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [def.reward, req.user.id]);

  const balance = Number(query('SELECT balance FROM users WHERE id = ?', [req.user.id])[0]?.balance) || 0;
  res.json({
    ok: true,
    reward: def.reward,
    questId,
    balance,
    label: `【任务完成】${def.title}：+${formatMoney(def.reward)}`,
  });
});

/** 客户端定期上报走路距离（累加），每秒最多算一次 */
let lastWalkTs = 0;
router.post('/quests/walked', authMiddleware, (req, res) => {
  const now = Date.now();
  // 节流：前端可能频繁上报，累加后直接塞给 questProgress 即可（它有 min 上限）
  if (now - lastWalkTs < 200) {
    return res.json({ ok: true, throttled: true, quests: questsFor(req.user.id) });
  }
  lastWalkTs = now;

  const meters = Number(req.body?.meters);
  if (!Number.isFinite(meters) || meters <= 0 || meters > 300) {
    return res.status(400).json({ error: 'meters 不合法' });
  }

  questProgress(req.user.id, QUEST_WALK, meters);
  // 回传最新任务面板：前端只需回填 quests，不必再拉一次整包 /api/game/state
  res.json({ ok: true, quests: questsFor(req.user.id) });
});

export default router;
