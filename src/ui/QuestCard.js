import { gameStore } from '../state/game.js';
import { formatMoney } from '../../shared/assets.js';
import { lootMoney } from './LootFx.js';
import { showToast } from './toast.js';

/**
 * 左侧面板 · 商业任务列表
 * 实时显示 5 个常驻任务的进度，完成后按钮变亮可领
 */
export class QuestCard {
  constructor() {
    this.el = document.getElementById('quest-list');
    this.tipEl = document.getElementById('quest-tip');
    this.busy = new Set();
    gameStore.subscribe((view) => this.render(view));
  }

  render(view) {
    if (!this.el || !view?.quests) return;
    const quests = view.quests;

    // 统计概览
    const doneCount = quests.filter((q) => q.done).length;
    const claimedCount = quests.filter((q) => q.claimed).length;
    const totalReward = quests.reduce(
      (s, q) => s + (q.claimed ? 0 : (q.done ? q.reward : 0)),
      0
    );
    if (this.tipEl) {
      this.tipEl.textContent = claimedCount + doneCount === 0
        ? `5 项任务 · ${claimedCount}/5 已领`
        : `${claimedCount}/5 已领 · 可领 ¥${formatMoney(totalReward)}`;
    }

    this.el.innerHTML = '';
    for (const q of quests) {
      const row = document.createElement('div');
      row.className = 'quest-row';

      const pct = Math.min(100, Math.round((q.progress / Math.max(q.goal, 1)) * 100));
      const active = !q.claimed && q.done;
      const disabled = !!q.claimed;

      row.innerHTML = `
        <div class="quest-main">
          <div class="quest-title">${q.title}</div>
          <div class="quest-desc">${q.desc}</div>
          <div class="quest-bar">
            <div class="quest-fill" style="width:${pct}%"></div>
            <div class="quest-pct">${q.progress}/${q.goal}${q.unit || ''}</div>
          </div>
        </div>
        <button
          class="quest-reward ${active ? 'ready' : ''}"
          data-id="${q.id}"
          ${active ? '' : 'disabled'}
        >
          ${q.claimed ? '已领取' : `+¥${formatMoney(q.reward)}`}
        </button>
      `;
      row.dataset.id = q.id;
      this.el.appendChild(row);
    }

    // 每个按钮绑定领取
    this.el.querySelectorAll('button.quest-reward').forEach((btn) => {
      const id = btn.dataset.id;
      btn.addEventListener('click', () => this._claim(id, btn));
    });
  }

  async _claim(id, btn) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    btn.disabled = true;
    btn.textContent = '领取中…';

    const res = await gameStore.claimQuest(id);
    this.busy.delete(id);

    if (!res.ok) {
      btn.textContent = '失败重试';
      btn.disabled = false;
      showToast(res.message || '领取失败');
      return;
    }
    lootMoney(res.reward, { label: res.label?.slice(0, 14) || '任务完成' });
    showToast(res.label || `任务完成：+¥${formatMoney(res.reward)}`);
    // 秘书台词（README §19 ④）：任务收工！
    gameStore.emitEvent('quest', { reward: res.reward, label: res.label });
  }
}
