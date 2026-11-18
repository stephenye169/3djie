/**
 * 资本轮回（Prestige）数值定义（前后端共用，唯一事实来源，零运行时依赖）
 *
 * 规则：
 * - 持有资产总身价（基础价 × 1.5^(等级-1) 之和）达到 500 亿时可轮回
 * - 轮回：清零现金 + 回收全部店铺 → 按「每 5 亿身价 = 1 张传世黑卡」换点数
 * - 黑卡点数点亮 3 棵永久天赋（各 5 级），轮回不清点数、不清任务
 * - 资本压制只作用于收购价与装修价，不影响踢馆出价/护盘（PvP 公平性）
 */
import { PRESTIGE_THRESHOLD, formatMoney } from './assets.js';

/** 轮回门槛：总身价 500 亿（shared/assets.js 已预留常量，这里重复导出便于单文件使用） */
export { PRESTIGE_THRESHOLD };

/** 黑卡点数换算单位：每 5 亿身价 = 1 张（刚好过线 = 100 张，保持轮回奖励体感不变） */
export const PRESTIGE_POINT_UNIT = PRESTIGE_THRESHOLD / 100;

/** 天赋最高等级 */
export const TALENT_MAX_LEVEL = 5;

/** 天赋升级价格阶梯（index = 当前等级 0-based：0 级升 1 级花 30 张） */
export const TALENT_COSTS = [30, 60, 120, 240, 480];

// ============ 效果公式（前后端同源） ============

/** 轮回可换黑卡张数：总身价 / 5 亿向下取整 */
export function prestigePointsOf(totalValue) {
  return Math.max(0, Math.floor((Number(totalValue) || 0) / PRESTIGE_POINT_UNIT));
}

/** 点金手：金币雨暴击率（基础 6%，每级 +4%，满级 26%） */
export function goldHandCritRate(level = 0) {
  const lv = clampLevel(level);
  return 0.06 + 0.04 * lv;
}

/** 点金手：金币雨暴击奖励（基础 50 万，每级 +30%，满级 125 万） */
export function goldHandCritReward(level = 0) {
  const lv = clampLevel(level);
  return Math.round(500_000 * (1 + 0.3 * lv));
}

/** 资本压制：收购价 / 装修价折扣系数（每级 -6%，满级 0.7） */
export function dominationFactor(level = 0) {
  const lv = clampLevel(level);
  return 1 - 0.06 * lv;
}

/** 躺平收租：家族分红速率系数（每级 +20%，满级 ×2） */
export function idleRentFactor(level = 0) {
  const lv = clampLevel(level);
  return 1 + 0.2 * lv;
}

function clampLevel(level) {
  return Math.max(0, Math.min(TALENT_MAX_LEVEL, Math.floor(Number(level) || 0)));
}

// ============ 天赋表（前端渲染 + 后端校验共用） ============

export const TALENTS = [
  {
    id: 'goldHand',
    name: '点金手',
    emoji: '🖐️',
    desc: '街头捡钱的手感越练越刁钻，金币雨更容易出暴击、暴击给得更多。',
    effect(level) {
      const base = Math.round(goldHandCritRate(0) * 100);
      return level <= 0
        ? `金币雨暴击率 ${base}% · 暴击奖励 ${formatMoney(goldHandCritReward(0))}`
        : `Lv.${level}：暴击率 ${Math.round(goldHandCritRate(level) * 100)}% · 暴击奖励 ${formatMoney(goldHandCritReward(level))}`;
    },
  },
  {
    id: 'capitalDomination',
    name: '资本压制',
    emoji: '🃏',
    desc: '名门望族见到黑卡自动让价：收购价与豪华装修价永久打折（踢馆不享受）。',
    effect(level) {
      const discount = Math.round((1 - dominationFactor(level)) * 100);
      return level <= 0
        ? '收购 / 装修全价'
        : `Lv.${level}：收购 / 装修 ${discount} 折（踢馆除外）`;
    },
  },
  {
    id: 'idleRent',
    name: '躺平收租',
    emoji: '🛋️',
    desc: '家族信托运作更高效，离线家族分红累积速率提升。',
    effect(level) {
      return level <= 0
        ? '分红速率基础值'
        : `Lv.${level}：分红速率 ×${(idleRentFactor(level)).toFixed(1)}`;
    },
  },
];

const TALENT_MAP = new Map(TALENTS.map((t) => [t.id, t]));

export function findTalent(id) {
  return TALENT_MAP.get(id) || null;
}

/** 从 talents_json 解析出的对象里读某项等级（0–5） */
export function talentLevelOf(talents, id) {
  return clampLevel(talents?.[id]);
}

/** 升到下一级的价格；已满级返回 null */
export function nextTalentCost(level = 0) {
  const lv = clampLevel(level);
  if (lv >= TALENT_MAX_LEVEL) return null;
  return TALENT_COSTS[lv];
}
