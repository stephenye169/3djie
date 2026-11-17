import { wallet } from '../state/wallet.js';
import { getShopById } from '../data/shops.js';
import { api } from '../api/client.js';
import { showToast } from './toast.js';

/**
 * 个人中心 / 钱包面板
 * 展示余额、消费、已购商品，支持快捷充值与重置
 */
export class WalletPanel {
  constructor() {
    this.el = document.getElementById('wallet-panel');
    this.balanceEl = document.getElementById('wallet-panel-balance');
    this.spentEl = document.getElementById('wallet-panel-spent');
    this.listEl = document.getElementById('wallet-panel-list');
    this._open = false;

    document.getElementById('wallet-close').addEventListener('click', () => this.close());

    // 点击遮罩关闭
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    document.querySelectorAll('[data-recharge]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const amount = Number(btn.dataset.recharge);
        const res = wallet.recharge(amount);
        if (res.ok) showToast(`已充值 ¥${amount}`);
      });
    });

    document.getElementById('wallet-reset').addEventListener('click', () => {
      wallet.reset();
      showToast('余额已重置为 ¥500');
    });

    document.addEventListener('keydown', (e) => {
      if (this._open && e.key === 'Escape') this.close();
    });

    wallet.subscribe(() => {
      if (this._open) this._render();
    });
  }

  isOpen() {
    return this._open;
  }

  open() {
    this._open = true;
    this._render();
    this.el.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  close() {
    this._open = false;
    this.el.classList.add('hidden');
  }

  _render() {
    this.balanceEl.textContent = `¥${wallet.balance}`;

    let spent = 0;
    const rows = [];

    Object.entries(wallet.purchases).forEach(([key, qty]) => {
      const [shopId, productName] = key.split('::');
      const shop = getShopById(shopId);
      const product = shop?.products?.find((p) => p.name === productName);
      const price = product?.price ?? 0;
      const subtotal = price * qty;
      spent += subtotal;
      rows.push({ shopName: shop?.name ?? shopId, name: productName, qty, subtotal });
    });

    this.spentEl.textContent = `已消费 ¥${spent}`;

    if (rows.length === 0) {
      this.listEl.innerHTML = '<div class="wallet-empty">还没有购买记录</div>';
      return;
    }

    this.listEl.innerHTML = rows
      .map(
        (r) => `
        <div class="wallet-row">
          <span class="wallet-row-name">${r.name} <i>×${r.qty}</i></span>
          <span class="wallet-row-shop">${r.shopName}</span>
          <span class="wallet-row-cost">¥${r.subtotal}</span>
        </div>
      `
      )
      .join('');
  }
}
