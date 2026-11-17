/**
 * 钱包状态：余额来自后端 /api/me，购买走 /api/orders
 * 本地保留 purchases 记录（后端 orders 暂没拉取列表）
 */
const STORAGE_KEY = 'qingguo_wallet_v1';

class Wallet {
  constructor() {
    // 先给个临时值，等 /api/me 回来覆盖
    this.balance = 500;
    this.purchases = {};
    this._listeners = new Set();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    fn();
    return () => this._listeners.delete(fn);
  }
  _notify() { this._listeners.forEach((fn) => fn()); }

  /** 从后端刷新余额（通常在登录成功 / 下单后调用） */
  async refresh(api) {
    try {
      const me = await api.me();
      this.balance = me.balance;
      this._loadLocal();
      this._notify();
    } catch {
      /* 后端暂时不可用就保留当前余额 */
    }
  }

  _loadLocal() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && typeof data.purchases === 'object') this.purchases = data.purchases;
      }
    } catch { /* 忽略 */ }
  }
  _saveLocal() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ purchases: this.purchases }));
    } catch { /* 忽略 */ }
  }

  getQuantity(key) { return this.purchases[key] || 0; }

  /** 充值：后端暂未实现，保留前端效果 */
  recharge(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
    this.balance += amount;
    this._notify();
    return { ok: true, balance: this.balance };
  }

  reset() {
    this.balance = 500;
    this.purchases = {};
    this._saveLocal();
    this._notify();
  }

  /** 异步购买：走后端 /api/orders，成功后刷新余额 */
  async buy(product_id, price, name, qty = 1, api) {
    try {
      const result = await api.order(product_id, qty);
      this.balance = result.remaining;
      this.purchases[product_id] = this.getQuantity(product_id) + qty;
      this._saveLocal();
      this._notify();
      return { ok: true, balance: this.balance, name: result.product?.name || name };
    } catch (err) {
      if (err.status === 402) return { ok: false, reason: 'insufficient' };
      return { ok: false, reason: err.message || 'network' };
    }
  }
}

export const wallet = new Wallet();
