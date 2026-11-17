import { gameStore } from '../state/game.js';
import { showToast } from './toast.js';

const SEEN_KEY = 'qingguo_intro_seen';

/**
 * 新手引导「开局即逆袭」
 * 三步：势利眼店长嘲讽 → 龙王归来体验卡 → 空投 5000 万 + 指路第一家店
 * 只在未领取过体验卡的新账号首次进入时触发
 */
export class Onboarding {
  constructor({ moneyBurst } = {}) {
    this.moneyBurst = moneyBurst || null;
    this.step = 1;
    this.busy = false;
    this.started = false;
    this._build();
  }

  _build() {
    this.el = document.createElement('div');
    this.el.className = 'intro-overlay hidden';
    this.el.innerHTML = `
      <div class="intro-panel">
        <div class="intro-step" data-step="1">
          <div class="intro-speaker"><span class="intro-avatar">🧑‍🍳</span><span>东牌坊奶茶铺 · 势利眼店长</span></div>
          <p class="intro-quote">“哟——穷酸样也敢进青果巷？这条街一块青砖，够你打三年工。”</p>
          <p class="intro-sub">你摸了摸口袋里仅有的 50 万，被人当面羞辱。</p>
          <div class="intro-actions">
            <button class="intro-btn ghost" data-act="skip">先忍一手</button>
            <button class="intro-btn" data-act="next">……继续</button>
          </div>
        </div>

        <div class="intro-step hidden" data-step="2">
          <div class="intro-speaker"><span class="intro-avatar">⚡</span><span>天机系统</span></div>
          <p class="intro-quote">“叮——检测到隐藏血脉：龙王归来。”</p>
          <div class="intro-card">
            <div class="intro-card-title">龙王归来 · 体验卡</div>
            <div class="intro-card-amount">¥50,000,000</div>
            <div class="intro-card-desc">新手逆袭基金 · 限领一次 · 全服唯一</div>
          </div>
          <div class="intro-actions">
            <button class="intro-btn ghost" data-act="skip">稍后再说</button>
            <button class="intro-btn primary" data-act="claim">立即领取</button>
          </div>
        </div>

        <div class="intro-step hidden" data-step="3">
          <div class="intro-speaker"><span class="intro-avatar">🕴️</span><span>贴身管家</span></div>
          <p class="intro-quote">“少爷，您的黑卡已经到账：<b>¥5,000 万</b>。”</p>
          <p class="intro-sub">刚才嘲讽您的那家奶茶铺只要 ¥50 万——买下它，把脸打回去。</p>
          <div class="intro-actions">
            <button class="intro-btn primary" data-act="finish">出发，买下整条街</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.el);

    this.chip = document.createElement('button');
    this.chip.className = 'intro-chip hidden';
    this.chip.textContent = '🎁 新人体验卡待领取';
    document.body.appendChild(this.chip);

    this.el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) this._handle(act);
    });
    this.chip.addEventListener('click', () => this.start());
  }

  /** 首次进入游戏后调用：决定是否开场 */
  maybeStart() {
    const intro = gameStore.state?.intro;
    if (!intro) return;
    if (intro.granted) {
      localStorage.setItem(SEEN_KEY, 'done');
      return;
    }
    if (localStorage.getItem(SEEN_KEY) === 'done') {
      this._showChip();
      return;
    }
    this.start();
  }

  start() {
    if (this.busy) return;
    this.started = true;
    this.step = 1;
    this._render();
    this.el.classList.remove('hidden');
  }

  _render() {
    this.el.querySelectorAll('.intro-step').forEach((panel) => {
      panel.classList.toggle('hidden', Number(panel.dataset.step) !== this.step);
    });
  }

  async _handle(act) {
    if (this.busy) return;
    if (act === 'next') {
      this.step = 2;
      this._render();
      return;
    }
    if (act === 'claim') {
      this.busy = true;
      const result = await gameStore.grantIntro();
      this.busy = false;
      if (result.ok) {
        this.moneyBurst?.burst({ count: 120, caption: `+¥${(result.amount / 10000).toFixed(0)} 万 · 到账` });
      } else {
        showToast(result.message || '领取失败');
      }
      this.step = 3;
      this._render();
      return;
    }
    // skip / finish
    this._close();
  }

  _close() {
    localStorage.setItem(SEEN_KEY, 'done');
    this.el.classList.add('hidden');
    const granted = gameStore.state?.intro?.granted;
    if (granted) this.chip.classList.add('hidden');
    else this._showChip();
  }

  _showChip() {
    this.chip.classList.remove('hidden');
  }
}
