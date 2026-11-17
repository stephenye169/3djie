import { formatMoney } from '../../shared/assets.js';

/**
 * 秘书 / 管家 HUD（README §19 情绪放大器 ④）
 *
 * - 事件驱动：分红领取、收租暴击、护盘成功、店铺升级/收购、任务领取、登顶首富
 * - 固定台词库 + 占位符填充（金额 / 店名 / 等级 / 离线时长）
 * - 首次使用选一位人设（贴脸助理 / 千金闺蜜 / 财神爷小仙童），选定后不换
 *   人设卡是右下角的小卡片，**不铺全屏、不挡操作**，可以「稍后再选」（留一个常驻小入口）
 * - 不打扰原则：非紧急台词每 5 分钟最多 1 条（护盘警报优先，不受限流）
 * - 右上角 🔔/🔕 可关掉动画与提示音，但文字照常显示
 *
 * 人设与静音偏好存在 localStorage（按账号区分）：本组件纯表现层，不参与任何结算。
 */

const PERSONAS = [
  { id: 'assistant', name: '贴身助理', avatar: '🕴️', addr: '老板' },
  { id: 'bestie', name: '千金闺蜜', avatar: '💃', addr: '姐' },
  { id: 'fairy', name: '财神小仙童', avatar: '🧚', addr: '善财' },
];

/** 非紧急台词的最小间隔（README：每玩家每 5 分钟最多 1 条） */
const QUIET_MS = 5 * 60 * 1000;
/** 护盘 / 被踢馆属于紧急事件，不限流 */
const URGENT = new Set(['defend', 'attack']);
/** 气泡停留时长 */
const SHOW_MS = 3600;

const money = (n) => `¥${formatMoney(Math.max(0, Math.round(Number(n) || 0)))}`;
const hoursText = (seconds) => {
  const h = Math.round((Number(seconds) || 0) / 3600);
  return h >= 1 ? `${h} 小时` : '一会儿';
};

/** 台词模板：{addr} 由人设填充 */
const LINES = {
  dividend: (v, p) => `${p.addr}您可算回来了！离线 ${hoursText(v.seconds)}，家族分红 ${money(v.reward)} 已经到账，隔壁街土豪都要气炸了！`,
  crit: (v, p) => `哇！暴击！${money(v.reward)}！${p.addr}您这手气，买张彩票吧～`,
  defend: (v, p) => `干得漂亮${p.addr}！${v.shopName ? `「${v.shopName}」保住了，` : ''}那家伙灰溜溜跑了，估计正在厕所哭呢 😂`,
  upgrade: (v) => `我的妈呀！「${v.shopName}」已经 Lv.${v.level} 了，再升就是纯金大门，要不要配俩保镖？`,
  acquire: (v, p) => `恭喜${p.addr}！「${v.shopName}」是您的了${v.title ? `，称号升到「${v.title}」` : ''}——从今天起这条街您说了算！`,
  quest: (v, p) => `任务收工！${v.label || '奖励'} ${v.reward ? money(v.reward) : ''} 到手，${p.addr}您这效率我服。`,
  top1: (v, p) => `👑 首富！身价 ${money(v.wealth)} 全服第一，现在整条街都看${p.addr}您脸色。`,
};

export class Secretary {
  constructor({ userId } = {}) {
    this.userId = userId || 'anon';
    this.persona = null;
    this.muted = localStorage.getItem(this._key('mute')) === '1';
    this.lastAt = 0;
    this._queue = null;
    this._pickDismissed = false;
    this._hideTimer = null;
    this._audio = null;
    this._build();
    this._loadPersona();
  }

  _key(kind) {
    return `qingguo_secretary_${kind}_${this.userId}`;
  }

  _build() {
    this.el = document.createElement('div');
    this.el.className = 'secretary hidden';
    this.el.innerHTML = `
      <div class="secretary-avatar">🕴️</div>
      <div class="secretary-bubble">
        <div class="secretary-head">
          <span class="secretary-name">秘书</span>
          <button class="secretary-mute" type="button" title="关闭动画与提示音（文字保留）">${this.muted ? '🔕' : '🔔'}</button>
        </div>
        <div class="secretary-text"></div>
      </div>
    `;
    document.body.appendChild(this.el);

    this.avatarEl = this.el.querySelector('.secretary-avatar');
    this.nameEl = this.el.querySelector('.secretary-name');
    this.textEl = this.el.querySelector('.secretary-text');
    this.muteBtn = this.el.querySelector('.secretary-mute');
    this.muteBtn.addEventListener('click', () => this.toggleMute());

    // 人设选择卡：右下角小卡片，不铺全屏，不打断操作
    this.pickEl = document.createElement('div');
    this.pickEl.className = 'secretary-pick hidden';
    this.pickEl.innerHTML = `
      <div class="secretary-pick-panel">
        <div class="secretary-pick-head">
          <span class="secretary-pick-title">选一位贴身管家</span>
          <button class="secretary-pick-close" type="button" data-act="dismiss" title="稍后再选">✕</button>
        </div>
        <div class="secretary-pick-sub">赚钱 / 护盘 / 登顶时她会冒出来捧场 · 选定后不可更换</div>
        <div class="secretary-pick-list">
          ${PERSONAS.map((p) => `
            <button class="secretary-pick-card" type="button" data-persona="${p.id}">
              <span class="secretary-pick-avatar">${p.avatar}</span>
              <span class="secretary-pick-name">${p.name}</span>
              <span class="secretary-pick-tag">${p.addr}</span>
            </button>
          `).join('')}
        </div>
        <button class="secretary-pick-later" type="button" data-act="dismiss">稍后再选</button>
      </div>
    `;
    document.body.appendChild(this.pickEl);
    this.pickEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'dismiss') {
        this._dismissPicker();
        return;
      }
      const id = e.target.closest('[data-persona]')?.dataset.persona;
      if (id) this._choosePersona(id);
    });

    // 未选人设时的常驻小入口（不挡画面，也不抢焦点）
    this.chip = document.createElement('button');
    this.chip.className = 'secretary-chip hidden';
    this.chip.type = 'button';
    this.chip.textContent = '🎭 选秘书';
    this.chip.addEventListener('click', () => this._showPicker());
    document.body.appendChild(this.chip);
  }

  _loadPersona() {
    const found = PERSONAS.find((p) => p.id === localStorage.getItem(this._key('persona')));
    if (!found) return;
    this.persona = found;
    this._applyPersona();
  }

  _applyPersona() {
    if (!this.persona) return;
    this.avatarEl.textContent = this.persona.avatar;
    this.nameEl.textContent = this.persona.name;
  }

  _choosePersona(id) {
    const found = PERSONAS.find((p) => p.id === id);
    if (!found) return;
    this.persona = found;
    localStorage.setItem(this._key('persona'), id);
    this._applyPersona();
    this.pickEl.classList.add('hidden');
    this.chip.classList.add('hidden');

    // 选人设期间被拦下的那条台词，选完立刻补播
    if (this._queue) {
      const { kind, vars } = this._queue;
      this._queue = null;
      this.say(kind, vars);
    }
  }

  /** 还没选人设：先弹一次右下角选择卡（不挡操作），被关掉后只留小入口 */
  _askPersona() {
    if (this._pickDismissed) {
      this._showChip();
      return;
    }
    this._showPicker();
  }

  _showPicker() {
    this.pickEl.classList.remove('hidden');
    this.chip.classList.add('hidden');
  }

  _dismissPicker() {
    this._pickDismissed = true;
    this.pickEl.classList.add('hidden');
    this._showChip();
  }

  _showChip() {
    if (this.persona) return;
    this.chip.classList.remove('hidden');
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(this._key('mute'), this.muted ? '1' : '0');
    this.muteBtn.textContent = this.muted ? '🔕' : '🔔';
    this.muteBtn.title = this.muted ? '已关闭动画与提示音（文字保留）' : '关闭动画与提示音（文字保留）';
  }

  /**
   * 说一句
   * @param {string} kind dividend | crit | defend | upgrade | acquire | quest | top1
   * @param {object} [vars] 台词占位符（reward / seconds / shopName / level / title / label / wealth）
   */
  say(kind, vars = {}) {
    const line = LINES[kind];
    if (!line) return;

    if (!this.persona) {
      this._queue = { kind, vars };
      this._askPersona();
      return;
    }

    const urgent = URGENT.has(kind);
    if (!urgent && Date.now() - this.lastAt < QUIET_MS) return;

    let text = '';
    try {
      text = line(vars || {}, this.persona);
    } catch {
      return;
    }
    if (!text) return;

    this.lastAt = Date.now();
    this._show(text, { sound: !this.muted });
  }

  _show(text, { sound = true } = {}) {
    this.textEl.textContent = text;
    this.el.classList.remove('hidden', 'leaving');
    this.el.classList.toggle('no-anim', this.muted);
    if (sound) this._ding();

    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this._hide(), SHOW_MS);
  }

  _hide() {
    this.el.classList.add('leaving');
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this.el.classList.add('hidden');
      this.el.classList.remove('leaving');
    }, 260);
  }

  /** 极简合成音「叮」：不依赖音频文件，首次用户交互后自动解锁 */
  _ding() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this._audio) this._audio = new AC();
      if (this._audio.state === 'suspended') this._audio.resume().catch(() => {});
      const ctx = this._audio;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.85);
    } catch { /* 音频不可用就静默 */ }
  }
}
