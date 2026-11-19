import { api } from '../api/client.js';
import { gameStore } from '../state/game.js';
import { formatMoney, PRODUCT_KINDS, BUFF_TYPES } from '../../shared/assets.js';
import { showToast } from './toast.js';

/** buff 编码 'type:ms:mult' → 人话说明（如「移动速度 +35% · 60秒」） */
function buffDesc(buff) {
  if (!buff) return '';
  const [type, ms] = String(buff).split(':');
  const def = BUFF_TYPES[type];
  if (!def) return '';
  const sec = Math.round(Number(ms) / 1000);
  return `${def.desc} · ${sec >= 60 ? `${Math.round(sec / 60)} 分钟` : `${sec} 秒`}`;
}

/**
 * 店内商品卡：柜台/货架点击打开（进货转售玩法入口）
 * - 上半：店铺消费流水进度条（档位越高，门口客源金币给店主的分成越高）
 * - 中部：商品列表 → 「买入」（实付计入流水，10% 实时分给店铺收购人）
 * - 下部：本店库存 → 「转售」给街面游客（回收价 = 标价 85%~110% 随机，差价归玩家）
 */
export class ShopProductsCard {
  constructor({ onClose } = {}) {
    this.onClose = onClose || null;
    this.shopId = null;
    this.busy = false;

    this.el = document.createElement('div');
    this.el.className = 'products-card hidden';
    document.body.appendChild(this.el);

    this.el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || this.busy) return;
      if (btn.dataset.act === 'close') { this.close(); return; }
      const productId = btn.dataset.product;
      if (btn.dataset.act === 'buy') await this._buy(productId, btn);
      if (btn.dataset.act === 'resell') await this._resell(productId, btn);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        e.stopPropagation();
        this.close();
      }
    });
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  async open(shopId, shopMeta = null) {
    this.shopId = shopId;
    this.el.classList.remove('hidden');
    this.el.innerHTML = '<div class="products-loading">加载商品中…</div>';
    if (document.pointerLockElement) document.exitPointerLock();
    try {
      const [products, flow, inventory] = await Promise.all([
        api.products(shopId),
        api.shopFlow(shopId).catch(() => null),
        api.inventory().catch(() => []),
      ]);
      const mine = inventory.filter((i) => i.shop_id === shopId);
      this._render(shopMeta, products, flow, mine);
    } catch (err) {
      this.el.innerHTML = `<div class="products-loading">商品加载失败：${err.message || '请稍后再试'}</div>`;
    }
  }

  close() {
    this.shopId = null;
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  _render(shopMeta, products, flow, mine) {
    const name = shopMeta?.name || '本店';
    const emoji = shopMeta?.emoji || '🏪';
    const flowHtml = this._flowHtml(flow);
    const rows = (products || []).map((p) => {
      const kind = PRODUCT_KINDS[p.kind] || PRODUCT_KINDS.daily;
      const effect = buffDesc(p.buff);
      return `
      <div class="products-row">
        <span class="products-kind" data-kind="${p.kind}">${kind.icon}</span>
        <span class="products-name">${escapeHtml(p.name)}<i class="products-effect">${effect ? escapeHtml(effect) : kind.desc}</i></span>
        <span class="products-price">¥${formatMoney(p.price)}</span>
        <button class="products-btn primary" data-act="buy" data-product="${escapeHtml(p.id)}">买入</button>
      </div>
    `;
    }).join('');
    const stockRows = mine.length === 0
      ? '<div class="products-empty">背包里没有本店商品——先买入进货，再转售给街面游客赚差价</div>'
      : mine.map((i) => `
        <div class="products-row stock">
          <span class="products-name">${i.emoji || '📦'} ${escapeHtml(i.name)} <i>×${i.qty}</i></span>
          <span class="products-price">进价 ¥${formatMoney(i.price)}</span>
          <button class="products-btn sell" data-act="resell" data-product="${escapeHtml(i.product_id)}">转售</button>
        </div>
      `).join('');

    this.el.innerHTML = `
      <div class="products-head">
        <span class="products-emoji">${emoji}</span>
        <span class="products-title">${escapeHtml(name)} · 商品与进货</span>
        <button class="products-close" data-act="close" title="关闭">×</button>
      </div>
      ${flowHtml}
      <div class="products-hint">买入 = 进货，实付的 ${Math.round(SHOP_ROYALTY_RATE * 100)}% 实时分给店铺收购人；转售回收价为标价 85%~110% 随机，差价归你</div>
      <div class="products-section-label">在售商品</div>
      ${rows || '<div class="products-empty">本店暂未上架商品</div>'}
      <div class="products-section-label">我的库存（本店）</div>
      ${stockRows}
    `;
  }

  /** 流水进度条：当前档位高亮，下一档进度 */
  _flowHtml(flow) {
    if (!flow) return '';
    const f = Number(flow.flow_total) || 0;
    const idx = flow.tier_index ?? -1;
    const next = flow.next_tier ? Number(flow.next_tier) : null;
    const prev = idx >= 0 ? SHOP_FLOW_TIERS[idx] : 0;
    const pct = next ? Math.min(100, Math.round(((f - prev) / (next - prev)) * 100)) : 100;
    const tierName = idx < 0 ? '未达档' : `客流档位 ${idx + 1}`;
    const shareText = idx < 0 ? '门口暂无客源金币' : `门口客源金币 · 店主分成 ${Math.round((flow.share || 0) * 100)}%`;
    const nextText = next ? `下一档 ¥${formatMoney(next)}` : '已满档';
    return `
      <div class="products-flow">
        <div class="products-flow-head">
          <span>店铺累计流水 ¥${formatMoney(f)} · ${tierName}</span>
          <span>${nextText}</span>
        </div>
        <div class="products-flow-bar"><i style="width:${pct}%"></i></div>
        <div class="products-flow-foot">${shareText}</div>
      </div>
    `;
  }

  async _buy(productId, btn) {
    this.busy = true;
    btn.disabled = true;
    try {
      const res = await api.order(productId, 1);
      const kind = PRODUCT_KINDS[res.product?.kind] || null;
      showToast(`已买入「${res.product?.name || '商品'}」 -¥${formatMoney(res.total)}${res.royalty > 0 ? `（店主抽成 +¥${formatMoney(res.royalty)}）` : ''}${res.couponUsed ? ' · 优惠券已抵扣' : ''}`);
      if (res.buffType && res.buffUntil) {
        const def = BUFF_TYPES[res.buffType];
        gameStore.patchBuffs(res.buffType, res.buffUntil); // 本地立即合入，状态条与速度/磁铁即时生效
        showToast(`${def?.icon || '⚡'} ${def?.name || res.buffType} 生效中！${def?.desc || ''}`);
      } else if (kind?.name) {
        showToast(`已入手${kind.name}类商品`);
      }
      await this.open(this.shopId);
    } catch (err) {
      showToast(err.message || '购买失败');
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
      const diff = res.refund - (res.unit ? res.unit : 0);
      showToast(`已转售「${res.product?.name || '商品'}」 +¥${formatMoney(res.refund)}（回收率 ${res.rate}%）`);
      await this.open(this.shopId);
    } catch (err) {
      showToast(err.message || '转售失败');
      btn.disabled = false;
    } finally {
      this.busy = false;
    }
  }
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
