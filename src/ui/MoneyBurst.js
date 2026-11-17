/**
 * 钞票雨粒子：护盘名场面的全屏表现层
 * 纯 DOM + CSS 动画，不占 GPU 的 three.js 渲染管线，60 帧稳定
 */
const NOTES = ['💵', '💴', '💶', '💸', '🤑', '💰'];

export class MoneyBurst {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'money-burst hidden';
    this.captionEl = document.createElement('div');
    this.captionEl.className = 'money-burst-caption';
    this.el.appendChild(this.captionEl);
    document.body.appendChild(this.el);
    this.hideTimer = null;
  }

  /**
   * 喷射一次
   * @param {{ count?: number, caption?: string, duration?: number }} opts
   */
  burst({ count = 90, caption = '', duration = 2600 } = {}) {
    // 清掉上一轮的粒子，避免连续护盘时节点堆积
    [...this.el.querySelectorAll('.money-note')].forEach((n) => n.remove());

    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const note = document.createElement('span');
      note.className = 'money-note';
      note.textContent = NOTES[(Math.random() * NOTES.length) | 0];
      const spread = (Math.random() - 0.5) * 96;          // -48 ~ 48 vw
      const rise = -(12 + Math.random() * 62);            // -12 ~ -74 vh（向上飞）
      note.style.setProperty('--dx', `${spread.toFixed(2)}vw`);
      note.style.setProperty('--dy', `${rise.toFixed(2)}vh`);
      note.style.setProperty('--rot', `${((Math.random() - 0.5) * 720) | 0}deg`);
      note.style.setProperty('--dur', `${(0.9 + Math.random() * 1.3).toFixed(2)}s`);
      note.style.setProperty('--delay', `${(Math.random() * 0.35).toFixed(2)}s`);
      note.style.fontSize = `${(14 + Math.random() * 22).toFixed(0)}px`;
      frag.appendChild(note);
    }
    this.el.appendChild(frag);

    this.captionEl.textContent = caption;
    this.el.classList.remove('hidden');
    this.el.classList.add('active');

    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), duration + 400);
  }

  hide() {
    this.el.classList.add('hidden');
    this.el.classList.remove('active');
    [...this.el.querySelectorAll('.money-note')].forEach((n) => n.remove());
  }
}
