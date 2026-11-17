import { gameStore } from '../state/game.js';
import { soundFx } from '../utils/audio.js';
import { formatMoney } from '../../shared/assets.js';
import { showToast } from './toast.js';

const WINDOW_MS = 15_000;
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

/**
 * 资本对决 · 危机警报
 * 他人对你的店铺发起恶意收购时，全屏红光 + 15 秒环形倒计时 + 护盘/认栽
 */
export class AttackAlert {
  /**
   * @param {{ onDefended?: (info: { attackId: string, shopName: string, cost: number }) => void }} [opts]
   *   onDefended：护盘成功时的表现层钩子（main.js 用来喷钞票雨 + 台词）
   */
  constructor({ onDefended } = {}) {
    this.onDefended = typeof onDefended === 'function' ? onDefended : null;
    this.el = document.getElementById('attack-alert');
    this.boxEl = this.el.querySelector('.attack-alert-box');
    this.textEl = document.getElementById('attack-text');
    this.attackerEl = document.getElementById('attack-attacker');
    this.shopEl = document.getElementById('attack-shop');
    this.shopEmojiEl = document.getElementById('attack-shop-emoji');
    this.bidEl = document.getElementById('attack-bid');
    this.costEl = document.getElementById('attack-cost');
    this.countEl = document.getElementById('attack-countdown');
    this.ringEl = document.getElementById('attack-ring-fg');
    this.defendBtn = document.getElementById('attack-defend');
    this.defendPriceEl = document.getElementById('attack-defend-price');
    this.giveupBtn = document.getElementById('attack-giveup');
    this.hintEl = document.getElementById('attack-hint');
    this.errorEl = document.getElementById('attack-error');
    this.verdictEl = document.getElementById('attack-verdict');

    // 议价 UI（防守方还价区 + 攻击方回应信息行）
    this.counterSectionEl = document.getElementById('attack-counter');
    this.counterToggleEl = document.getElementById('counter-toggle');
    this.counterPanelEl = document.getElementById('counter-panel');
    this.counterSliderEl = document.getElementById('counter-slider');
    this.counterPriceEl = document.getElementById('counter-price');
    this.counterRatioEl = document.getElementById('counter-ratio');
    this.counterSubmitEl = document.getElementById('counter-submit');
    this.counterInfoEl = document.getElementById('attack-counter-info');

    this.attack = null;
    this.busy = false;
    this.timer = null;
    this.totalMs = WINDOW_MS;
    this.lastSec = -1;
    this.verdictUntil = 0;
    this.audio = soundFx;
    this.chat = null;      // bind(chat) 注入：还价 WS 收发
    this.role = null;      // 'defender'（被踢方）| 'attacker'（踢馆方）

    if (this.ringEl) {
      this.ringEl.style.strokeDasharray = String(RING_C);
      this.ringEl.style.strokeDashoffset = '0';
    }

    this.defendBtn.addEventListener('click', () => (this.role === 'attacker' ? this._counterAccept() : this._defend()));
    this.giveupBtn.addEventListener('click', () => (this.role === 'attacker' ? this._counterReject() : this._surrender()));
    this.counterToggleEl?.addEventListener('click', () => this._toggleCounterPanel());
    this.counterSliderEl?.addEventListener('input', () => this._renderCounterPrice());
    this.counterSubmitEl?.addEventListener('click', () => this._submitCounterOffer());

    // 刷新页面后若仍有进行中的踢馆，自动恢复弹窗
    gameStore.subscribe(() => {
      if (this.attack) return;
      const incoming = gameStore.incomingAttack;
      if (incoming) this.show(incoming);
    });
  }

  /** main.js 注入 chat 客户端：还价 WS 收发 + 议价事件订阅 */
  bind(chat) {
    this.chat = chat;
    chat.on('counter_pending', (payload) => this.showCounter(payload));
    chat.on('counter_ack', (payload) => {
      // 还价已送达攻击方
      if (this.counterPanelEl) this.counterPanelEl.classList.add('hidden');
      if (this.counterToggleEl) {
        this.counterToggleEl.disabled = true;
        this.counterToggleEl.textContent = `💬 已还价 ¥${formatMoney(payload?.counterPrice)} · 等待对方应价`;
      }
      this.audio.tick(); // 还价发出确认音
      showToast(`还价已发出：¥${formatMoney(payload?.counterPrice)}，等待对方回应`);
    });
    chat.on('counter_rejected', () => {
      showToast('对方拒绝了你的还价，对抗继续——到期按原出价成交');
      if (this.counterToggleEl) {
        this.counterToggleEl.disabled = true;
        this.counterToggleEl.textContent = '💬 还价已被拒绝';
      }
    });
    chat.on('counter_reply_ack', (payload) => {
      if (payload?.status === 'rejected') showToast('你已拒绝还价，对抗继续');
      // accepted 时的成交由 shop_attack_result 结算推送处理
    });
  }

  show(attack) {
    if (this.attack?.attackId === attack.attackId) return;

    this.attack = attack;
    this.role = 'defender';
    this.busy = false;
    this.lastSec = -1;
    this.verdictUntil = 0;
    this.totalMs = Math.max(1000, Math.min(WINDOW_MS, attack.expiresAt - Date.now()));

    const asset = gameStore.asset?.(attack.shopId);
    if (this.attackerEl) this.attackerEl.textContent = attack.attackerNick;
    if (this.shopEl) this.shopEl.textContent = attack.shopName;
    if (this.shopEmojiEl) this.shopEmojiEl.textContent = asset?.emoji || '🏪';
    if (this.bidEl) this.bidEl.textContent = formatMoney(attack.bid);
    if (this.costEl) this.costEl.textContent = formatMoney(attack.defendCost);
    if (this.defendPriceEl) this.defendPriceEl.textContent = formatMoney(attack.defendCost);
    if (this.textEl) {
      this.textEl.textContent =
        `傲慢的竞争对手【${attack.attackerNick}】正在对您的核心资产发起恶意收购，` +
        `${Math.ceil(this.totalMs / 1000)} 秒内不护盘，店铺当场易主。也可以讨价还价，` +
        `把收购款谈到 ${formatMoney(attack.counterMax)} 以内。`;
    }
    if (this.hintEl) this.hintEl.textContent = '';
    if (this.errorEl) this.errorEl.textContent = '';
    if (this.verdictEl) this.verdictEl.className = 'attack-verdict';

    this.defendBtn.disabled = false;
    this.giveupBtn.disabled = false;
    this.defendBtn.innerHTML = `强力护盘<small id="attack-defend-price">${formatMoney(attack.defendCost)}</small>`;
    this.giveupBtn.textContent = '认栽离场';

    // 还价区复位（每场一次；滑条范围由服务端下发的 counterMin/counterMax 决定）
    if (this.counterSectionEl) this.counterSectionEl.classList.remove('hidden');
    if (this.counterToggleEl) {
      this.counterToggleEl.disabled = false;
      this.counterToggleEl.textContent = '💬 讨价还价（每场一次）';
    }
    if (this.counterPanelEl) this.counterPanelEl.classList.add('hidden');
    if (this.counterSliderEl) {
      this.counterSliderEl.min = String(attack.counterMin ?? 0);
      this.counterSliderEl.max = String(attack.counterMax ?? 0);
      this.counterSliderEl.step = String(Math.max(1, Math.round((attack.bid || 0) * 0.05)));
      this.counterSliderEl.value = String(attack.counterMin ?? 0);
      this._renderCounterPrice();
    }

    this.el.classList.remove('hidden', 'urgent');
    // 重放砸落入场动画
    this.boxEl.classList.remove('enter');
    void this.boxEl.offsetWidth;
    this.boxEl.classList.add('enter');

    this.audio.siren();
    document.body.classList.add('attack-shake');
    setTimeout(() => document.body.classList.remove('attack-shake'), 620);

    this._tick();
    this.timer = setInterval(() => this._tick(), 200);
  }

  /** 攻击方视角：对方提出还价，同意（补差价立即成交）或拒绝（继续对抗） */
  showCounter(payload) {
    if (!payload || this.role === 'defender') return; // 防守方正忙着自己的警报
    if (this.attack?.attackId === payload.attackId && this.role === 'attacker') {
      // 已在还价面板：仅更新金额
      this._renderCounterInfo(payload);
      return;
    }

    this.attack = payload;
    this.role = 'attacker';
    this.busy = false;
    this.lastSec = -1;
    this.verdictUntil = 0;
    this.totalMs = Math.max(1000, Math.min(WINDOW_MS, payload.expiresAt - Date.now()));

    if (this.attackerEl) this.attackerEl.textContent = payload.attackerNick;
    if (this.shopEl) this.shopEl.textContent = payload.shopName;
    if (this.shopEmojiEl) this.shopEmojiEl.textContent = '💬';
    if (this.bidEl) this.bidEl.textContent = formatMoney(payload.bid);
    if (this.costEl) this.costEl.textContent = formatMoney(payload.counterPrice);
    if (this.defendPriceEl) this.defendPriceEl.textContent = formatMoney(payload.counterPrice - payload.bid);

    if (this.textEl) {
      this.textEl.textContent =
        `【${payload.defenderNick}】对您的出价提出还价：${formatMoney(payload.counterPrice)}。` +
        `同意则立即按此价成交（补差 ${formatMoney(payload.counterPrice - payload.bid)}），` +
        `拒绝则继续 ${Math.ceil(this.totalMs / 1000)} 秒对抗。`;
    }
    if (this.hintEl) this.hintEl.textContent = '';
    if (this.errorEl) this.errorEl.textContent = '';
    if (this.verdictEl) this.verdictEl.className = 'attack-verdict';

    this.defendBtn.disabled = false;
    this.giveupBtn.disabled = false;
    this.defendBtn.innerHTML = `✅ 同意还价<small>补差 ${formatMoney(payload.counterPrice - payload.bid)}</small>`;
    this.giveupBtn.textContent = '❌ 拒绝还价';

    // 攻击方视角隐藏防守方还价区，显示还价信息行
    if (this.counterSectionEl) this.counterSectionEl.classList.add('hidden');
    this._renderCounterInfo(payload);

    this.el.classList.remove('hidden', 'urgent');
    this.boxEl.classList.remove('enter');
    void this.boxEl.offsetWidth;
    this.boxEl.classList.add('enter');

    this.audio.siren();
    this._tick();
    this.timer = setInterval(() => this._tick(), 200);
  }

  _renderCounterInfo(payload) {
    if (this.counterInfoEl) {
      this.counterInfoEl.classList.remove('hidden');
      this.counterInfoEl.textContent =
        `💬 ${payload.defenderNick} 还价 ${formatMoney(payload.counterPrice)}（原出价 ${formatMoney(payload.bid)} · 上限 ${formatMoney(payload.counterMax)})`;
    }
  }

  _toggleCounterPanel() {
    if (!this.counterPanelEl || this.role !== 'defender') return;
    this.counterPanelEl.classList.toggle('hidden');
    this._renderCounterPrice();
  }

  _renderCounterPrice() {
    if (!this.counterSliderEl || !this.counterPriceEl) return;
    const price = Number(this.counterSliderEl.value) || 0;
    const ratio = this.attack?.bid ? (price / this.attack.bid).toFixed(2) : '—';
    this.counterPriceEl.textContent = formatMoney(price);
    if (this.counterRatioEl) this.counterRatioEl.textContent = ratio;
  }

  async _submitCounterOffer() {
    if (this.busy || this.role !== 'defender' || !this.chat || !this.attack) return;
    const price = Number(this.counterSliderEl?.value) || 0;
    this.busy = true;
    this.counterSubmitEl.disabled = true;
    this.chat.counterOffer(this.attack.attackId, price);
    // 结果由 counter_ack（成功）或 error（服务端拒绝，toast）回调处理
    setTimeout(() => {
      this.busy = false;
      if (this.counterSubmitEl) this.counterSubmitEl.disabled = false;
    }, 1200);
  }

  async _counterAccept() {
    if (this.busy || !this.chat || !this.attack) return;
    this.busy = true;
    this.defendBtn.disabled = true;
    this.errorEl.textContent = '';
    this.chat.counterReply(this.attack.attackId, true);
    // 成交由 shop_attack_result 推送收尾；资金不足等服务端拒绝走 error toast
    setTimeout(() => { this.busy = false; }, 1200);
  }

  _counterReject() {
    if (!this.chat || !this.attack) return;
    this.chat.counterReply(this.attack.attackId, false);
    this.close();
    showToast('已拒绝还价，对抗继续');
    gameStore.load();
  }

  _tick() {
    if (!this.attack) return;
    const remain = Math.max(0, this.attack.expiresAt - Date.now());
    const secs = Math.ceil(remain / 1000);

    if (secs !== this.lastSec) {
      this.lastSec = secs;
      if (this.countEl) this.countEl.textContent = String(secs);
      if (secs <= 5 && secs > 0) this.audio.tick();
    }

    if (this.ringEl) {
      const ratio = Math.max(0, Math.min(1, remain / this.totalMs));
      this.ringEl.style.strokeDashoffset = String(RING_C * (1 - ratio));
    }

    const urgent = remain <= 5000;
    this.el.classList.toggle('urgent', urgent);

    // 余额检查按角色分派：防守方查护盘款，攻击方查还价补差
    if (!this.busy) {
      const balance = gameStore.view()?.balance ?? 0;
      if (this.role === 'attacker') {
        const need = (this.attack.counter || 0) - this.attack.bid;
        const lack = need - balance;
        const canPay = lack <= 0;
        this.defendBtn.disabled = !canPay;
        if (this.hintEl) {
          this.hintEl.textContent = canPay ? '' : `补差资金不足，还差 ${formatMoney(lack)}——可拒绝还价继续对抗`;
        }
      } else {
        const lack = this.attack.defendCost - balance;
        const canPay = lack <= 0;
        this.defendBtn.disabled = !canPay;
        if (this.hintEl) {
          this.hintEl.textContent = canPay ? '' : `资金不足，还差 ${formatMoney(lack)}`;
        }
      }
    }

    if (remain <= 0) {
      this._clearTimer();
      if (this.role === 'attacker') {
        // 攻击方：主倒计时到点由服务端按原出价成交（shop_attack_result 随后到达）
        this.close();
        gameStore.load();
        return;
      }
      this._verdict('captured');
      showToast('护盘超时，店铺已被强行收购（收购款将自动入账）');
      gameStore.load();
    }
  }

  async _defend() {
    if (this.busy || !this.attack) return;
    this.busy = true;
    this.defendBtn.disabled = true;
    this.errorEl.textContent = '';

    const result = await gameStore.defend(this.attack.attackId);
    if (!result.ok) {
      this.busy = false;
      this.errorEl.textContent = result.message || '护盘失败';
      return;
    }
    // 先快照：_verdict 会在 2.5s 后 close() 清掉 this.attack
    const snapshot = {
      attackId: this.attack.attackId,
      shopName: this.attack.shopName,
      cost: this.attack.defendCost,
    };
    this._verdict('defended');
    this.onDefended?.(snapshot);
  }

  async _surrender() {
    if (this.busy || !this.attack) return;
    this.busy = true;
    this.errorEl.textContent = '';

    const result = await gameStore.surrender(this.attack.attackId);
    if (!result.ok) {
      this.busy = false;
      this.errorEl.textContent = result.message || '操作失败';
      return;
    }
    this._verdict('captured');
  }

  /** 盖章式结算：文案按角色与结果分派（防守方：护盘成功/资产易主；攻击方：收购成功/收购失败） */
  _verdict(outcome) {
    this._clearTimer();
    const defenderWin = outcome === 'defended';
    const success = this.role === 'attacker' ? outcome !== 'defended' : defenderWin;
    if (success) this.audio.success();
    else this.audio.fail();

    if (this.verdictEl) {
      const stamp = this.role === 'attacker'
        ? (outcome === 'defended' ? '收 购 失 败' : '收 购 成 功')
        : (defenderWin ? '护 盘 成 功' : '资 产 易 主');
      this.verdictEl.textContent = stamp;
      this.verdictEl.className = `attack-verdict show ${success ? 'success' : 'fail'}`;
    }
    this.verdictUntil = Date.now() + 2600;
    setTimeout(() => this.close(), 2500);
  }

  /** 服务端推送的结算结果：关闭弹窗 + 提示 + 刷新资产 */
  handleResult(payload) {
    if (!payload) {
      gameStore.load();
      return;
    }
    if (payload.message) showToast(payload.message);
    gameStore.load();

    // 本地已经盖过章，不再重复
    if (Date.now() < this.verdictUntil) return;
    if (!this.attack) return;
    this._verdict(payload.outcome);
  }

  _clearTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close() {
    this.attack = null;
    this.busy = false;
    this.role = null;
    this._clearTimer();
    this.el.classList.add('hidden');
    this.el.classList.remove('urgent');
    this.boxEl.classList.remove('enter');
    if (this.counterInfoEl) this.counterInfoEl.classList.add('hidden');
    document.body.classList.remove('attack-shake');
  }
}
