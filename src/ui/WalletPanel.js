import { getShopById } from '../data/shops.js';
import { api } from '../api/client.js';
import { gameStore } from '../state/game.js';
import { showToast } from './toast.js';
import { formatMoney, BUFF_TYPES } from '../../shared/assets.js';

/**
 * 个人中心 / 钱包面板（全量服务端账本）
 * - 余额：gameStore（/api/game/state 服务端真实余额，顶栏同源）
 * - 背包：/api/inventory 已购未转售商品（进货转售玩法）
 * - 订单：/api/orders/my 最近 20 条（含优惠券抵扣标记）
 * - 优惠券：打脸 NPC 获得，下单自动 9 折核销
 */
export class WalletPanel {
  constructor() {
    this.el = document.getElementById('wallet-panel');
    this.balanceEl = document.getElementById('wallet-panel-balance');
    this.spentEl = document.getElementById('wallet-panel-spent');
    this.listEl = document.getElementById('wallet-panel-list');
    this.inventoryEl = document.getElementById('wallet-inventory');
    this.couponsEl = document.getElementById('wallet-coupons');
    this._open = false;
    this.busy = false;

    document.getElementById('wallet-close').addEventListener('click', () => this.close());

    // 点击遮罩关闭；背包按钮分发（使用 = boost 激活 / 转售 = 流通品换钱）
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) { this.close(); return; }
      if (this.busy) return;
      const useBtn = e.target.closest('[data-use]');
      if (useBtn) { this._use(useBtn.dataset.use, useBtn); return; }
      const sellBtn = e.target.closest('[data-resell]');
      if (sellBtn) this._resell(sellBtn.dataset.resell, sellBtn);
    });

    document.addEventListener('keydown', (e) => {
      if (this._open && e.key === 'Escape') this.close();
    });

    // 余额与顶栏同源：gameStore 每次刷新自动重渲染（优惠券由 _renderOrders 一并渲染）
    gameStore.subscribe(() => {
      if (this._open) {
        this._renderBalance();
        this._renderOrders();
        this._renderInventory();
      }
    });
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  open() {
    this._open = true;
    this._renderBalance();
    this._renderOrders();
    this._renderInventory();
    this.el.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  close() {
    this._open = false;
    this.el.classList.add('hidden');
  }

  _renderBalance() {
    const balance = Number(gameStore.state?.user?.balance);
    this.balanceEl.textContent = Number.isFinite(balance) ? `¥${formatMoney(balance)}` : '加载中…';
  }

  async _renderOrders() {
    this.spentEl.textContent = '订单与优惠券来自服务端账本';
    try {
      const { orders = [], coupons = [] } = await api.myOrders();
      if (orders.length === 0) {
        this.listEl.innerHTML = '<div class="wallet-empty">还没有购买记录——进店点柜台就能进货</div>';
      } else {
        this.listEl.innerHTML = orders.map((o) => {
          const shop = this._shopNameOf(o);
          return `
            <div class="wallet-row">
              <span class="wallet-row-name">${escapeHtml(o.product_name || '商品')} <i>×${o.qty}</i></span>
              <span class="wallet-row-shop">${escapeHtml(shop)}</span>
              <span class="wallet-row-cost">¥${formatMoney(o.paid)}</span>
            </div>
          `;
        }).join('');
      }
      this.couponsEl.innerHTML = coupons.length === 0
        ? '<div class="wallet-empty">暂无优惠券——打脸碰瓷 NPC 有机会掉 9 折券</div>'
        : coupons.map((c) => `
            <div class="wallet-row">
              <span class="wallet-row-name">🎟️ 9 折券 <i>下单自动使用</i></span>
              <span class="wallet-row-shop">${new Date(Number(c.expires_at)).toLocaleDateString()} 到期</span>
              <span class="wallet-row-cost">-10%</span>
            </div>
          `).join('');
    } catch {
      this.listEl.innerHTML = '<div class="wallet-empty">订单加载失败，请稍后再试</div>';
    }
  }

  async _renderInventory() {
    try {
      const items = await api.inventory();
      if (items.length === 0) {
        this.inventoryEl.innerHTML = '<div class="wallet-empty">背包是空的——⚡ 功能商品买后进背包「使用」激活，📜 收购材料囤着收购高级店</div>';
        return;
      }
      this.inventoryEl.innerHTML = items.map((i) => {
        const isBoost = i.kind === 'boost';
        const isPermit = i.kind === 'permit';
        const tag = isBoost ? '⚡ 功能' : isPermit ? '📜 材料' : '🥤 即食';
        const action = isBoost
          ? `<button class="wallet-use-btn" data-use="${escapeHtml(i.product_id)}" title="消耗 1 件激活增益（使用后不可再转售）">使用</button>
             <button class="wallet-resell-btn" data-resell="${escapeHtml(i.product_id)}" title="未使用的可以转售（回收价 = 实付价 85%~95% 随机）">转售</button>`
          : isPermit
            ? `<button class="wallet-resell-btn" data-resell="${escapeHtml(i.product_id)}" title="硬通货可转售（回收价 = 实付价 85%~95% 随机）；收购高级店时按清单消耗">转售</button>`
            : '';
        return `
        <div class="wallet-row">
          <span class="wallet-row-name">${i.emoji || '📦'} ${escapeHtml(i.name)} <i>×${i.qty}</i> <em class="wallet-tag">${tag}</em></span>
          <span class="wallet-row-shop">${escapeHtml(i.shop_name)}</span>
          ${action}
        </div>
      `;
      }).join('');
    } catch {
      this.inventoryEl.innerHTML = '<div class="wallet-empty">背包加载失败，请稍后再试</div>';
    }
  }

  /** 使用功能商品：消耗 1 件激活 buff（资产去向互斥——用了的不能再卖） */
  async _use(productId, btn) {
    this.busy = true;
    btn.disabled = true;
    try {
      const res = await api.useInventory(productId);
      const def = BUFF_TYPES[res.buffType] || null;
      showToast(`${def?.icon || '⚡'} 「${res.product?.name || '商品'}」已使用，${def?.desc || '增益生效'}！`);
      gameStore.patchBuffs(res.buffType, res.buffUntil);
      this._renderInventory();
      await gameStore.refresh?.();
    } catch (err) {
      showToast(err.message || '使用失败');
      btn.disabled = false;
    } finally {
      this.busy = false;
    }
  }

  async _resell(productId, btn) {
    this.busy = true;
    btn.disabled = true;
    try {
      const res = await api.resell(productId, 1);
      showToast(`已转售「${res.product?.name || '商品'}」 +¥${formatMoney(res.refund)}（回收率 ${res.rate}%）`);
      this._renderInventory();
      await gameStore.refresh?.();
    } catch (err) {
      showToast(err.message || '转售失败');
      btn.disabled = false;
    } finally {
      this.busy = false;
    }
  }

  _shopNameOf(_order) {
    // 订单接口不回 shop_id、商品名与前端静态数据不同源，统一显示街区来源
    return '青果巷商铺';
  }
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
