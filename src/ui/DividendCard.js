import { gameStore } from '../state/game.js';
import { formatMoney } from '../../shared/assets.js';
import { lootMoney } from './LootFx.js';
import { showToast } from './toast.js';

/** 左侧「家族分红」：按持有资产离线累积，上线一键领取 */
export class DividendCard {
  constructor() {
    this.btn = document.getElementById('dividend-claim');
    this.amountEl = document.getElementById('dividend-amount');
    this.tipEl = document.getElementById('dividend-tip');
    this.busy = false;

    this.btn?.addEventListener('click', () => this.claim());
    gameStore.subscribe((view) => this.render(view));
  }

  render(view) {
    if (!this.btn) return;
    const pending = Math.max(0, Math.floor(view?.dividendPending || 0));
    const rate = view?.dividendRate || 0;
    const synergy = view?.dividendSynergy || 0;
    const synText = synergy > 0 ? `（连锁经营 +${synergy}%）` : '';

    this.amountEl.textContent = pending > 0 ? `¥${formatMoney(pending)}` : '¥0';
    this.btn.classList.toggle('ready', pending >= 10_000);

    if (this.busy) {
      this.tipEl.textContent = '正在结算…';
    } else if (pending > 0) {
      this.tipEl.textContent = `挂机累积中 · +${formatMoney(rate)}/小时${synText} · 点击领取`;
    } else {
      this.tipEl.textContent = `挂机自动累积${synText} · 点击一键领取`;
    }
  }

  async claim() {
    if (this.busy) return;
    const pending = Math.floor(gameStore.view()?.dividendPending || 0);
    if (pending < 1) {
      showToast('分红还在累积，再逛一会儿吧');
      return;
    }

    this.busy = true;
    const res = await gameStore.claimDividend();
    this.busy = false;

    if (!res.ok) {
      showToast(res.message || '领取失败');
      return;
    }
    lootMoney(res.reward, { label: '家族分红到账' });
    showToast(`家族分红已入账 +¥${formatMoney(res.reward)}`);
    // 秘书台词（README §19 ④）：老板您可算回来了！
    gameStore.emitEvent('dividend', { reward: res.reward, seconds: res.seconds });
  }
}
