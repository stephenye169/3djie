import { api } from '../api/client.js';
import { formatMoney } from '../../shared/assets.js';

const MAX_VISIBLE = 6;

/** 全服战报弹幕：从右向左飘过，最多同时 6 条 */
export class Danmaku {
  constructor() {
    this.layer = document.getElementById('danmaku-layer');
    this.count = 0;
  }

  /** 订阅后端 battle 广播 + 首富播报（金色弹幕，README §19 ③） */
  bind(chat) {
    chat.on('battle', (payload) => this.push(payload?.content));
    chat.on('top1', (p) => {
      if (!p?.nickname) return;
      this.push(
        `👑【${p.title || '全服首富'}】${p.nickname} 驾临青果巷 · 身价 ¥${formatMoney(p.wealth)}`,
        { gold: true }
      );
    });
  }

  async loadHistory() {
    try {
      const logs = await api.battles();
      logs.slice(0, 3).reverse().forEach((log, i) => {
        setTimeout(() => this.push(log.content), 800 + i * 1200);
      });
    } catch { /* 战报拉取失败不影响游戏 */ }
  }

  push(content, { gold = false } = {}) {
    if (!content || this.count >= MAX_VISIBLE) return;
    const item = document.createElement('div');
    item.className = gold ? 'danmaku-item danmaku-gold' : 'danmaku-item';
    item.textContent = content;
    item.style.top = `${8 + Math.random() * 52}%`;
    item.style.animationDuration = `${9 + Math.random() * 4}s`;
    this.layer.appendChild(item);
    this.count += 1;

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      if (item.parentNode) item.remove();
      this.count = Math.max(0, this.count - 1);
    };
    item.addEventListener('animationend', remove);
    setTimeout(remove, 15000);
  }
}