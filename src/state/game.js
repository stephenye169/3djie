/**
 * 游戏状态（前端唯一事实来源的本地镜像）
 *
 * - 真值永远在服务端：load() 拉 /api/game/state
 * - 本地只做「每秒跳钱」的视觉补间，不参与任何结算
 * - 任何收购/升级成功后整体替换 state，避免前后端数值漂移
 */
import { api } from '../api/client.js';

class GameStore {
  constructor() {
    this.state = null;
    this.error = null;
    this._baseBalance = 0;
    this._baseAt = Date.now();
    this._divPending = 0;   // 家族分红：服务端已累积金额（加载时快照）
    this._divAt = Date.now(); // 快照时间，之后按 ratePerHour 本地补间
    this._listeners = new Set();
    this._eventListeners = new Set(); // 结果事件总线（秘书 HUD 等表现层消费）
    this._timer = null;
  }

  /** 订阅「结果事件」：收购 / 升级 / 分红 / 任务 / 暴击 / 护盘（纯表现层，不参与结算） */
  onEvent(fn) {
    this._eventListeners.add(fn);
    return () => this._eventListeners.delete(fn);
  }

  /**
   * 抛出一个结果事件
   * @param {string} kind
   * @param {object} [payload]
   */
  emitEvent(kind, payload = {}) {
    for (const fn of this._eventListeners) {
      try {
        fn(kind, payload);
      } catch (err) {
        console.warn('[game] 事件监听异常:', err?.message || err);
      }
    }
  }

  subscribe(fn) {
    this._listeners.add(fn);
    fn(this.view());
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const v = this.view();
    this._listeners.forEach((fn) => fn(v));
  }

  /** 每秒刷新一次显示用余额 */
  startTicking() {
    if (this._timer) return;
    this._timer = setInterval(() => this._emit(), 1000);
  }

  stopTicking() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _resetClock() {
    this._baseBalance = this.state?.user?.balance ?? 0;
    this._baseAt = Date.now();
  }

  /** 给 UI 用的视图：余额按收入速率本地补间 */
  view() {
    if (!this.state) return null;
    const rate = this.state.user.incomePerSec || 0;
    const earned = Math.floor(((Date.now() - this._baseAt) / 1000) * rate);
    const divRate = this.state.dividend?.ratePerHour || 0;
    const divCap = divRate * (this.state.dividend?.capHours || 8);
    const dividendPending = Math.min(
      divCap || Infinity,
      Math.floor(this._divPending + (divRate * (Date.now() - this._divAt)) / 3_600_000)
    );
    return {
      ...this.state.user,
      balance: this._baseBalance + earned,
      rate,
      ownedCount: this.state.ownedCount,
      totalAssets: this.state.totalAssets,
      nextTitle: this.state.nextTitle,
      assets: this.state.assets,
      buffs: this.state.buffs || {},
      dividendPending,
      dividendRate: divRate,
      dividendSynergy: this.state.dividend?.synergyPct ?? 0,
      prestige: this.state.prestige,
      quests: this.state.quests,
    };
  }

  async load() {
    try {
      this.state = await api.gameState();
      this.error = null;
      this._resetClock();
      this._divPending = this.state.dividend?.pending || 0;
      this._divAt = Date.now();
      this.startTicking();
      this._emit();
      return this.state;
    } catch (err) {
      // 401 交给全局登录流程处理；其余错误先降级显示，不影响漫游
      this.error = err;
      console.warn('[game] 状态加载失败:', err.message);
      return null;
    }
  }

  get offline() {
    return this.state?.offline || { seconds: 0, earnings: 0 };
  }

  asset(id) {
    return this.state?.assets.find((a) => a.id === id) || null;
  }

  _apply(state) {
    if (!state) return;
    this.state = state;
    this._resetClock();
    this._emit();
  }

  /** 收购，返回 { ok, error } */
  async acquire(assetId) {
    try {
      const res = await api.acquire(assetId);
      this._apply(res.state);
      return { ok: true, asset: res.asset, title: res.title };
    } catch (err) {
      return { ok: false, message: err.message, body: err.body };
    }
  }

  /** 升级豪华装修 */
  async upgrade(assetId) {
    try {
      const res = await api.upgrade(assetId);
      this._apply(res.state);
      return { ok: true, level: res.level };
    } catch (err) {
      return { ok: false, message: err.message, body: err.body };
    }
  }

  get incomingAttack() {
    return this.state?.incomingAttack || null;
  }

  /** 发起资本踢馆 */
  async attack(assetId) {
    try {
      const res = await api.attack(assetId);
      return { ok: true, attack: res.attack };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /** 强力护盘 */
  async defend(attackId) {
    try {
      const res = await api.defend(attackId);
      this._apply(res.state);
      return { ok: true, message: res.message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /** 认栽，放弃店铺 */
  async surrender(attackId) {
    try {
      const res = await api.surrender(attackId);
      this._apply(res.state);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /** 新手引导：领取「龙王归来体验卡」（一次性 5000 万） */
  async grantIntro() {
    try {
      const res = await api.grantIntro();
      this.patchBalance(res.balance);
      if (this.state) this.state.intro = { granted: true };
      return { ok: true, amount: res.amount, balance: res.balance };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /** 当前全服首富（服务端下发；没有达门槛的玩家时为 null） */
  get top1() {
    return this.state?.top1 || null;
  }

  /** 我的膜拜红包状态：{ reward, cooldownMs } */
  get worship() {
    return this.state?.worship || { reward: 50000, cooldownMs: 0 };
  }

  /** 膜拜全服首富领红包（每人每小时一次，金额由服务端固定） */
  async worshipTop1(userId) {
    try {
      const res = await api.worship(userId);
      this.patchBalance(res.balance);
      if (this.state) {
        this.state.top1 = res.top1;
        this.state.worship = {
          reward: res.reward,
          cooldownMs: res.cooldownMs ?? 60 * 60 * 1000,
        };
      }
      return { ok: true, reward: res.reward, balance: res.balance };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status, body: err.body };
    }
  }

  /** 地图点击传送：服务端校验并扣除 ¥10 万 */
  async teleport(shopId) {
    try {
      const res = await api.teleport(shopId);
      this.patchBalance(res.balance);
      return { ok: true, cost: res.cost, balance: res.balance };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status, body: err.body };
    }
  }

  /** 服务端已把余额算好：只补余额，不整体重拉状态（拾取很频繁） */
  patchBalance(balance) {
    if (!this.state || balance == null) return;
    this.state.user.balance = Math.floor(Number(balance) || 0);
    this._resetClock();
    this._emit();
  }

  /** 拾取街道金币 / 财阀金币箱 / 客源金币（金额由服务端决定） */
  async collect(type = 'coin', shopId = null) {
    try {
      const res = type === 'shopflow'
        ? await api.collectShopFlow(shopId)
        : await api.collect(type);
      this.patchBalance(res.balance);
      return { ok: true, reward: res.reward, crit: res.crit, type: res.type, royalty: res.royalty };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 购买增益商品后本地立即合入 buff（服务端 buffs_json 已写入，免整包刷新） */
  patchBuffs(type, until) {
    if (!this.state || !type || !until) return;
    this.state.buffs = { ...(this.state.buffs || {}), [type]: until };
    this._emit();
  }

  /** 碰瓷 NPC：用钞能力当场羞辱 */
  async bully(npcId) {
    try {
      const res = await api.bully(npcId);
      this.patchBalance(res.balance);
      return { ok: true, reward: res.reward, text: res.text };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 家族分红一键领取 */
  async claimDividend() {
    try {
      const res = await api.claimDividend();
      this.patchBalance(res.balance);
      this._divPending = 0;
      this._divAt = Date.now();
      return { ok: true, reward: res.reward, seconds: res.seconds };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 领取单个任务奖励 */
  async claimQuest(questId) {
    try {
      const res = await api.claimQuest(questId);
      await this.load(); // 重新拉 state，quests 全量同步，余额也会由 load 的 _resetClock 处理
      return { ok: true, reward: res.reward, label: res.label };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 走路距离上报（节流由后端负责）。返回 ok 供 main.js 决定是否拉 state 刷新 quests */
  async walkedQuest(meters) {
    try {
      await api.walkedQuest(meters);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /** 资本轮回：清零全部现金与店铺，换传世黑卡点数（服务端校验门槛） */
  async prestige() {
    try {
      const res = await api.prestige();
      await this.load(); // 轮回后全量重拉：资产归零、称号回落、点数更新
      return {
        ok: true,
        points: res.points,
        totalValue: res.totalValue,
        rebirthCount: res.rebirthCount,
        blackCardPoints: res.blackCardPoints,
      };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 点亮 / 升级永久天赋（消耗黑卡点数） */
  async learnTalent(talentId) {
    try {
      const res = await api.learnTalent(talentId);
      await this.load(); // talents 在 user 里，重拉保证状态一致
      return { ok: true, level: res.level, cost: res.cost, blackCardPoints: res.blackCardPoints };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 街区众筹：项目列表（含我的股份与可领分红） */
  async crowdList() {
    try {
      return { ok: true, ...(await api.crowdList()) };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  /** 发起众筹（仅店主本人，tier≥3 黄金店铺） */
  async crowdCreate(assetId) {
    try {
      const res = await api.crowdCreate(assetId);
      await this.load();
      this.emitEvent('crowd-created', res);
      return { ok: true, project: res };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 入股（10 万金币的整数倍） */
  async crowdInvest(projectId, amount) {
    try {
      const res = await api.crowdInvest(projectId, amount);
      await this.load();
      return { ok: true, project: res.project };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /** 领取分红 */
  async crowdClaim(projectId) {
    try {
      const res = await api.crowdClaim(projectId);
      this.patchBalance(res.claimable);
      return { ok: true, claimable: res.claimable };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }
}

export const gameStore = new GameStore();
