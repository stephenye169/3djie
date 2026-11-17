/**
 * WebSocket 私聊 + 多人位置同步
 *
 * 消息协议（JSON，统一 envelope）：
 *   { type, payload }
 *
 * 客户端 → 服务端：
 *   hello      { token }                        鉴权 + 自我介绍
 *   position   { x, z, yaw }                    位置上报（每 2s 一次，仅用于在线列表）
 *   dm         { to, text }                     私聊（仅收发双方可见）
 *   dm_history { with, limit? }                 拉取与某人的私聊记录
 *   block      { to }                           拉黑
 *   unblock    { to }                           解除拉黑
 *
 * 服务端 → 客户端：
 *   welcome    { self, online: [...], blocked, room } 登录成功（online = 本房间在线列表）
 *   players    [{ id, nickname, variant, title, x, z, yaw }] 本房间在线列表，每秒推送
 *   dm         { from: {id, nickname}, to, text, ts }
 *   dm_history { with, messages: [{from,to,text,ts}] }
 *   blocked    { blocked: [id] }                拉黑列表回执
 *   error      { msg, code }                    例如 code: "blocked" / "room-full"
 *
 * 多房间分流（README 11.5）：
 *   - 连接 URL 带 /chat?room=<id>（1–10），每房 ≤30 人，满房在 hello 阶段拒绝
 *   - players 推送只发本房间；battle 战报仍是全局广播（弹幕跨房间同步）
 *   - 世界状态（资产/踢馆/冷却）不感知房间，全服唯一
 */
import jwt from 'jsonwebtoken';
import {
  findUserById, appendMessage, messagesBetween,
  listBlockedIds, isBlockedEither, addBlock, removeBlock,
} from './db.js';
import { JWT_SECRET } from './auth.js';
import { counterOffer, counterReply } from './capital.js';

export const MAX_ROOMS = 10;         // 房间编号上限：1–10
export const ROOM_CAPACITY = 30;     // 每房人数上限（按去重后的在线用户计）

const randomId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// userId → { user, x, z, yaw, lastSeen }
const players = new Map();
// userId → Set<WebSocket>
const connections = new Map();
// roomId → Set<WebSocket>（房间分流：players 推送只覆盖本房间）
const rooms = new Map();

// ---- 全服聊天频道（GDD §5.3）----
const globalRecent = [];         // 最近 50 条全服消息（内存，重启即清——GDD 无持久化要求）
const GLOBAL_KEEP = 50;
const GLOBAL_COOLDOWN_MS = 3000; // 每 3 秒最多发 1 条（防刷屏）
const globalCooldown = new Map(); // userId → 上次发言时间

/** 从连接 URL 解析房间号：/chat?room=N，非法或缺省 → 1 */
function parseRoom(req) {
  const m = /[?&]room=(\d+)/.exec(req.url || '');
  const id = m ? Number(m[1]) : NaN;
  return Number.isInteger(id) && id >= 1 && id <= MAX_ROOMS ? id : 1;
}

/** 房间内去重在线用户数（同一用户多连接算 1 人） */
function roomUserCount(roomId) {
  const set = rooms.get(roomId);
  if (!set) return 0;
  const ids = new Set();
  for (const ws of set) if (ws.userId) ids.add(ws.userId);
  return ids.size;
}

/** 向房间内所有连接广播 */
function broadcastRoom(roomId, msg) {
  const set = rooms.get(roomId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

/** 注册一个新的 WebSocket 连接 */
export function registerSocket(ws, req) {
  let userId = null;
  ws.room = parseRoom(req); // 连接级房间归属

  // 连接级心跳：只靠位置上报判断存活会误杀后台标签页的用户
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    try {
      switch (msg.type) {
        case 'hello': {
          userId = authenticate(msg.payload?.token);
          if (!userId) { ws.send(JSON.stringify({ type: 'error', payload: { msg: '登录失效，请重新进入游戏' } })); ws.close(); return; }
          joinPlayer(ws, userId, ws.room);
          break;
        }
        case 'position': {
          if (!userId) return;
          const { x, z, yaw } = msg.payload || {};
          if (typeof x === 'number' && typeof z === 'number') {
            const p = players.get(userId);
            if (!p) return; // 连接在但玩家已被清理：忽略，等待下次 hello
            p.x = x; p.z = z; p.yaw = yaw ?? 0;
          }
          break;
        }
        case 'counter_offer': {
          // 在线议价：被踢者还价（一次机会，服务端约束幅度）
          if (!userId) return;
          try {
            const payload = counterOffer(msg.payload?.attackId, userId, msg.payload?.price);
            ws.send(JSON.stringify({ type: 'counter_ack', payload }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: { msg: err.message, code: err.code || 'counter-error' } }));
          }
          break;
        }
        case 'counter_reply': {
          // 攻击方回应还价：accept=true 补差价成交 / false 还价作废照常对抗
          if (!userId) return;
          try {
            const result = counterReply(msg.payload?.attackId, userId, msg.payload?.accept === true);
            ws.send(JSON.stringify({ type: 'counter_reply_ack', payload: result }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: { msg: err.message, code: err.code || 'counter-error' } }));
          }
          break;
        }
        case 'global_chat': {
          // 全服聊天（广场）：跨房间广播，3s 限频，dnd 禁言
          if (!userId) return;
          const gtext = String(msg.payload?.text || '').trim().slice(0, 300);
          if (!gtext) return;
          try {
            sendGlobalChat(userId, gtext);
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', payload: { msg: err.message, code: err.code || 'global-error' } }));
          }
          break;
        }
        case 'dm': {
          if (!userId) return;
          const to = String(msg.payload?.to || '');
          const text = (msg.payload?.text || '').trim().slice(0, 500);
          if (!to || !text || to === userId) return;

          const sender = findUserById(userId);
          const receiver = findUserById(to);
          if (!receiver) {
            ws.send(JSON.stringify({ type: 'error', payload: { msg: '对方已不在线', code: 'no-user' } }));
            return;
          }
          if (players.get(userId)?.dnd) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { msg: '你已开启不想说话，恢复聊天后才能发送', code: 'sender-dnd' },
            }));
            return;
          }
          if (players.get(to)?.dnd) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { msg: '对方开启了不想说话，暂时无法接收消息', code: 'receiver-dnd' },
            }));
            return;
          }
          // 管理员禁止聊天（既不能发也不能收）— 发方
          if (sender?.chat_banned) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { msg: '你已被管理员禁止聊天，无法发送消息', code: 'sender-banned' },
            }));
            return;
          }
          // 管理员禁止聊天 — 收方
          if (receiver.chat_banned) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { msg: '对方已被管理员禁止聊天，消息无法送达', code: 'receiver-banned' },
            }));
            return;
          }
          if (isBlockedEither(userId, to)) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { msg: '已拉黑对方，或已被对方拉黑，无法发送消息', code: 'blocked' },
            }));
            return;
          }
          const payload = { ...buildChat(userId, text), to };
          sendToUser(userId, { type: 'dm', payload });
          sendToUser(to, { type: 'dm', payload });
          appendMessage({ scope: 'dm', to, ...buildChat(userId, text) });
          break;
        }
        case 'dnd': {
          if (!userId) return;
          const p = players.get(userId);
          if (!p) return;
          p.dnd = !!msg.payload?.enabled;
          sendToUser(userId, { type: 'dnd', payload: { enabled: p.dnd } });
          break;
        }
        case 'block': {
          if (!userId) return;
          const to = String(msg.payload?.to || '');
          if (!to || to === userId) return;
          addBlock(userId, to);
          ws.send(JSON.stringify({ type: 'blocked', payload: { blocked: listBlockedIds(userId) } }));
          break;
        }
        case 'unblock': {
          if (!userId) return;
          const to = String(msg.payload?.to || '');
          if (!to) return;
          removeBlock(userId, to);
          ws.send(JSON.stringify({ type: 'blocked', payload: { blocked: listBlockedIds(userId) } }));
          break;
        }
        case 'dm_history': {
          if (!userId) return;
          const withId = String(msg.payload?.with || '');
          if (!withId) return;
          const limit = Math.min(Math.max(msg.payload?.limit ?? 100, 1), 300);
          ws.send(JSON.stringify({
            type: 'dm_history',
            payload: { with: withId, messages: messagesBetween(userId, withId, limit) },
          }));
          break;
        }
        default: break;
      }
    } catch (err) {
      console.error('[ws] handle error:', err.message);
    }
  });

  ws.on('close', () => {
    if (!userId) return;
    const set = connections.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        connections.delete(userId);
        players.delete(userId);
      }
    }
    // 从房间移除，并刷新本房间的在线列表
    rooms.get(ws.room)?.delete(ws);
    if (rooms.get(ws.room)?.size === 0) rooms.delete(ws.room); // 空房间释放
    broadcastRoom(ws.room, { type: 'players', payload: buildNearbyList(ws.room) });
  });
}

function authenticate(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = findUserById(payload.sub);
    return user ? user.id : null;
  } catch { return null; }
}

function joinPlayer(ws, userId, roomId) {
  const user = findUserById(userId);
  if (!user) { ws.close(); return; }

  // 房间容量：按去重在线用户数校验（同一用户多连接算 1 人）
  if (roomUserCount(roomId) >= ROOM_CAPACITY) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: {
        msg: `房间 ${roomId} 已满（${ROOM_CAPACITY} 人），请点顶栏「换房」或重新进入`,
        code: 'room-full',
      },
    }));
    ws.close();
    return;
  }

  if (!connections.has(userId)) connections.set(userId, new Set());
  connections.get(userId).add(ws);
  ws.userId = userId;

  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);

  if (!players.has(userId)) {
    players.set(userId, { user, x: 0, z: 10, yaw: 0 });
  } else {
    // 同一用户多开：复用已有位置
    players.get(userId).user = user;
  }

  const online = buildNearbyList(roomId); // 本房间在线列表
  ws.send(JSON.stringify({
    type: 'welcome',
    payload: {
      self: {
        id: user.id, nickname: user.nickname, variant: user.variant, title: user.title,
      },
      room: roomId,
      online,
      globalHistory: globalRecent.slice(-30), // 全服频道最近 30 条
      blocked: listBlockedIds(userId),
      dnd: !!players.get(userId)?.dnd,
    },
  }));
  broadcastRoom(roomId, { type: 'players', payload: online });
}

/**
 * 全服聊天（广场）：跨房间广播给所有在线连接，内存暂存最近 50 条。
 * 限频 3 秒/条（防刷屏）；「不想说话」模式下禁止发言（与私聊同规则）。
 */
function sendGlobalChat(userId, text) {
  const p = players.get(userId);
  if (!p) throw new CrowdErrorLocal(409, '请先进入游戏再发言');
  if (p.dnd) throw new CrowdErrorLocal(409, '你已开启不想说话，恢复聊天后才能发言');

  const last = globalCooldown.get(userId) || 0;
  if (Date.now() - last < GLOBAL_COOLDOWN_MS) {
    throw new CrowdErrorLocal(429, `发言太频繁，请 ${Math.ceil((GLOBAL_COOLDOWN_MS - (Date.now() - last)) / 1000)} 秒后再试`);
  }
  globalCooldown.set(userId, Date.now());

  const msg = {
    id: randomId(),
    from: { id: userId, nickname: p.user.nickname, title: p.user.title },
    text,
    ts: Date.now(),
  };
  globalRecent.push(msg);
  while (globalRecent.length > GLOBAL_KEEP) globalRecent.shift();
  broadcastAll({ type: 'global_msg', payload: msg });
  return msg;
}

// 限频/状态错误的轻量错误类型（chat.js 内部使用）
class CrowdErrorLocal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function buildChat(userId, text) {
  const p = players.get(userId);
  return {
    from: { id: userId, nickname: p?.user?.nickname || '游客', variant: p?.user?.variant },
    text,
    ts: Date.now(),
  };
}

function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const set of connections.values()) {
    for (const ws of set) { if (ws.readyState === ws.OPEN) ws.send(data); }
  }
}

/** 全服广播收购战报（前端弹幕层消费） */
export function broadcastBattle(payload) {
  broadcastAll({ type: 'battle', payload });
}

/** 全服广播「首富易主 / 首富驾临」：跨房间，前端金色弹幕 + 排面（README §19 ③） */
export function broadcastTop1(payload) {
  broadcastAll({ type: 'top1', payload });
}

/** 发给某个用户的所有连接（离线则静默丢弃，历史仍可从 JSONL 拉取） */
export function sendToUser(userId, msg) {
  const set = connections.get(userId);
  if (!set) return;
  const data = JSON.stringify(msg);
  for (const ws of set) { if (ws.readyState === ws.OPEN) ws.send(data); }
}

/** 返回指定房间的在线玩家快照（房间内推送与 welcome 用；roomId 空则全量） */
export function buildNearbyList(roomId) {
  const out = [];
  if (roomId != null) {
    const roomSet = rooms.get(roomId);
    if (!roomSet || !roomSet.size) return out;
    const seen = new Set();
    for (const ws of roomSet) {
      const id = ws.userId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const p = players.get(id);
      if (!p) continue;
      out.push({
        id, nickname: p.user.nickname, variant: p.user.variant,
        title: p.user.title,
        x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +(p.yaw || 0).toFixed(3),
      });
    }
    return out;
  }
  for (const [id, p] of players.entries()) {
    out.push({
      id, nickname: p.user.nickname, variant: p.user.variant,
      title: p.user.title,
      x: +p.x.toFixed(2), z: +p.z.toFixed(2), yaw: +(p.yaw || 0).toFixed(3),
    });
  }
  return out;
}

/** 房间状态（供 GET /api/chat/rooms）：各房去重在线人数 */
export function roomStats() {
  const out = [];
  for (const roomId of rooms.keys()) {
    out.push({ id: roomId, count: roomUserCount(roomId), capacity: ROOM_CAPACITY });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** 每秒推送在线位置列表：按房间分流，每房只推自己的在线玩家 */
setInterval(() => {
  for (const [roomId, set] of rooms) {
    if (!set.size) continue;
    broadcastRoom(roomId, { type: 'players', payload: buildNearbyList(roomId) });
  }
}, 1000);

/** 每 30s 一次连接心跳：没回 pong 的连接直接断开（close 事件里会清理 players/connections/rooms） */
setInterval(() => {
  for (const set of connections.values()) {
    for (const ws of set) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }
}, 30000);

export { players, connections, rooms };