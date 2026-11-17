import { formatMoney } from '../../shared/assets.js';

/**
 * 爆金币视觉反馈：金色大字上浮 + 全屏金光闪一下
 * 纯 DOM 表现，不参与任何数值计算
 */
let layer = null;
let flash = null;

function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'loot-layer';
  document.body.appendChild(layer);

  flash = document.createElement('div');
  flash.className = 'loot-flash';
  document.body.appendChild(flash);
  return layer;
}

export function lootMoney(amount, { crit = false, label = '' } = {}) {
  ensureLayer();

  const el = document.createElement('div');
  el.className = `loot-pop${crit ? ' crit' : ''}`;
  el.innerHTML = `
    <span class="loot-label">${label || (crit ? '暴击！' : '金币到账')}</span>
    <span class="loot-amount">+¥${formatMoney(amount)}</span>
  `;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1700);

  if (crit) {
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 700);
  }
}
