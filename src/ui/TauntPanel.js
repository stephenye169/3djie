import { gameStore } from '../state/game.js';
import { formatMoney } from '../../shared/assets.js';
import { lootMoney } from './LootFx.js';
import { showToast } from './toast.js';

/**
 * 碰瓷 NPC 对话面板：走近角落里的势利眼，用「钞能力」当场打脸
 * 对话与奖励文案来自 shared/tauntNpcs.js，奖励金额由服务端发放
 */
export class TauntPanel {
  constructor() {
    this.el = document.getElementById('taunt-panel');
    this.avatarEl = document.getElementById('taunt-avatar');
    this.nameEl = document.getElementById('taunt-name');
    this.placeEl = document.getElementById('taunt-place');
    this.rewardEl = document.getElementById('taunt-reward');
    this.textEl = document.getElementById('taunt-text');
    this.resultEl = document.getElementById('taunt-result');
    this.bullyBtn = document.getElementById('taunt-bully');
    this.leaveBtn = document.getElementById('taunt-leave');
    this.closeBtn = document.getElementById('taunt-close');

    this.npc = null;
    this.busy = false;
    this.done = false;

    this.bullyBtn.addEventListener('click', () => this._bully());
    this.leaveBtn.addEventListener('click', () => this.close());
    this.closeBtn.addEventListener('click', () => this.close());
  }

  open(npc) {
    if (!npc) return;
    this.npc = npc;
    this.busy = false;
    this.done = false;

    this.avatarEl.textContent = npc.avatar || '😤';
    this.nameEl.textContent = npc.name;
    this.placeEl.textContent = npc.place;
    this.rewardEl.textContent = `+¥${formatMoney(npc.reward)}`;
    this.textEl.textContent = npc.greeting;
    this.resultEl.textContent = '';
    this.resultEl.classList.remove('show');

    this.bullyBtn.disabled = false;
    this.bullyBtn.textContent = '用钞能力当场羞辱他';
    this.leaveBtn.textContent = '懒得理他';

    this.el.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    // 重放砸入动画
    const box = this.el.querySelector('.taunt-box');
    box.classList.remove('enter');
    void box.offsetWidth;
    box.classList.add('enter');
  }

  async _bully() {
    if (!this.npc || this.busy || this.done) return;
    this.busy = true;
    this.bullyBtn.disabled = true;
    this.bullyBtn.textContent = '正在甩黑卡…';

    const res = await gameStore.bully(this.npc.id);
    this.busy = false;

    if (!res.ok) {
      this.bullyBtn.disabled = false;
      this.bullyBtn.textContent = '用钞能力当场羞辱他';
      this.resultEl.textContent = res.message || '打脸失败';
      this.resultEl.classList.add('show');
      return;
    }

    this.done = true;
    this.resultEl.textContent = res.text || '对方当场跪地求饶！';
    this.resultEl.classList.add('show');
    this.bullyBtn.classList.add('hidden');
    this.leaveBtn.textContent = '扬长而去';
    lootMoney(res.reward, { crit: true, label: '打脸成功' });
    showToast(`打脸成功，到账 ¥${formatMoney(res.reward)}`);
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  close() {
    if (!this.isOpen()) return;
    this.el.classList.add('hidden');
    this.npc = null;
    this.bullyBtn.classList.remove('hidden');
  }
}
