import { formatMoney } from '../../shared/assets.js';

/**
 * 首富专属头衔框（README §19 ③）
 * 只在「我」就是全服首富时显示，固定右上角，不用占顶栏位置。
 */
export class Top1Crown {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'top1-crown hidden';
    this.el.innerHTML = `
      <span class="top1-crown-icon">👑</span>
      <span class="top1-crown-body">
        <span class="top1-crown-title">全服首富</span>
        <span class="top1-crown-wealth"></span>
      </span>
    `;
    document.body.appendChild(this.el);
    this.wealthEl = this.el.querySelector('.top1-crown-wealth');
  }

  /** @param {{userId:string, nickname:string, title:string, wealth:number}|null} top1 */
  apply(top1, myId) {
    const mine = !!top1 && top1.userId === myId;
    this.el.classList.toggle('hidden', !mine);
    if (!mine || !this.wealthEl) return;
    this.wealthEl.textContent = `身价 ¥${formatMoney(top1.wealth)}`;
    this.el.title = `${top1.nickname} · ${top1.title} · 全服财富榜第一名`;
  }
}
