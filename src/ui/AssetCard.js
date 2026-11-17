const COOLDOWN_TOTAL_MS = 5 * 60 * 1000;
const RING_CIRCUMFERENCE = 2 * Math.PI * 20; // 2πr, SVG r=20

import { gameStore } from '../state/game.js';
import { formatMoney, TIERS, MAX_LEVEL, attackBidOf, incomeOf } from '../../shared/assets.js';
import { dominationFactor, talentLevelOf } from '../../shared/prestige.js';
import { showToast } from './toast.js';

/**
 * 资产面板：替代原来的店铺商品卡
 * - 未收购：展示反派挑衅台词 + 收购价 + 「甩出黑卡收购」
 * - 已收购：展示等级 / 每秒收租 + 「豪华装修升级」+ 进店提示
 */
export class AssetCard {
  constructor(onClose) {
    this.el = document.getElementById('asset-card');
    this.emojiEl = document.getElementById('asset-emoji');
    this.tierEl = document.getElementById('asset-tier');
    this.nameEl = document.getElementById('asset-name');
    this.statusEl = document.getElementById('asset-status');
    this.tauntEl = document.getElementById('asset-taunt');
    this.priceEl = document.getElementById('asset-price');
    this.incomeEl = document.getElementById('asset-income');
    this.levelEl = document.getElementById('asset-level');
    this.messageEl = document.getElementById('asset-message');
    this.actionBtn = document.getElementById('asset-action');
    this.hintEl = document.getElementById('asset-hint');
    this.econEl = document.getElementById('asset-econ');
    // 保护期倒计时 UI
    this.cooldownWrapEl = document.getElementById('asset-cooldown');
    this.cooldownCountEl = document.getElementById('asset-cooldown-count');
    this.cooldownBarEl = document.getElementById('asset-cooldown-bar');

    this.assetId = null;
    this.busy = false;
    this.attacking = false;
    this.onClose = onClose;
    this._cooldownExpireAt = 0;
    this._cooldownTimer = null;

    document.getElementById('asset-close').addEventListener('click', () => this.onClose?.());
    this.actionBtn.addEventListener('click', () => this._onAction());

    gameStore.subscribe(() => { if (this.assetId) this._render(); });
  }

  show(assetId) {
    this.assetId = assetId;
    this.messageEl.textContent = '';
    this.busy = false;
    this.attacking = false;
    this._stopCooldownTimer();
    this._render();
    this.el.classList.remove('hidden');
  }

  hide() {
    this.assetId = null;
    this._stopCooldownTimer();
    this.cooldownWrapEl?.classList.add('hidden');
    this.el.classList.add('hidden');
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  _render() {
    const asset = gameStore.asset(this.assetId);
    if (!asset) {
      this.nameEl.textContent = '加载中…';
      this.actionBtn.disabled = true;
      this.econEl?.classList.add('hidden');
      return;
    }

    const tier = TIERS[asset.tier];
    const mine = asset.owned;
    const other = !mine && asset.ownerId;

    this.emojiEl.textContent = asset.emoji || '🏪';
    this.tierEl.textContent = tier ? `${tier.label} · ${tier.name}` : '';
    this.nameEl.textContent = asset.name;
    this.statusEl.textContent = mine
      ? `已持有 · Lv.${asset.level}`
      : other
        ? `已被【${asset.ownerNick}】独占`
        : '待收购';
    this.statusEl.dataset.owned = mine ? '1' : '0';

    if (mine) {
      this.tauntEl.textContent = `原店长「${asset.manager}」已下岗，现在是你的管家。`;
    } else if (other) {
      this.tauntEl.textContent = `【${asset.ownerNick}】：这店现在姓我。想抢？先看看你卡里的余额够不够。`;
    } else {
      this.tauntEl.textContent = `「${asset.manager}」：${asset.taunt || '就凭你也想收购这家店？'}`;
    }

    // 收购价：资本压制天赋生效时显示折后价 + 划线原价（踢馆身价仍按原价）
    const talents = gameStore.state?.user?.talents || {};
    const domLv = talentLevelOf(talents, 'capitalDomination');
    const domFactor = dominationFactor(domLv);
    if (!mine && domFactor < 1) {
      const discounted = asset.acquirePrice ?? Math.round(asset.price * domFactor);
      this.priceEl.innerHTML = `${formatMoney(discounted)} <s class="price-orig">${formatMoney(asset.price)}</s>`;
    } else {
      this.priceEl.textContent = formatMoney(asset.price);
    }
    this.incomeEl.textContent = mine
      ? `${formatMoney(asset.income)} / 秒`
      : `${formatMoney(asset.baseIncome)} / 秒`;
    this.levelEl.textContent = asset.level ? `Lv.${asset.level} / ${MAX_LEVEL}` : '—';

    if (mine) {
      const maxed = asset.level >= MAX_LEVEL;
      this.actionBtn.disabled = this.busy || maxed;
      this.actionBtn.textContent = maxed
        ? '已是顶级豪华装修'
        : `豪华装修升级 · ${formatMoney(asset.upgradeCost)}`;
      this.hintEl.classList.remove('hidden');
      this.actionBtn.classList.remove('danger');

      // 众筹扩建入口（自己的 tier≥2 特色店铺及以上）：打开众筹面板
      const oldCrowdBtn = document.getElementById('asset-crowd-btn');
      oldCrowdBtn?.remove();
      if ((asset.tier ?? 0) >= 2) {
        const crowdBtn = document.createElement('button');
        crowdBtn.id = 'asset-crowd-btn';
        crowdBtn.className = 'asset-crowd-btn';
        crowdBtn.textContent = '📋 众筹扩建（出租 40% 租金换扩建资金）';
        crowdBtn.addEventListener('click', () => gameStore.emitEvent('crowd-open', { shopId: asset.id }));
        this.actionBtn.after(crowdBtn);
      }
    } else if (other) {
      const bid = attackBidOf(asset, asset.level);
      const cooling = asset.cooldownMs > 0;
      const protectedByTransfer = asset.ownerProtected; // tier 1 普通店易主后的保护期
      const disabled = this.busy || this.attacking || asset.attacking || cooling || protectedByTransfer;
      this.actionBtn.disabled = disabled;
      this.actionBtn.classList.add('danger');
      if (cooling || protectedByTransfer) this.actionBtn.classList.add('cooling'); else this.actionBtn.classList.remove('cooling');
      this.hintEl.classList.add('hidden');

      if (cooling) {
        // 显示冷却块 + 本地倒计时定时器（首次进入时初始化 expireAt）
        if (this._cooldownExpireAt === 0) {
          this._cooldownExpireAt = Date.now() + asset.cooldownMs;
          this._startCooldownTimer();
        } else if (this._cooldownTimer === null) {
          // 定时器被停掉但 expireAt 还有效 → 重新启动
          this._startCooldownTimer();
        }
        this.actionBtn.textContent = '🛡 保护期内，无法发起踢馆';
      } else if (protectedByTransfer) {
        this._stopCooldownTimer();
        // 易主保护 / 新手安全期：只对他人视角显示（自己的店不会走到 other 分支）
        const reason = asset.ownerProtectedReason;
        if (reason === 'register') {
          this.actionBtn.textContent = '🛡 新手保护期 · 无法踢馆';
          this.messageEl.textContent = `${asset.ownerNick} 注册不足 4 小时，名下普通店铺受新手保护，暂不可踢馆`;
        } else if (reason === 'assets') {
          this.actionBtn.textContent = '🛡 新手保护期 · 无法踢馆';
          this.messageEl.textContent = `${asset.ownerNick} 总资产不足 1000 万，名下普通店铺受新手保护，暂不可踢馆`;
        } else {
          this.actionBtn.textContent = '🛡 刚易主 · 保护期内无法踢馆';
          if (this.messageEl.textContent === '') {
            const hours = asset.ownerProtectedHours || 0;
            this.messageEl.textContent = `${asset.ownerNick} 刚拿下这家普通店铺${hours ? `，还剩约 ${hours} 小时保护期` : '，保护期即将结束'}，暂不可踢馆`;
          }
        }
      } else {
        this._stopCooldownTimer();
        this.actionBtn.textContent = asset.attacking
          ? '这家店正在踢馆中…'
          : this.attacking
            ? '踢馆进行中，等待对方护盘…'
            : `出资 1.5 倍强行踢馆 · ${formatMoney(bid)}`;
      }
    } else {
      this.actionBtn.disabled = this.busy;
      this.actionBtn.textContent = this.busy
        ? '交易中…'
        : `甩出黑卡收购 · ${formatMoney(asset.acquirePrice ?? asset.price)}`;
      this.hintEl.classList.add('hidden');
      this.actionBtn.classList.remove('danger');
    }

    this._renderEcon(asset, mine, other);
  }

  /** 经济提示：回本时间 + 按当前收租预计攒钱时间（纯展示，不参与结算） */
  _renderEcon(asset, mine, other) {
    if (!this.econEl) return;
    const view = gameStore.view();
    const balance = view?.balance ?? 0;
    const rate = view?.rate ?? 0;
    let text = '';

    if (mine) {
      if (asset.level >= MAX_LEVEL) {
        text = `当前收租 ${formatMoney(asset.income)}/秒 · 已是顶级装修`;
      } else {
        const gain = incomeOf(asset, asset.level + 1) - asset.income;
        const payback = gain > 0 ? asset.upgradeCost / gain : Infinity;
        text = `升级后 +${formatMoney(gain)}/秒 · 回本约 ${formatDuration(payback)}`;
      }
    } else if (other) {
      const bid = attackBidOf(asset, asset.level);
      const gain = incomeOf(asset, asset.level);
      const payback = gain > 0 ? bid / gain : Infinity;
      const short = Math.max(0, bid - balance);
      const eta = short <= 0 ? 0 : (rate > 0 ? short / rate : Infinity);
      text = `夺店约 ${formatDuration(payback)} 回本 · ${short <= 0
        ? '余额已够，可直接踢馆'
        : rate > 0 ? `按当前收租约 ${formatDuration(eta)} 可攒够` : '暂无收租'}`;
    } else {
      const price = asset.acquirePrice ?? asset.price;
      const payback = asset.baseIncome > 0 ? price / asset.baseIncome : Infinity;
      const short = Math.max(0, price - balance);
      const eta = short <= 0 ? 0 : (rate > 0 ? short / rate : Infinity);
      text = `约 ${formatDuration(payback)} 回本 · ${short <= 0
        ? '余额已够，可直接收购'
        : rate > 0 ? `按当前收租约 ${formatDuration(eta)} 可买` : '暂无收租，先去街上捡金币'}`;
    }

    this.econEl.textContent = text;
    this.econEl.classList.toggle('hidden', !text);
  }

  async _onAction() {
    const asset = gameStore.asset(this.assetId);
    if (!asset || this.busy) return;

    // 他人独占 → 资本踢馆
    if (!asset.owned && asset.ownerId) {
      this.busy = true;
      this.messageEl.textContent = '';
      this._render();
      const result = await gameStore.attack(asset.id);
      this.busy = false;
      if (!result.ok) {
        this.messageEl.textContent = result.message || '踢馆失败';
        this._render();
        return;
      }
      this.attacking = true;
      showToast(`已对【${asset.name}】发起踢馆，对方有 15 秒护盘时间`);
      gameStore.emitEvent('attack', { shopId: asset.id, bid: attackBidOf(asset, asset.level) }); // 触发甩黑卡 3D 特效
      this._render();
      setTimeout(() => { this.attacking = false; this._render(); }, 16000);
      return;
    }

    this.busy = true;
    this.messageEl.textContent = '';
    this._render();

    const result = asset.owned
      ? await gameStore.upgrade(asset.id)
      : await gameStore.acquire(asset.id);

    this.busy = false;

    if (!result.ok) {
      if (result.body?.short) {
        this.messageEl.textContent = `还差 ${formatMoney(result.body.short)}，先去收租攒钱吧`;
      } else {
        this.messageEl.textContent = result.message || '操作失败';
      }
      this._render();
      return;
    }

    if (asset.owned) {
      showToast(`「${asset.name}」装修升级至 Lv.${result.level}`);
    } else {
      showToast(`你已收购「${asset.name}」，称号：${result.title}`);
      gameStore.emitEvent('acquire', { shopId: asset.id, price: asset.acquirePrice ?? asset.price }); // 金币音效 + 首富榜即时刷新
    }
    this._render();
  }

  /** 启动本地保护期倒计时定时器（每秒刷新圆环 + 文字 + status） */
  _startCooldownTimer() {
    if (this._cooldownTimer !== null) return;
    this.cooldownWrapEl?.classList.remove('hidden');
    this._tickCooldown();
    this._cooldownTimer = setInterval(() => this._tickCooldown(), 1000);
  }

  _stopCooldownTimer() {
    if (this._cooldownTimer !== null) {
      clearInterval(this._cooldownTimer);
      this._cooldownTimer = null;
    }
    this._cooldownExpireAt = 0;
    this.cooldownWrapEl?.classList.add('hidden');
    if (this.cooldownBarEl) this.cooldownBarEl.style.strokeDashoffset = '0';
  }

  _tickCooldown() {
    const remain = Math.max(0, this._cooldownExpireAt - Date.now());
    const totalSec = Math.ceil(remain / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;

    // 圆环进度（已过的时间越多 → dashoffset 越大 → 圆环越短）
    const progress = Math.min(1, Math.max(0, 1 - remain / COOLDOWN_TOTAL_MS));
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    if (this.cooldownBarEl) this.cooldownBarEl.style.strokeDashoffset = String(offset);

    // 倒计时文字
    if (this.cooldownCountEl) this.cooldownCountEl.textContent = `${mm}:${String(ss).padStart(2, '0')}`;

    // status 栏显示冷却进度
    this.statusEl.textContent = `🛡 保护期 · ${mm}:${String(ss).padStart(2, '0')} 后可攻`;

    if (remain <= 0) {
      this._stopCooldownTimer();
      // 状态已过，重新 render 让按钮恢复（服务端 state 可能还没刷新 cooldownMs，
      // 但我们本地先清掉定时器，UI 会显示「出资 1.5 倍」文案直到 gameStore 下一次 load）
      this._render();
    }
  }
}

/** 秒数 → 「30 秒 / 4 分钟 / 2.5 小时 / 1.2 天」 */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 90) return `${Math.round(seconds)} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / 86_400).toFixed(1)} 天`;
}
