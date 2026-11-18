#!/usr/bin/env node
/**
 * 10 房间 × 30 人并发压测（README §20 Sprint 4 的最后一项）
 *
 * 干什么：
 *   1. 批量注册 / 登录 N 个账号（默认 300，可复用同名账号）
 *   2. 每个账号建一条 WebSocket（`/chat?room=N`），均匀铺到 R 个房间（默认 10）
 *   3. 按生产节奏上报位置（默认 0.5Hz = 每 2s），并随机做真实动作（捡金币 / 上报走路 / 拉 state / 领分红 / 膜拜）
 *   4. 全程统计：HTTP 延迟分位、WS `players` 推送间隔抖动、带宽、错误码分布、断线数、服务端 /health 响应
 *   5. 可选 `--db <path>` 采样 SQLite 文件大小/写入，量化 sql.js「每次 run() 全量覆盖写盘」的写放大
 *
 * 用法：
 *   # 一定要指向一个**独立库**的后端，别打开发库：
 *   DB_PATH=data/stress.db PORT=3011 node server/index.js
 *   node scripts/stress.mjs --url http://localhost:3011 --db data/stress.db --seconds 60
 *
 * 常用参数：
 *   --users 300        账号数（默认 300）
 *   --rooms 10         房间数（默认 10，上限同服务端 MAX_ROOMS=10，每房 ≤30 人）
 *   --seconds 60       压测时长
 *   --pos-hz 0.5       每人每秒位置上报次数（生产 0.5）
 *   --state-hz 0.02    每人每秒拉 /api/game/state 次数（生产只在进游戏/动作后拉，默认只给很轻的背景压力）
 *   --action-ms 4000   每人两次动作之间的平均间隔
 *   --no-actions       只跑连接 + 位置同步（纯净的房间广播压力）
 *   --prefix qgstress  账号名前缀（默认带时间戳，方便复用/清理）
 *   --cluster          虚拟玩家聚在出生点 ±15m（配合浏览器测「30 人同房间」帧率）
 *   --db path          采样该 SQLite 文件的大小变化（估算写放大）
 *   --out report.json  把结果写成 JSON
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import WebSocket from 'ws';

// ---------------- 参数 ----------------
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = argv[argv.indexOf(hit) + 1];
  return next && !next.startsWith('--') ? next : true;
};
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const flag = (name) => argv.includes(`--${name}`);

const CFG = {
  url: String(arg('url', 'http://localhost:3003')).replace(/\/+$/, ''),
  users: Math.min(600, num(arg('users', 300), 300)),
  rooms: Math.min(10, Math.max(1, num(arg('rooms', 10), 10))),
  seconds: Math.max(5, num(arg('seconds', 60), 60)),
  posHz: Math.max(0, num(arg('pos-hz', 0.5), 0.5)),
  // 生产里 state 只在进游戏 / 动作后拉，不是常驻轮询；这里给个很轻的背景频率，避免它盖过其他指标
  stateHz: Math.max(0, num(arg('state-hz', 0.02), 0.02)),
  actionMs: Math.max(500, num(arg('action-ms', 4000), 4000)),
  actions: !flag('no-actions'),
  prefix: String(arg('prefix', `qgstress${Date.now().toString(36).slice(-5)}`)),
  dbPath: arg('db', null) ? String(arg('db', null)) : null,
  outPath: arg('out', null) ? String(arg('out', null)) : null,
  seed: num(arg('seed', 1), 1),
  // 聚成一团（默认在出生点 ±15m），用于浏览器帧率实测：让远端玩家真的出现在视野里
  cluster: flag('cluster'),
};

if (CFG.users > CFG.rooms * 30) {
  console.error(`× 房间装不下：${CFG.rooms} × 30 = ${CFG.rooms * 30} < ${CFG.users} 人`);
  process.exit(1);
}

// ---------------- 小工具 ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms，单调时钟
let rngState = CFG.seed * 2654435761 % 4294967296;
/** 可复现的伪随机（同一 seed 结果一致，便于对比两次改动） */
function rand() {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samples) {
  if (!samples.length) return { n: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    avg: +(sum / s.length).toFixed(2),
    p50: +percentile(s, 50).toFixed(2),
    p95: +percentile(s, 95).toFixed(2),
    p99: +percentile(s, 99).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
  };
}

const fmtMs = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(0)}ms`);
const fmtBytes = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

// ---------------- 指标容器 ----------------
const metrics = {
  http: new Map(),        // "POST /api/game/collect" -> { lat: [], errors: Map, statuses: Map }
  httpStatus: new Map(),  // status -> count
  wsConnect: [],          // 建连+握手耗时
  wsConnectFail: new Map(),
  wsPlayerGaps: [],       // players 推送间隔（应接近 1000ms）
  wsPlayersCount: 0,
  wsBytes: 0,
  wsError: new Map(),     // 服务端 error.code -> count
  httpError: new Map(),   // 客户端网络错误（ECONNRESET 等）-> count
  wsCloseUnexpected: 0,
  health: [],
  actions: new Map(),     // 动作名 -> 次数
  writes: 0,              // 会写库的请求数（sql.js 每次 run() 都全量覆盖写盘）
};

/** 这些路由会写库（收购/升级/踢馆/捡金币/任务/膜拜） */
const WRITE_ROUTES = new Set([
  'POST /api/game/collect',
  'POST /api/game/quests/walked',
  'POST /api/game/worship',
  'POST /api/game/dividend',
  'POST /api/game/acquire',
  'POST /api/game/upgrade',
  'POST /api/game/attack',
  'POST /api/game/defend',
  'POST /api/game/surrender',
  'POST /api/game/quests/claim',
]);

function recordHttp(route, status, ms) {
  let entry = metrics.http.get(route);
  if (!entry) {
    entry = { lat: [], errors: new Map() };
    metrics.http.set(route, entry);
  }
  entry.lat.push(ms);
  if (status >= 400) entry.errors.set(status, (entry.errors.get(status) || 0) + 1);
  metrics.httpStatus.set(status, (metrics.httpStatus.get(status) || 0) + 1);
  if (status >= 200 && status < 300 && WRITE_ROUTES.has(route)) metrics.writes += 1;
}

// 自己管 keep-alive（keepAliveMsecs 1s < 服务端 keepAliveTimeout 5s），
// 避免全局 fetch/undici 复用服务端已关闭的 socket，产生 ECONNRESET 假错误
const TARGET = new URL(CFG.url);
const IS_TLS = TARGET.protocol === 'https:';
const agent = (IS_TLS ? https : http).Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 256, maxFreeSockets: 48 });

function request(path, method, token, body) {
  return new Promise((resolve) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = (IS_TLS ? https : http).request({
      protocol: TARGET.protocol,
      hostname: TARGET.hostname,
      port: TARGET.port || (IS_TLS ? 443 : 80),
      path,
      method,
      agent,
      timeout: 30_000,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      res.resume(); // 丢弃 body，让 socket 可以复用
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('timeout', () => req.destroy(new Error('client-timeout')));
    req.on('error', (err) => resolve({ status: -1, error: err.code || err.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function call(route, method, path, token, body) {
  const t0 = now();
  const res = await request(path, method, token, body);
  if (res.status === -1) {
    const key = res.error || 'network';
    metrics.httpError.set(key, (metrics.httpError.get(key) || 0) + 1);
  }
  recordHttp(route, res.status, now() - t0);
  return res;
}

// ---------------- 账号准备 ----------------
async function ensureUsers() {
  const accounts = [];
  const concurrency = 20;
  let cursor = 0;
  const password = 'stress-pass-123';

  async function worker() {
    while (cursor < CFG.users) {
      const i = cursor++;
      const username = `${CFG.prefix}_${i}`;
      const nickname = `压测${String(i).padStart(3, '0')}`;
      // 先试登录（重复跑时省掉 bcrypt 注册开销），失败再注册
      let res = await fetch(`${CFG.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      let data = await res.json().catch(() => ({}));
      if (!res.ok) {
        res = await fetch(`${CFG.url}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, nickname, variant: i % 2 ? 'female' : 'male' }),
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`注册失败 ${username}: ${data.error || res.status}`);
      }
      accounts[i] = { id: data.user?.id, token: data.token, username, room: 1 + (i % CFG.rooms) };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return accounts;
}

// ---------------- 单个虚拟玩家 ----------------
class Bot {
  constructor(account, index) {
    this.account = account;
    this.index = index;
    this.ws = null;
    this.connected = false;
    this.lastPlayersAt = 0;
    this.alive = true;
    if (CFG.cluster) {
      this.x = -14 + rand() * 28;
      this.z = -45 + rand() * 28;
    } else {
      this.x = -3 + rand() * 6;
      this.z = -20 - rand() * 400;
    }
    this.yaw = rand() * Math.PI * 2;
  }

  connect() {
    return new Promise((resolve) => {
      const t0 = now();
      const wsUrl = `${CFG.url.replace(/^http/, 'ws')}/chat?room=${this.account.room}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let settled = false;

      const fail = (reason) => {
        if (settled) return;
        settled = true;
        metrics.wsConnectFail.set(reason, (metrics.wsConnectFail.get(reason) || 0) + 1);
        try { ws.terminate(); } catch { /* 忽略 */ }
        resolve(false);
      };

      this.timer = setTimeout(() => fail('handshake-timeout'), 12_000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', payload: { token: this.account.token } }));
      });

      ws.on('message', (raw) => {
        metrics.wsBytes += raw.length;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'welcome') {
          if (settled) return;
          settled = true;
          clearTimeout(this.timer);
          metrics.wsConnect.push(now() - t0);
          this.connected = true;
          resolve(true);
          return;
        }
        if (msg.type === 'players') {
          const t = now();
          if (this.lastPlayersAt) metrics.wsPlayerGaps.push(t - this.lastPlayersAt);
          this.lastPlayersAt = t;
          metrics.wsPlayersCount += 1;
          return;
        }
        if (msg.type === 'error') {
          const code = msg.payload?.code || msg.payload?.msg || 'unknown';
          metrics.wsError.set(code, (metrics.wsError.get(code) || 0) + 1);
          // 满房 / 握手失败：这条连接作废
          if (code === 'room-full' || /登录失效/.test(code)) fail(code);
        }
      });

      ws.on('error', () => fail('ws-error'));
      ws.on('close', () => {
        // 只统计非主动断开的连接（收尾时我们自己 close 的不算服务端不稳）
        if (this.alive) metrics.wsCloseUnexpected += 1;
        this.connected = false;
        if (!settled) fail('closed');
      });
    });
  }

  sendPosition() {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) return;
    // 在出生点附近小幅游走，模拟真实玩家
    this.x += (rand() - 0.5) * 1.2;
    this.z += (rand() - 0.5) * 1.2;
    this.yaw += (rand() - 0.5) * 0.4;
    this.ws.send(JSON.stringify({ type: 'position', payload: { x: +this.x.toFixed(2), z: +this.z.toFixed(2), yaw: +this.yaw.toFixed(3) } }));
  }

  close() {
    this.alive = false;
    clearTimeout(this.timer);
    try { this.ws?.close(); } catch { /* 忽略 */ }
  }
}

// ---------------- 动作（真实接口，金额/冷却都由服务端定） ----------------
async function doAction(bot, top1UserId) {
  const { token } = bot.account;
  const roll = rand();

  if (roll < 0.55) {
    metrics.actions.set('collect', (metrics.actions.get('collect') || 0) + 1);
    await call('POST /api/game/collect', 'POST', '/api/game/collect', token, { type: 'coin' });
    return;
  }
  if (roll < 0.85) {
    metrics.actions.set('walked', (metrics.actions.get('walked') || 0) + 1);
    await call('POST /api/game/quests/walked', 'POST', '/api/game/quests/walked', token, { meters: Math.round(10 + rand() * 40) });
    return;
  }
  if (roll < 0.97 || !top1UserId) {
    metrics.actions.set('state', (metrics.actions.get('state') || 0) + 1);
    await call('GET /api/game/state', 'GET', '/api/game/state', token);
    return;
  }
  metrics.actions.set('worship', (metrics.actions.get('worship') || 0) + 1);
  await call('POST /api/game/worship', 'POST', '/api/game/worship', token, { userId: top1UserId });
}

// ---------------- 采样 ----------------
function sampleHealth() {
  const t0 = now();
  return request('/api/health', 'GET').then(() => metrics.health.push(now() - t0));
}

function dbSize() {
  try {
    return fs.statSync(CFG.dbPath).size;
  } catch {
    return 0;
  }
}

// ---------------- 主流程 ----------------
async function main() {
  console.log('青果巷压测 · 10 房间 × 30 人');
  console.log(`  目标      ${CFG.url}`);
  console.log(`  规模      ${CFG.users} 人 / ${CFG.rooms} 房 / ${CFG.seconds}s（位置 ${CFG.posHz}Hz，动作 ${CFG.actions ? `每 ~${CFG.actionMs}ms` : '关闭'}）`);
  console.log(`  账号前缀  ${CFG.prefix}\n`);

  const health0 = await fetch(`${CFG.url}/api/health`).catch(() => null);
  if (!health0 || !health0.ok) {
    console.error(`× 后端不可用：${CFG.url}/api/health`);
    process.exit(1);
  }

  console.log('[1/4] 准备账号…');
  const tReg = now();
  const accounts = await ensureUsers();
  console.log(`      ${accounts.length} 个账号就绪（${((now() - tReg) / 1000).toFixed(1)}s）`);

  console.log('[2/4] 建立 WebSocket 连接…');
  const bots = accounts.map((a, i) => new Bot(a, i));
  const tConn = now();
  const results = await Promise.all(bots.map((b) => b.connect()));
  const connected = bots.filter((b, i) => results[i]);
  console.log(`      ${connected.length}/${bots.length} 连接成功（${((now() - tConn) / 1000).toFixed(1)}s）`);

  // 找一个能膜拜的首富（没有就跳过膜拜动作）
  let top1UserId = null;
  try {
    const res = await fetch(`${CFG.url}/api/game/state`, { headers: { Authorization: `Bearer ${connected[0]?.account.token}` } });
    const state = await res.json();
    top1UserId = state?.top1?.userId || null;
  } catch { /* 没有首富也能压 */ }

  console.log(`[3/4] 施压 ${CFG.seconds}s…（Ctrl+C 提前结束并出报告）`);
  const dbBefore = CFG.dbPath ? dbSize() : 0;
  const startedAt = now();
  let stopped = false;
  let cpuUser0 = process.cpuUsage().user;
  let cpuSystem0 = process.cpuUsage().system;

  // 位置上报：统一 250ms tick，按每人 posHz 控制频次
  const posTimer = setInterval(() => {
    for (const bot of connected) bot.sendPosition();
  }, Math.max(50, Math.round(1000 / Math.max(CFG.posHz, 0.5))));

  // state 轮询（比位置稀疏，单独定时）
  const stateTimer = setInterval(() => {
    const sample = connected.filter(() => rand() < CFG.stateHz);
    for (const bot of sample) {
      metrics.actions.set('state', (metrics.actions.get('state') || 0) + 1);
      call('GET /api/game/state', 'GET', '/api/game/state', bot.account.token);
    }
  }, 1000);

  const healthTimer = setInterval(() => { sampleHealth(); }, 2000);

  // 真实动作：每个 bot 维护自己的下一次动作时间
  const actionTimers = [];
  if (CFG.actions) {
    for (const bot of connected) {
      const tick = () => {
        if (stopped || !bot.alive) return;
        doAction(bot, top1UserId).catch(() => {});
        const jitter = 0.5 + rand();
        actionTimers.push(setTimeout(tick, Math.round(CFG.actionMs * jitter)));
      };
      actionTimers.push(setTimeout(tick, Math.round(rand() * CFG.actionMs)));
    }
  }

  const cpuBefore = process.cpuUsage();
  const cpuT0 = now();

  await new Promise((resolve) => {
    const stop = () => { stopped = true; resolve(); };
    const deadline = setTimeout(stop, CFG.seconds * 1000);
    process.once('SIGINT', () => { clearTimeout(deadline); stop(); });
  });

  clearInterval(posTimer);
  clearInterval(stateTimer);
  clearInterval(healthTimer);
  actionTimers.forEach(clearTimeout);

  const elapsed = (now() - startedAt) / 1000;
  const dbAfter = CFG.dbPath ? dbSize() : 0;
  const cpu = process.cpuUsage(cpuBefore);
  const cpuTotalMs = (cpu.user + cpu.system) / 1000;
  const cpuCores = cpuTotalMs / 1000 / Math.max(elapsed, 1);
  void cpuUser0; void cpuSystem0; void cpuT0;

  console.log('[4/4] 断开连接…');
  bots.forEach((b) => { b.close(); }); // close() 内会置 alive=false，断线统计不受影响
  await sleep(400);

  // ---------------- 报告 ----------------
  const http = {};
  let totalReq = 0;
  let totalErr = 0;
  for (const [route, entry] of [...metrics.http.entries()].sort()) {
    const errs = [...entry.errors.entries()].map(([s, c]) => `${s}×${c}`).join(' ') || '-';
    http[route] = { ...summarize(entry.lat), errors: errs };
    totalReq += entry.lat.length;
    totalErr += [...entry.errors.values()].reduce((a, b) => a + b, 0);
  }

  const gaps = summarize(metrics.wsPlayerGaps);
  const connectStats = summarize(metrics.wsConnect);
  const health = summarize(metrics.health);
  const roomCounts = {};
  for (const bot of connected) roomCounts[bot.account.room] = (roomCounts[bot.account.room] || 0) + 1;

  const report = {
    config: CFG,
    elapsedSec: +elapsed.toFixed(2),
    connections: {
      ok: connected.length,
      failed: bots.length - connected.length,
      failures: Object.fromEntries(metrics.wsConnectFail),
      handshakeMs: connectStats,
      rooms: roomCounts,
    },
    websocket: {
      playersMessages: metrics.wsPlayersCount,
      msgsPerSecTotal: +(metrics.wsPlayersCount / Math.max(elapsed, 1)).toFixed(1),
      msgsPerConnPerSec: +(metrics.wsPlayersCount / Math.max(connected.length, 1) / Math.max(elapsed, 1)).toFixed(2),
      pushGapMs: gaps,
      bandwidthKBps: +(metrics.wsBytes / 1024 / Math.max(elapsed, 1)).toFixed(1),
      closesUnexpected: metrics.wsCloseUnexpected,
      errors: Object.fromEntries(metrics.wsError),
    },
    dbWrites: {
      writes: metrics.writes,
      writesPerSec: +(metrics.writes / Math.max(elapsed, 1)).toFixed(1),
      // sql.js：每次 run() 都把整份内存库导出并覆盖写盘
      estimatedBytesWritten: metrics.writes * (CFG.dbPath ? Math.max(dbBefore, dbAfter) : 0),
    },
    http: {
      requests: totalReq,
      rps: +(totalReq / Math.max(elapsed, 1)).toFixed(1),
      errorRate: totalReq ? +((totalErr / totalReq) * 100).toFixed(2) : 0,
      statuses: Object.fromEntries(metrics.httpStatus),
      networkErrors: Object.fromEntries(metrics.httpError),
      byRoute: http,
    },
    serverHealthMs: health,
    actions: Object.fromEntries(metrics.actions),
    clientCpu: { seconds: +(cpuTotalMs / 1000).toFixed(2), cores: +cpuCores.toFixed(2) },
    db: CFG.dbPath
      ? { beforeBytes: dbBefore, afterBytes: dbAfter, growthBytes: dbAfter - dbBefore }
      : null,
  };

  printReport(report);

  if (CFG.outPath) {
    fs.writeFileSync(CFG.outPath, JSON.stringify(report, null, 2));
    console.log(`\n报告已写入 ${CFG.outPath}`);
  }
  process.exit(0);
}

function printReport(r) {
  const line = '─'.repeat(72);
  console.log(`\n${line}\n结果（${r.elapsedSec}s 压测）\n${line}`);

  console.log(`连接   成功 ${r.connections.ok} / 失败 ${r.connections.failed}` +
    ` · 握手 p50 ${fmtMs(r.connections.handshakeMs.p50)} / p95 ${fmtMs(r.connections.handshakeMs.p95)}`);
  if (Object.keys(r.connections.failures).length) {
    console.log(`       失败原因 ${JSON.stringify(r.connections.failures)}`);
  }

  console.log(`广播   players ${r.websocket.playersMessages} 条` +
    ` · ${r.websocket.msgsPerSecTotal}/s 总量 · 每连接 ${r.websocket.msgsPerConnPerSec}/s` +
    ` · 推送间隔 p50 ${fmtMs(r.websocket.pushGapMs.p50)} p95 ${fmtMs(r.websocket.pushGapMs.p95)}（目标 1000ms）`);
  console.log(`       下行带宽 ${r.websocket.bandwidthKBps} KB/s · 意外断线 ${r.websocket.closesUnexpected}` +
    (Object.keys(r.websocket.errors).length ? ` · WS 错误 ${JSON.stringify(r.websocket.errors)}` : ''));

  console.log(`HTTP   ${r.http.requests} 次 · ${r.http.rps} rps · 错误率 ${r.http.errorRate}%` +
    ` · status ${JSON.stringify(r.http.statuses)}`);
  if (Object.keys(r.http.networkErrors || {}).length) {
    console.log(`       客户端网络错误 ${JSON.stringify(r.http.networkErrors)}（压测机 socket 层，非服务端响应）`);
  }
  for (const [route, s] of Object.entries(r.http.byRoute)) {
    console.log(`       ${route.padEnd(30)} n=${String(s.n).padStart(5)}  p50 ${fmtMs(s.p50).padStart(6)}  p95 ${fmtMs(s.p95).padStart(7)}  p99 ${fmtMs(s.p99).padStart(7)}  max ${fmtMs(s.max).padStart(7)}  ${s.errors !== '-' ? `错误 ${s.errors}` : ''}`);
  }

  console.log(`健康   /api/health p50 ${fmtMs(r.serverHealthMs.p50)} · p95 ${fmtMs(r.serverHealthMs.p95)} · max ${fmtMs(r.serverHealthMs.max)}` +
    `（负载下的服务端响应能力）`);
  console.log(`动作   ${JSON.stringify(r.actions)}`);
  console.log(`客户端 CPU ${r.clientCpu.cores} 核（压测机自身开销，非服务端）`);
  if (r.db) {
    console.log(`SQLite ${r.dbWrites.writes} 次写库（${r.dbWrites.writesPerSec}/s）→ 估算写盘 ${fmtBytes(r.dbWrites.estimatedBytesWritten)}` +
      `（每次 run() 全量覆盖，库体积 ${fmtBytes(r.db.afterBytes)}）`);
  }
  console.log(line);
}

main().catch((err) => {
  console.error('压测失败:', err);
  process.exit(1);
});
