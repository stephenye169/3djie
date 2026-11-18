/**
 * 前端统一的后端调用入口
 *
 * - HTTP fetch：自动带 Bearer token，错误统一抛并 toast
 * - WebSocket 聊天客户端：鉴权握手 + 位置广播 + 消息监听
 * - token 存在 sessionStorage（key=qingguo_token）：
 *   每个标签页就是一个独立客户端，可各自注册并选择不同角色；
 *   刷新页面仍保持登录，关闭标签页后下次重新选角色
 */

const API_BASE = ''; // Vite dev proxy 会把 /api /chat 转到 3001；生产同域也直接用相对路径
const WS_PATH = '/chat';
const TOKEN_KEY = 'qingguo_token';

// ============ Token 管理 ============

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}

// ============ 房间选择（多房间分流，README 11.5） ============

const ROOM_KEY = 'qingguo_room';   // 记住上次所在房间（跨会话持久）
const DEFAULT_ROOM = 1;
const MAX_ROOM_ID = 10;

/** 当前所在房间（连接建立成功后才有值） */
let currentRoomId = null;
export function getRoomId() { return currentRoomId; }

/** 换房时下次选房要排除的房间（避免换房又回到原房间） */
let nextPickExclude = null;

/** 用户在房间列表里点选的房间（reconnectTo 设置，connect 时强制使用） */
let nextPickRoom = null;

/**
 * 选房策略：
 *   1. 优先上次所在的房间（有空位就回去，实现「下次进来还是那个房间」）
 *   2. 记忆房间已满 / 无记忆 / 被排除（主动换房）→ 自动选房：
 *      先填满已有玩家的房间（count 最大的未满房），都空则 1 号房
 */
export async function pickRoom() {
  const saved = Number(localStorage.getItem(ROOM_KEY)) || 0;
  const exclude = nextPickExclude;
  nextPickExclude = null;

  let rooms = [];
  try {
    const data = await (await fetch('/api/chat/rooms')).json();
    rooms = data?.rooms || [];
  } catch { /* 接口不可用时按空房处理 */ }

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const capacityOf = (id) => byId.get(id)?.capacity ?? 30;
  const countOf = (id) => byId.get(id)?.count ?? 0;
  const hasSlot = (id) => id >= 1 && id <= MAX_ROOM_ID && countOf(id) < capacityOf(id);

  // ① 上次的房间优先（空房不在 rooms 列表里，count=0 也有空位）
  if (saved >= 1 && saved <= MAX_ROOM_ID && saved !== exclude && hasSlot(saved)) {
    return saved;
  }

  // ② 自动选房：优先填满已有玩家的房间，尽量不开新房
  const candidates = [];
  for (let id = 1; id <= MAX_ROOM_ID; id++) {
    if (id === exclude || !hasSlot(id)) continue;
    candidates.push({ id, count: countOf(id) });
  }
  if (!candidates.length) return DEFAULT_ROOM; // 全满：兜底 1 号（服务端会拒绝并提示）
  candidates.sort((a, b) => b.count - a.count || a.id - b.id); // 人多的优先，平手选小号
  return candidates[0].id;
}

/** 记录进入的房间（welcome 确认后调用，以服务端为准） */
function rememberRoom(roomId) {
  if (roomId >= 1) localStorage.setItem(ROOM_KEY, String(roomId));
}

/** WS 连接 URL：带房间参数 /chat?room=N */
function wsUrl(room) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}?room=${room}`;
}

// ============ HTTP ============

async function http(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 401 = token 失效：清掉 token + 让上层决定是否跳登录
  if (res.status === 401) {
    setToken(null);
    const err = new Error('登录已过期，请重新进入游戏');
    err.status = 401;
    throw err;
  }

  let data = null;
  try { data = await res.json(); } catch { /* 空响应 */ }

  if (!res.ok) {
    const msg = data?.error || `请求失败 (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  register: (username, password, nickname, variant) =>
    http('POST', '/api/auth/register', { username, password, nickname, variant }),
  login: (username, password) =>
    http('POST', '/api/auth/login', { username, password }),
  me: () => http('GET', '/api/me'),
  shops: () => http('GET', '/api/shops'),
  products: (shopId) => http('GET', `/api/shops/${shopId}/products`),
  order: (product_id, qty = 1) =>
    http('POST', '/api/orders', { product_id, qty }),
  announcements: () => http('GET', '/api/announcements'),
  // 游戏数值与收购
  gameState: () => http('GET', '/api/game/state'),
  acquire: (assetId) => http('POST', '/api/game/acquire', { assetId }),
  upgrade: (assetId) => http('POST', '/api/game/upgrade', { assetId }),
  battles: () => http('GET', '/api/game/battles'),
  leaderboard: () => http('GET', '/api/game/leaderboard'),
  // 资本踢馆
  attack: (assetId) => http('POST', '/api/game/attack', { assetId }),
  defend: (attackId) => http('POST', '/api/game/defend', { attackId }),
  surrender: (attackId) => http('POST', '/api/game/surrender', { attackId }),
  // 街头经济
  collect: (type = 'coin') => http('POST', '/api/game/collect', { type }),
  bully: (npcId) => http('POST', '/api/game/bully', { npcId }),
  claimDividend: () => http('POST', '/api/game/dividend'),
  claimQuest: (questId) => http('POST', '/api/game/quests/claim', { questId }),
  walkedQuest: (meters) => http('POST', '/api/game/quests/walked', { meters }),
  grantIntro: () => http('POST', '/api/game/intro/grant'),
  // 首富排面：膜拜全服首富领红包
  worship: (userId) => http('POST', '/api/game/worship', { userId }),
  // 资本轮回
  prestige: () => http('POST', '/api/game/prestige'),
  learnTalent: (talentId) => http('POST', '/api/game/talents', { talentId }),
  // 地图点击传送（扣除 ¥10 万）
  teleport: (shopId) => http('POST', '/api/game/teleport', { shopId }),
  // 玩家资料卡（GDD §5.3）
  playerProfile: (userId) => http('GET', `/api/game/profile/${userId}`),
  // 全服聊天（广场）：跨房间广播，3s 限频
  sendGlobal: (text) => {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ type: 'global_chat', payload: { text } }));
    return true;
  },
  // 商品交易：我的订单记录 + 可用优惠券
  myOrders: () => http('GET', '/api/orders/my'),
  // 街区众筹扩建 + 股份分红
  crowdList: () => http('GET', '/api/crowd/list'),
  crowdCreate: (assetId) => http('POST', '/api/crowd/create', { assetId }),
  crowdInvest: (projectId, amount) => http('POST', '/api/crowd/invest', { projectId, amount }),
  crowdClaim: (projectId) => http('POST', '/api/crowd/claim', { projectId }),
};

// ============ WebSocket ============

/**
 * 聊天客户端（单例）
 *
 * 用法：
 *   const chat = createChatClient();
 *   chat.on('players', (list) => { ... });
 *   chat.on('dm', (msg) => { ... });
 *   chat.ready // 连接就绪后再发送
 *   chat.sendPosition(x, z, yaw);
 *   chat.dm(peerId, 'hi');
 *   chat.block(peerId) / chat.unblock(peerId);
 *   chat.dmHistory(peerId);
 */
export function createChatClient() {
  const listeners = new Map();
  let ws = null;
  let timerPos = null;
  let posPayload = null;
  let reconnectTimer = null;
  let manualClose = false;
  let reconnectTries = 0;
  let lastPositions = new Map(); // 用来过滤玩家位置抖动

  function on(type, cb) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(cb);
  }
  function off(type, cb) {
    listeners.get(type)?.delete(cb);
  }
  function emit(type, payload) {
    listeners.get(type)?.forEach((cb) => {
      try { cb(payload); } catch (e) { console.error('[chat listener error]', e); }
    });
  }

  function connect() {
    const token = getToken();
    if (!token) return; // 未登录不连
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return; // 已连接/连接中，避免重复

    manualClose = false;
    // 选房后连接：用户点选的房间优先（reconnectTo），否则自动选房
    // 房间满被拒时重连逻辑会自动重新选房
    const forced = nextPickRoom;
    nextPickRoom = null;
    const roomPromise = forced
      ? Promise.resolve(forced)
      : pickRoom();
    roomPromise
      .then((room) => {
        currentRoomId = room;
        ws = new WebSocket(wsUrl(room));
        bindSocket();
      })
      .catch(() => {
        currentRoomId = 1;
        ws = new WebSocket(wsUrl(1));
        bindSocket();
      });
  }

  /** 绑定 WebSocket 事件（连接建立后调用） */
  function bindSocket() {
    ws.onopen = () => {
      reconnectTries = 0;
      // 鉴权握手
      ws.send(JSON.stringify({ type: 'hello', payload: { token: getToken() } }));
      // 3 秒后发一次位置（如果已有）
      if (posPayload) {
        ws.send(JSON.stringify({ type: 'position', payload: posPayload }));
      }
      // 断线重连成功：通知上层补拉一次 state（补回断线窗口内错过的踢馆警报等）
      emit('open', null);
    };

    ws.onmessage = (raw) => {
      let msg;
      try { msg = JSON.parse(raw.data); } catch { return; }
      switch (msg.type) {
        case 'welcome':
          currentRoomId = msg.payload?.room ?? currentRoomId; // 服务端最终确认的房间
          rememberRoom(currentRoomId);                       // 记住这次进的房间
          emit('welcome', msg.payload);
          break;
        case 'players':
        case 'dm':
        case 'blocked':
        case 'dnd':
        case 'dm_history':
        case 'battle':
        case 'shop_attack':
        case 'shop_attack_result':
        case 'counter_pending':
        case 'counter_ack':
        case 'counter_rejected':
        case 'counter_reply_ack':
          emit(msg.type, msg.payload);
          break;
        case 'error':
          console.warn('[chat error]', msg.payload?.msg);
          if (msg.payload?.msg?.includes('登录失效')) {
            setToken(null);
            emit('auth-lost');
          }
          emit('error', msg.payload);
          break;
      }
    };

    ws.onclose = () => {
      ws = null;
      if (manualClose) return; // 主动关闭不再重连
      // 重连：2s 一次，最多 5 次
      if (reconnectTries >= 5) return;
      reconnectTries++;
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onerror = () => { /* 交给 onclose 处理重连 */ };
  }

  function close(stopReconnect = true) {
    manualClose = stopReconnect;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (timerPos) clearInterval(timerPos);
    timerPos = null;
    ws?.close();
    ws = null;
  }

  /** 换房：断开当前连接，重新选房（排除当前房间，避免又回到原房间） */
  function reconnect() {
    nextPickExclude = currentRoomId;
    close(false);
    setTimeout(connect, 200);
  }

  /** 指定房间重连（房间列表点选）：room 超界自动夹到 1–10，满房由服务端拒绝后自动换房兜底 */
  function reconnectTo(room) {
    const id = Math.max(1, Math.min(10, Math.floor(Number(room) || 0)));
    nextPickRoom = id;
    nextPickExclude = null;
    close(false);
    setTimeout(connect, 200);
  }

  function sendPosition(x, z, yaw = 0) {
    posPayload = { x, z, yaw };
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'position', payload: posPayload }));
  }

  /** 私聊：只有发送方和接收方能收到 */
  function dm(to, text) {
    const body = String(text || '').trim().slice(0, 500);
    if (!to || !body) return false;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ type: 'dm', payload: { to, text: body } }));
    return true;
  }

  function block(to) {
    if (!ws || ws.readyState !== 1 || !to) return false;
    ws.send(JSON.stringify({ type: 'block', payload: { to } }));
    return true;
  }

  function unblock(to) {
    if (!ws || ws.readyState !== 1 || !to) return false;
    ws.send(JSON.stringify({ type: 'unblock', payload: { to } }));
    return true;
  }

  function setDnd(enabled) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ type: 'dnd', payload: { enabled: !!enabled } }));
    return true;
  }

  function dmHistory(withId, limit = 100) {
    if (!ws || ws.readyState !== 1 || !withId) return false;
    ws.send(JSON.stringify({ type: 'dm_history', payload: { with: withId, limit } }));
    return true;
  }

  function isReady() {
    return !!ws && ws.readyState === 1;
  }

  /** 在线议价：被踢者还价（服务端校验幅度与每场一次） */
  function counterOffer(attackId, price) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ type: 'counter_offer', payload: { attackId, price } }));
    return true;
  }

  /** 在线议价：攻击方回应（accept=true 补差成交 / false 还价作废） */
  function counterReply(attackId, accept) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify({ type: 'counter_reply', payload: { attackId, accept: !!accept } }));
    return true;
  }

  return {
    connect, close, reconnect, reconnectTo,
    on, off,
    sendPosition, dm, block, unblock, setDnd, dmHistory,
    counterOffer, counterReply,
    get ready() { return isReady(); },
  };
}
