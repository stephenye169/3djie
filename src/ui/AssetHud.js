import { gameStore } from '../state/game.js';
import { formatMoney } from '../../shared/assets.js';

/** 左上角资产 HUD：称号 / 余额 / 每秒收租 / 下一目标 */
export class AssetHud {
  constructor() {
    this.el = document.getElementById('biz-hud');
    this.titleEl = document.getElementById('biz-title');
    this.ownedEl = document.getElementById('biz-owned');
    this.balanceEl = document.getElementById('biz-balance');
    this.rateEl = document.getElementById('biz-rate');
    this.nextEl = document.getElementById('biz-next');

    gameStore.subscribe((view) => this.render(view));
  }

  render(view) {
    if (!view) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    this.titleEl.textContent = view.title;
    this.ownedEl.textContent = `${view.ownedCount} / ${view.totalAssets}`;
    this.balanceEl.textContent = `¥${formatMoney(view.balance)}`;
    this.rateEl.textContent = `+${formatMoney(view.rate)} / 秒`;

    if (view.nextTitle) {
      this.nextEl.textContent = `再收 ${view.nextTitle.need} 家 → ${view.nextTitle.title}`;
    } else {
      this.nextEl.textContent = '整条街都是你的了';
    }
  }
}
