import { formatMoney } from '../../shared/assets.js';

/**
 * 点击玩家弹出的小菜单（README §19 ③：点击首富角色 → 「膜拜（领红包）」）
 * 目前只对「全服首富」弹出；普通玩家仍是直接打开私聊。
 */
export class PlayerMenu {
  /**
   * @param {{ onWorship?: (id: string, name: string) => void, onChat?: (id: string, name: string) => void }} [opts]
   */
  constructor({ onWorship, onChat } = {}) {
    this.onWorship = onWorship || null;
    this.onChat = onChat || null;
    this.target = null;

    this.el = document.createElement('div');
    this.el.className = 'player-menu hidden';
    document.body.appendChild(this.el);

    // 点菜单外面 / 按 Esc 关闭
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.contains(e.target)) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
        e.stopPropagation();
      }
    }, true);

    this.el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || !this.target) return;
      const { id, name } = this.target;
      if (act === 'worship') this.onWorship?.(id, name);
      if (act === 'chat') this.onChat?.(id, name);
      this.close();
    });
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  /**
   * @param {{id:string, name:string, top1?:boolean, reward?:number, cooldownMs?:number, x?:number, y?:number}} opts
   */
  open({ id, name, top1 = true, reward = 50000, cooldownMs = 0, x = 0, y = 0 }) {
    this.target = { id, name };
    const cooling = cooldownMs > 0;
    const minutes = Math.ceil(cooldownMs / 60000);

    this.el.innerHTML = `
      <div class="player-menu-head">
        <span class="player-menu-name">${escapeHtml(name)}</span>
        ${top1 ? '<span class="player-menu-tag">👑 全服首富</span>' : ''}
      </div>
      ${top1 ? `<button class="player-menu-btn primary" data-act="worship" ${cooling ? 'disabled' : ''}>
        ${cooling ? `⏳ 红包冷却 ${minutes} 分钟` : `💎 膜拜领红包 ¥${formatMoney(reward)}`}
      </button>` : ''}
      <button class="player-menu-btn" data-act="chat">💬 私聊</button>
      <div class="player-menu-hint">点击空白处关闭</div>
    `;
    this.el.classList.remove('hidden');

    // 贴着鼠标显示，但不越出视口
    const rect = this.el.getBoundingClientRect();
    const left = Math.min(Math.max(8, x + 12), window.innerWidth - rect.width - 8);
    const top = Math.min(Math.max(8, y + 12), window.innerHeight - rect.height - 8);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  close() {
    this.target = null;
    this.el.classList.add('hidden');
  }
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
