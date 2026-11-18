#!/usr/bin/env node
/**
 * 浏览器端真实 FPS 实测（README MVP 判定的最后一项）
 *
 * 用本机 Chrome 有头模式 + CDP 测，禁用 rAF 后台节流。
 * 配合 `node scripts/stress.mjs --cluster --rooms 1 --users 29` 把假玩家聚在出生点。
 *
 * 用法：
 *   node scripts/fps-test.mjs [--url http://localhost:5177] [--seconds 25] [--chrome "C:\...\chrome.exe"]
 */

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = argv[argv.indexOf(hit) + 1];
  return next && !next.startsWith('--') ? next : fallback;
};

const CFG = {
  url: String(arg('url', 'http://localhost:5177')),
  seconds: Number(arg('seconds', 25)),
  chrome: String(arg('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')),
  port: Number(arg('port', 9222)),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 启动 Chrome（有头模式，禁用 rAF / timer 节流）----
const userDataDir = path.join(os.tmpdir(), `qg-fps-${Date.now()}`);
console.log(`启动 Chrome: ${CFG.chrome}`);
const chrome = spawn(CFG.chrome, [
  `--remote-debugging-port=${CFG.port}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
  '--window-size=1280,800',
  '--window-position=0,0',
  CFG.url,
], { stdio: 'ignore' });

process.on('exit', () => { try { chrome.kill(); } catch {} });

// 等 Chrome 起来
let pages = null;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  try {
    pages = await fetch(`http://localhost:${CFG.port}/json`).then((r) => r.json());
    if (pages.some((p) => p.type === 'page')) break;
  } catch {}
}
if (!pages) { console.error('× Chrome CDP 连不上'); process.exit(1); }

const page = pages.find((p) => p.type === 'page' && p.url.startsWith(CFG.url)) || pages.find((p) => p.type === 'page');
if (!page) { console.error('× 找不到 page'); process.exit(1); }
console.log(`CDP 已连接: ${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));

let msgId = 0;
const pending = new Map();
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaljs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description || 'JS 异常');
  }
  return r.result?.result?.value;
}

// 把标签页切到前台 + 强制焦点（关键！否则 rAF 被节流）
await cdp('Page.bringToFront');
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

// 清掉旧 token，强制走角色选择重新注册（确保进房间 1）
await evaljs(`localStorage.clear(); sessionStorage.clear(); 'cleared'`).catch(() => {});
await cdp('Page.navigate', { url: CFG.url });
await sleep(3000);
await cdp('Page.bringToFront');
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

// ---- 等角色选择面板 ----
console.log('等角色选择面板…');
let charVisible = false;
for (let i = 0; i < 40; i++) {
  try {
    charVisible = await evaljs(`(() => { const p = document.getElementById('char-select'); return p && !p.classList.contains('hidden'); })()`);
    if (charVisible) break;
    // 已有 token 直接进游戏的情况
    const inGame = await evaljs(`!!document.querySelector('canvas')`);
    if (inGame) { charVisible = false; break; }
  } catch {}
  await sleep(500);
}

if (charVisible) {
  console.log('点击角色卡片进游戏…');
  await evaljs(`document.querySelector('.char-card[data-variant="male"]').click()`);
} else {
  console.log('已在游戏内（跳过角色选择）');
}

// 等场景渲染
console.log('等场景渲染…');
await sleep(8000);
await cdp('Page.bringToFront');

// 检查在线人数与场景状态
const info = await evaljs(`(() => {
  const text = document.body.innerText;
  const m = text.match(/(\\d+)\\s*人在线/);
  return { online: m ? m[1] : '?', hasCanvas: !!document.querySelector('canvas'), hidden: document.hidden, visibility: document.visibilityState };
})()`);
console.log(`场景状态: 在线 ${info.online} 人 · canvas ${info.hasCanvas ? '有' : '无'} · hidden=${info.hidden} · ${info.visibility}`);

// ---- 注入 FPS 统计 ----
console.log(`开始测 FPS（${CFG.seconds}s）…`);
await evaljs(`(() => {
  window.__fps = [];
  window.__frames = 0;
  window.__last = performance.now();
  window.__running = true;
  function __tick() {
    if (!window.__running) return;
    window.__frames++;
    requestAnimationFrame(__tick);
  }
  requestAnimationFrame(__tick);
  window.__timer = setInterval(() => {
    const now = performance.now();
    const fps = window.__frames * 1000 / (now - window.__last);
    window.__fps.push(+fps.toFixed(1));
    window.__frames = 0;
    window.__last = now;
  }, 1000);
  return 'ok';
})()`);

// 测试过程中保持焦点（只在 document.hidden 变 true 时才干预，避免干扰渲染）
const focusTimer = setInterval(async () => {
  const hidden = await evaljs(`document.hidden`).catch(() => true);
  if (hidden) {
    await cdp('Page.bringToFront').catch(() => {});
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
}, 3000);

await sleep(CFG.seconds * 1000);
clearInterval(focusTimer);

const fps = await evaljs(`window.__fps`) || [];
const endInfo = await evaljs(`({ hidden: document.hidden, visibility: document.visibilityState, online: (document.body.innerText.match(/(\\d+)\\s*人在线/) || [])[1] || '?' })`);

console.log('\n────────────────────────────────────');
console.log(`FPS 样本 (${fps.length} 个): ${fps.join(', ')}`);
console.log(`结束状态: 在线 ${endInfo.online} 人 · hidden=${endInfo.hidden} · ${endInfo.visibility}`);
if (fps.length) {
  const sorted = [...fps].sort((a, b) => a - b);
  const avg = fps.reduce((a, b) => a + b, 0) / fps.length;
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  console.log(`平均 ${avg.toFixed(1)} · 最低 ${sorted[0]} · 最高 ${sorted[sorted.length - 1]} · P5 ${p5}`);
  console.log(avg >= 55 ? '✅ 达到 60 FPS 判定线' : avg >= 30 ? '⚠️ 30–60 之间' : '❌ 低于 30 FPS');
}
console.log('────────────────────────────────────');

await evaljs(`window.__running = false; clearInterval(window.__timer)`).catch(() => {});
ws.close();
chrome.kill();
process.exit(0);
