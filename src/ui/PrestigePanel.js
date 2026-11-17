import { gameStore } from '../state/game.js';
import { formatMoney } from '../../shared/assets.js';
import {
  TALENTS, talentLevelOf, nextTalentCost, TALENT_MAX_LEVEL, prestigePointsOf, PRESTIGE_THRESHOLD,
} from '../../shared/prestige.js';
import { showToast } from './toast.js';

/**
 * 资本轮回面板（T 键开关）
 *
 * - 轮回区：总身价进度条（门槛 500 亿）+ 可换黑卡预览 + 两段式确认按钮
 * - 天赋区：3 棵永久天赋（点金手 / 资本压制 / 躺平收租），黑卡点数升级
 * - 真值在服务端：进度条与点数全部来自 /api/game/state 的 prestige 字段
 */
export class PrestigePanel {
  constructor() {
    this.el = document.getElementById('prestige-panel');
    if (!this.el) return;

    this.countEl = document.getElementById('prestige-count');
    this.pointsEl = document.getElementById('prestige-points');
    this.valueEl = document.getElementById('prestige-value');
    this.barFillEl = document.getElementById('prestige-bar-fill');
    this.barPctEl = document.getElementById('prestige-bar-pct');
    this.previewEl = document.getElementById('prestige-preview');
    this.btnEl = document.getElementById('prestige-btn');
    this.confirmEl = document.getElementById('prestige-confirm');
    this.confirmPointsEl = document.getElementById('prestige-confirm-points');
    this.confirmYesEl = document.getElementById('prestige-confirm-yes');
    this.confirmNoEl = document.getElementById('prestige-confirm-no');
    this.listEl = document.getElementById('talent-list');
    this.tipEl = document.getElementById('prestige-tip');

    this.busy = false;
    this.confirming = false;

    document.getElementById('prestige-close')?.addEventListener('click', () => this.onRequestClose?.());
    this.btnEl.addEventListener('click', () => this._armConfirm());
    this.confirmNoEl.addEventListener('click', () => this._disarmConfirm());
    this.confirmYesEl.addEventListener('click', () => this._doPrestige());

    gameStore.subscribe((view) => this.render(view));
  }

  /** main.js 注入：关闭面板时同时恢复相机/输入 */
  onRequestClose = null;

  open() {
    this._disarmConfirm();
    this.el.classList.remove('hidden');
  }

  close() {
    this._disarmConfirm();
    this.el.classList.add('hidden');
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  render(view) {
    if (!view || !this.el) return;
    const prestige = view.prestige;
    if (!prestige) return;

    const totalValue = Math.floor(prestige.totalValue || 0);
    const threshold = prestige.threshold || PRESTIGE_THRESHOLD;
    const pct = Math.min(100, (totalValue / threshold) * 100);

    this.countEl.textContent = String(view.rebirthCount || 0);
    this.pointsEl.textContent = String(view.blackCardPoints || 0);
    this.valueEl.textContent = formatMoney(totalValue);
    this.barFillEl.style.width = `${pct.toFixed(2)}%`;
    this.barPctEl.textContent = pct >= 100
      ? '已达标'
      : `${pct < 1 ? pct.toFixed(2) : Math.floor(pct)}%`;

    if (prestige.ready) {
      const pts = prestige.pointsPreview ?? prestigePointsOf(totalValue);
      this.previewEl.textContent = `本轮可换 ${pts} 张传世黑卡 · 清零后现金与店铺归零，天赋与任务保留`;
      this.btnEl.disabled = this.busy;
      this.btnEl.textContent = this.busy ? '轮回中…' : '🔁 执行资本轮回';
      this.btnEl.classList.add('ready');
    } else {
      this.previewEl.textContent = `还差 ${formatMoney(threshold - totalValue)} 达到门槛 · 收购店铺 / 升级装修提升总身价`;
      this.btnEl.disabled = true;
      this.btnEl.textContent = `身价未达 ${formatMoney(threshold)} · 继续收租`;
      this.btnEl.classList.remove('ready');
    }

    this._renderTalents(view);
  }

  _renderTalents(view) {
    const points = Number(view.blackCardPoints) || 0;
    const talents = view.talents || {};

    this.listEl.innerHTML = '';
    for (const talent of TALENTS) {
      const level = talentLevelOf(talents, talent.id);
      const maxed = level >= TALENT_MAX_LEVEL;
      const cost = nextTalentCost(level);
      const affordable = !maxed && points >= cost;

      const card = document.createElement('div');
      card.className = 'talent-card';
      card.dataset.id = talent.id;

      // 5 格等级点
      const pips = Array.from({ length: TALENT_MAX_LEVEL }, (_, i) =>
        `<span class="talent-pip ${i < level ? 'on' : ''}"></span>`).join('');

      card.innerHTML = `
        <div class="talent-head">
          <span class="talent-emoji">${talent.emoji}</span>
          <div class="talent-name">${talent.name}</div>
          <div class="talent-pips">${pips}</div>
        </div>
        <div class="talent-desc">${talent.desc}</div>
        <div class="talent-effect">${talent.effect(level)}</div>
        <button class="talent-up" ${maxed || !affordable ? 'disabled' : ''}>
          ${maxed
            ? '已达顶级'
            : `升级 · ${cost} 张黑卡${affordable ? '' : `（还差 ${cost - points}）`}`}
        </button>
      `;
      this.listEl.appendChild(card);
    }

    // 绑定升级按钮
    this.listEl.querySelectorAll('button.talent-up:not([disabled])').forEach((btn) => {
      const id = btn.closest('.talent-card')?.dataset.id;
      if (id) btn.addEventListener('click', () => this._learn(id, btn));
    });
  }

  /** 轮回按钮第一击：展开确认条 */
  _armConfirm() {
    const view = gameStore.view();
    if (!view?.prestige?.ready || this.busy) return;
    this.confirming = true;
    this.confirmPointsEl.textContent = String(view.prestige.pointsPreview);
    this.confirmEl.classList.remove('hidden');
    this.btnEl.disabled = true;
  }

  _disarmConfirm() {
    this.confirming = false;
    this.confirmEl.classList.add('hidden');
    // 恢复按钮状态（render 会按 ready/busy 重设）
    const view = gameStore.view();
    if (view?.prestige?.ready) this.btnEl.disabled = this.busy;
  }

  async _doPrestige() {
    if (this.busy) return;
    this.busy = true;
    this._disarmConfirm();
    this.render(gameStore.view());

    const res = await gameStore.prestige();
    this.busy = false;

    if (!res.ok) {
      showToast(res.message || '轮回失败');
      this.render(gameStore.view());
      return;
    }

    showToast(`资本轮回成功：+${res.points} 张传世黑卡，开启第 ${res.rebirthCount} 轮制霸！`);
    this.render(gameStore.view());
  }

  async _learn(talentId, btn) {
    if (this.busy) return;
    this.busy = true;
    btn.disabled = true;
    btn.textContent = '点亮中…';

    const res = await gameStore.learnTalent(talentId);
    this.busy = false;

    if (!res.ok) {
      showToast(res.message || '点亮失败');
      this.render(gameStore.view());
      return;
    }

    const talent = TALENTS.find((t) => t.id === talentId);
    showToast(`【${talent?.name || '天赋'}】升至 Lv.${res.level}，消耗 ${res.cost} 张黑卡`);
    this.render(gameStore.view());
  }
}
