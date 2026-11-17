/**
 * Canvas 复用池：名牌 / 气泡 / 倒计时这类高频重绘的 Sprite，
 * 每次新建 canvas 会产生 GC 压力；按尺寸取用/归还，池上限防膨胀。
 */
const pool = [];
const POOL_MAX = 32;

/** 取一个指定尺寸的空白 canvas（池里没有就新建） */
export function acquireCanvas(width, height) {
  const idx = pool.findIndex((c) => c.width === width && c.height === height);
  if (idx >= 0) return pool.splice(idx, 1)[0];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 归还 canvas（清空内容防串图；池满则直接丢弃交给 GC） */
export function releaseCanvas(canvas) {
  if (!canvas || pool.length >= POOL_MAX) return;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  pool.push(canvas);
}
