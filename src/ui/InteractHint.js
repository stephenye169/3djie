/**
 * 靠近店铺时的交互提示（屏幕中央底部）
 * 显示：按 E 进入 [店铺名]
 */
export class InteractHint {
  constructor() {
    this.el = document.getElementById('interact-hint');
    this.nameEl = document.getElementById('interact-shop-name');
    this.distanceEl = document.getElementById('interact-distance');
    this._visible = false;
  }

  show(shopName, distance) {
    this.nameEl.textContent = shopName;
    this.distanceEl.textContent = distance != null ? `距离约 ${distance.toFixed(1)} 米` : '';
    if (!this._visible) {
      this.el.classList.remove('hidden');
      this._visible = true;
    }
  }

  hide() {
    if (this._visible) {
      this.el.classList.add('hidden');
      this._visible = false;
    }
  }
}
