import { gameStore } from '../state/game.js';
import { formatMoney } from '../../shared/assets.js';
import { showToast } from './toast.js';

const SHARE_UNIT = 100_000; // 10 万金币 = 1 股（与服务端 SHARE_UNIT 一致）

/**
 * 街区众筹扩建面板（GDD §4.3/4.4 投资玩法）：
 * - 项目列表：进行中（进度条 + 入股）/ 已成功（分红池 + 领取）/ 已解散（退款说明）
 * - 我的股份：投入金额、持股比例、可领分红
 * - 入口：资产卡（自己的 tier≥3 店铺）「📋 众筹扩建」按钮
 */
export class CrowdPanel {
  constructor() {
    this.el = document.getElementById('crowd-panel');
    if (!this.el) return;

    this.projectsEl = document.getElementById('crowd-projects');
    this.mineEl = document.getElementById('crowd-mine');
    this.preselectShopId = null;
    this.refreshTimer = null;

    document.getElementById('crowd-close')?.addEventListener('click', () => this.close());

    // 面板打开期间 15s 轮询刷新（分红池增长可见）
    setInterval(() => { if (this.isOpen()) this.refresh(); }, 15000);

    gameStore.subscribe(() => {
      if (this.isOpen()) this.refresh();
    });
  }

  open(preselectShopId = null) {
    this.preselectShopId = preselectShopId;
    this.el.classList.remove('hidden');
    this.refresh();
  }

  close() {
    this.el.classList.add('hidden');
    this.preselectShopId = null;
  }

  isOpen() {
    return this.el && !this.el.classList.contains('hidden');
  }

  async refresh() {
    const res = await gameStore.crowdList();
    if (!res.ok) {
      if (this.projectsEl) this.projectsEl.innerHTML = `<div class="crowd-empty">${res.message || '加载失败'}</div>`;
      return;
    }

    const projects = res.projects || [];
    this._renderProjects(projects, res.shareUnit);
    this._renderMine(projects);
  }

  _renderProjects(projects, shareUnit) {
    if (!this.projectsEl) return;
    this.projectsEl.innerHTML = '';

    // 入口引导：资产卡预选的店铺还没有项目 → 显示发起按钮
    const preselectProject = this.preselectShopId
      ? projects.find((p) => p.shop_id === this.preselectShopId && (p.status === 'active' || p.status === 'funded'))
      : null;
    if (this.preselectShopId && !preselectProject) {
      const intro = document.createElement('div');
      intro.className = 'crowd-create-row';
      intro.innerHTML = `<button id="crowd-create-btn" class="crowd-create-btn">📋 为当前店铺发起扩建众筹</button>`;
      this.projectsEl.appendChild(intro);
      intro.querySelector('#crowd-create-btn')?.addEventListener('click', async () => {
        const res = await gameStore.crowdCreate(this.preselectShopId);
        if (!res.ok) { showToast(res.message || '发起失败'); return; }
        showToast('扩建众筹已发起，全服通告已发布');
        this.refresh();
      });
    }

    if (!projects.length) {
      const empty = document.createElement('div');
      empty.className = 'crowd-empty';
      empty.textContent = '暂无众筹项目——收购一家黄金店铺（tier ≥ 3）并发起众筹，让大家一起投资扩建！';
      this.projectsEl.appendChild(empty);
      return;
    }

    for (const p of projects) {
      const card = document.createElement('div');
      card.className = 'crowd-card';

      const progress = p.target > 0 ? Math.min(100, Math.round((p.raised / p.target) * 100)) : 0;
      const statusText = {
        active: '众筹中',
        funded: '✅ 已达成 · 分红中',
        refunded: '未达标 · 已退款',
        disbanded: '店铺易主 · 已解散',
      }[p.status] || p.status;

      let actions = '';
      if (p.status === 'active') {
        const remainMin = Math.max(0, Math.ceil((p.deadline - Date.now()) / 60000));
        actions = `
          <div class="crowd-progress"><i style="width:${progress}%"></i></div>
          <div class="crowd-meta">已筹 ${formatMoney(p.raised)} / ${formatMoney(p.target)}（${progress}%）· 剩余 ${remainMin} 分钟</div>
          <div class="crowd-invest-row">
            <button class="crowd-invest" data-pid="${p.id}" data-amount="${SHARE_UNIT}">入股 ${formatMoney(SHARE_UNIT)}</button>
            <button class="crowd-invest" data-pid="${p.id}" data-amount="${SHARE_UNIT * 5}">×5</button>
            <button class="crowd-invest" data-pid="${p.id}" data-amount="${SHARE_UNIT * 10}">×10</button>
          </div>`;
      } else if (p.status === 'funded') {
        actions = `
          <div class="crowd-progress"><i style="width:100%"></i></div>
          <div class="crowd-meta">分红池 ${formatMoney(p.dividend_pool)} · 我的持股 ${p.myAmount > 0 ? `${((p.myAmount / (p.totalRaised || 1)) * 100).toFixed(1)}%` : '无'}</div>`;
      } else {
        actions = `<div class="crowd-meta">已结算 · 认缴资金已按规则处理</div>`;
      }

      card.innerHTML = `
        <div class="crowd-card-head">
          <span class="crowd-shop">${p.shopEmoji} ${p.shopName} <small>Lv.${p.level}</small></span>
          <span class="crowd-status s-${p.status}">${statusText}</span>
        </div>
        ${actions}
      `;
      this.projectsEl.appendChild(card);
    }

    // 绑定入股按钮
    this.projectsEl.querySelectorAll('button.crowd-invest').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.pid;
        const amount = Number(btn.dataset.amount);
        btn.disabled = true;
        const res = await gameStore.crowdInvest(pid, amount);
        if (!res.ok) { showToast(res.message || '入股失败'); btn.disabled = false; return; }
        soundFxTick();
        showToast(`入股成功：¥${formatMoney(amount)}（${Math.floor(amount / SHARE_UNIT)} 股）`);
        this.refresh();
      });
    });
  }

  _renderMine(projects) {
    if (!this.mineEl) return;
    const mine = projects.filter((p) => p.myAmount > 0);
    if (!mine.length) {
      this.mineEl.innerHTML = '<div class="crowd-empty">还没有参与任何众筹——入股后按持股比例长期分享店铺租金</div>';
      return;
    }
    this.mineEl.innerHTML = mine.map((p) => {
      const claimRow = p.status === 'funded' && p.dividendClaimable > 0
        ? `<button class="crowd-claim" data-pid="${p.id}">领取分红 ¥${formatMoney(p.dividendClaimable)}</button>`
        : `<span class="crowd-claim-none">${p.status === 'funded' ? '分红暂无可领' : '项目已结算'}</span>`;
      return `<div class="crowd-mine-row">
        <span class="crowd-mine-shop">${p.shopEmoji} ${p.shopName}</span>
        <span class="crowd-mine-amount">投入 ${formatMoney(p.myAmount)}</span>
        ${claimRow}
      </div>`;
    }).join('');

    this.mineEl.querySelectorAll('button.crowd-claim').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await gameStore.crowdClaim(btn.dataset.pid);
        if (!res.ok) { showToast(res.message || '领取失败'); btn.disabled = false; return; }
        showToast(`分红已入账 +¥${formatMoney(res.claimable)}`);
        this.refresh();
      });
    });
  }
}

/** 轻提示音（还价/入股确认共用 SoundFx，避免循环依赖直接 import） */
function soundFxTick() {
  import('../utils/audio.js').then(({ soundFx }) => soundFx.tick()).catch(() => {});
}
