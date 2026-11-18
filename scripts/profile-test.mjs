#!/usr/bin/env node
/**
 * 浏览器端 CPU Profiling（定位 30 人同房 FPS 瓶颈）
 *
 * 用 CDP Profiler 采样 15s，输出 selfTime Top 30 函数。
 * 配合 `node scripts/stress.mjs --cluster --rooms 1 --users 29` 聚团。
 *
 * 用法：node scripts/profile-test.mjs [--seconds 15] [--out profile.json]
 */

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return d;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = argv[argv.indexOf(hit) + 1];
  return next && !next.startsWith('--') ? next : d;
};
const CFG = {
  url: String(arg('url', 'http://localhost:5177')),
  seconds: Number(arg('seconds', 15)),
  chrome: String(arg('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')),
  port: Number(arg('port', 9223)),
  out: String(arg('out', '')),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = path.join(os.tmpdir(), `qg-prof-${Date.now()}`);
const chrome = spawn(CFG.chrome, [
  `--remote-debugging-port=${CFG.port}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
  '--window-size=1280,800', '--window-position=0,0',
  CFG.url,
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

let pages = null;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  try {
    pages = await fetch(`http://localhost:${CFG.port}/json`).then((r) => r.json());
    if (pages.some((p) => p.type === 'page')) break;
  } catch {}
}
const page = pages.find((p) => p.type === 'page' && p.url.startsWith(CFG.url)) || pages.find((p) => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.on('open', r));

let msgId = 0;
const pending = new Map();
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaljs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
}

await cdp('Page.bringToFront');
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
await evaljs(`localStorage.clear(); sessionStorage.clear(); 'ok'`).catch(() => {});
await cdp('Page.navigate', { url: CFG.url });
await sleep(3000);
await cdp('Page.bringToFront');
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

// 等角色选择并进游戏
for (let i = 0; i < 40; i++) {
  const v = await evaljs(`(() => { const p = document.getElementById('char-select'); return p && !p.classList.contains('hidden'); })()`).catch(() => false);
  if (v) { await evaljs(`document.querySelector('.char-card[data-variant="male"]').click()`); break; }
  await sleep(500);
}
console.log('等场景渲染…');
await sleep(8000);
await cdp('Page.bringToFront');
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

const info = await evaljs(`({ online: (document.body.innerText.match(/(\\d+)\\s*人在线/) || [])[1] || '?', hidden: document.hidden })`);
console.log(`在线 ${info.online} 人 · hidden=${info.hidden}`);

// ---- hook WebGL draw call 计数（验证 draw call 假设）----
await evaljs(`(() => {
  window.__dc = { elements: 0, arrays: 0 };
  for (const proto of [globalThis.WebGL2RenderingContext?.prototype, globalThis.WebGLRenderingContext?.prototype]) {
    if (!proto) continue;
    const oe = proto.drawElements, oa = proto.drawArrays;
    proto.drawElements = function (...a) { window.__dc.elements++; return oe.apply(this, a); };
    proto.drawArrays = function (...a) { window.__dc.arrays++; return oa.apply(this, a); };
  }
  return 'hooked';
})()`);

// ---- CPU Profiler ----
console.log(`开始 CPU 采样 ${CFG.seconds}s…`);
await cdp('Profiler.enable');
await cdp('Profiler.setSamplingInterval', { interval: 500 }); // 500μs
await cdp('Profiler.start');
await sleep(CFG.seconds * 1000);
const { result } = await cdp('Profiler.stop');
const profile = result.profile;

if (CFG.out) {
  fs.writeFileSync(CFG.out, JSON.stringify(profile));
  console.log(`profile 已写入 ${CFG.out}`);
}

// 同时采 FPS 佐证
const fpsInfo = await evaljs(`({ hidden: document.hidden, online: (document.body.innerText.match(/(\\d+)\\s*人在线/) || [])[1] || '?' })`);

// draw call 统计（CFG.seconds 秒内的总调用数 / 秒 = 每秒 draw call）
const dc = await evaljs(`window.__dc`);
if (dc) {
  const perSec = ((dc.elements + dc.arrays) / CFG.seconds).toFixed(0);
  console.log(`\nWebGL draw call：drawElements ${dc.elements} + drawArrays ${dc.arrays} = ${dc.elements + dc.arrays} 次 / ${CFG.seconds}s ≈ ${perSec} 次/s`);
}

// ---- 分析：selfTime = hitCount × 平均采样间隔 ----
const nodes = profile.nodes;
const totalSamples = profile.samples.length;
const durationMs = (profile.endTime - profile.startTime) / 1000;
const avgIntervalMs = durationMs / totalSamples;

const rows = nodes
  .filter((n) => n.hitCount > 0)
  .map((n) => {
    const f = n.callFrame;
    const selfMs = n.hitCount * avgIntervalMs;
    return {
      fn: f.functionName || '(anonymous)',
      url: (f.url || '').replace(/^http:\/\/localhost:\d+\//, ''),
      line: f.lineNumber + 1,
      hit: n.hitCount,
      selfMs,
      pct: (n.hitCount / totalSamples) * 100,
    };
  })
  .sort((a, b) => b.hit - a.hit);

console.log(`\n采样 ${totalSamples} 次 · 时长 ${(durationMs / 1000).toFixed(1)}s · 平均间隔 ${avgIntervalMs.toFixed(2)}ms`);
console.log(`结束时 在线 ${fpsInfo.online} 人 · hidden=${fpsInfo.hidden}`);
console.log('\n── selfTime Top 30 ──────────────────────────────────────────────');
console.log('占比    self(ms)  命中    函数 @ 位置');
for (const r of rows.slice(0, 30)) {
  const loc = r.url ? `${r.url}:${r.line}` : '(native)';
  console.log(
    `${r.pct.toFixed(1).padStart(5)}%  ${r.selfMs.toFixed(0).padStart(8)}  ${String(r.hit).padStart(6)}  ${r.fn} @ ${loc}`.slice(0, 140),
  );
}

// 按文件聚合
const byFile = new Map();
for (const r of rows) {
  const key = r.url || '(native)';
  byFile.set(key, (byFile.get(key) || 0) + r.hit);
}
console.log('\n── 按文件聚合 Top 12 ────────────────────────────────────────────');
const fileRows = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [file, hit] of fileRows) {
  console.log(`${((hit / totalSamples) * 100).toFixed(1).padStart(5)}%  ${file}`);
}

ws.close();
chrome.kill();
process.exit(0);
