/**
 * 可收购资产数值表（前后端共用，唯一事实来源）
 *
 * 数值设计原则：
 * - 回本时间统一控制在 100–220 秒，保证前期爽、后期不至于瞬间通关
 * - 价格按四级阶梯膨胀，收购后称号同步进化
 * - 升级（豪华装修）每级收益 ×1.6，升级费用按 ×1.8 递增，最高 5 级
 */

export const MAX_LEVEL = 5;
export const OFFLINE_CAP_MS = 24 * 60 * 60 * 1000; // 离线收益最多结算 24 小时
export const PRESTIGE_THRESHOLD = 5e10; // 资本轮回门槛：500 亿（约等于买下一家黄金店）
export const TELEPORT_COST = 100_000;   // 地图点击传送费用：¥10 万/次

/** 资产分级：决定前端色带与文案 */
export const TIERS = {
  1: { name: '普通店铺', label: '第一幕' },
  2: { name: '精品店铺', label: '第二幕' },
  3: { name: '精品店铺', label: '第三幕' },
  4: { name: '黄金店铺', label: '第四幕' },
};

/**
 * 18 个核心可收购资产（普通 7 / 精品 7 / 黄金 4）
 * id 与 layout.js 中建筑 id 一致；milktea / finance 为新增虚拟资产
 */
export const ASSETS = [
  // ===== 第一幕：初露锋芒 =====
  {
    id: 'milktea', name: '东牌坊奶茶铺', emoji: '🧋', tier: 1,
    price: 500_000, baseIncome: 5_000, manager: '奶茶西施',
    taunts: ['就你这身行头，也想进青果巷？', '奶茶都喝不起，还逛什么街。'],
  },
  {
    id: 'wonton', name: '巷口馄饨铺', emoji: '🍜', tier: 1,
    price: 800_000, baseIncome: 8_000, manager: '馄饨阿婆',
    taunts: ['馄饨都吃不起，还敢往巷子里钻？', '一碗十五块，嫌贵就去别处逛。'],
  },
  {
    id: 'cafe', name: '街角咖啡', emoji: '☕', tier: 1,
    price: 1_200_000, baseIncome: 12_000, manager: '势利眼店长',
    taunts: ['本店最低消费三位数，你消费得起吗？', '看什么看，买不起就出去。'],
  },
  {
    id: 'teahouse', name: '青果茶肆', emoji: '🍵', tier: 1,
    price: 1_500_000, baseIncome: 15_000, manager: '茶博士',
    taunts: ['茶要慢慢品，你这种人来喝都是浪费。', '没闲钱就别学人附庸风雅。'],
  },
  {
    id: 'bakery', name: '麦香面包房', emoji: '🥐', tier: 1,
    price: 2_000_000, baseIncome: 20_000, manager: '高傲烘焙师',
    taunts: ['一块可颂够你吃三天泡面了。', '闻闻香就行了，别伸手。'],
  },
  {
    id: 'dessert', name: '糖芋苗小铺', emoji: '🍡', tier: 1,
    price: 3_000_000, baseIncome: 27_000, manager: '糖水西施',
    taunts: ['这碗甜汤，你怕是只在梦里喝过。', '糖芋苗都要犹豫半天，还想当老板？'],
  },
  {
    id: 'flower', name: '花语花坊', emoji: '💐', tier: 1,
    price: 5_000_000, baseIncome: 45_000, manager: '冷面花艺师',
    taunts: ['这束花，抵你一个月工资。', '送不起就别耽误我时间。'],
  },

  // ===== 第二幕：名震全城 =====
  {
    id: 'bookstore', name: '时光书店', emoji: '📚', tier: 2,
    price: 20_000_000, baseIncome: 180_000, manager: '酸腐老板',
    taunts: ['书店是文化人的地方，你识几个字？', '买书？先摸摸口袋吧。'],
  },
  {
    id: 'tech', name: '极客数码', emoji: '💻', tier: 2,
    price: 60_000_000, baseIncome: 500_000, manager: '数码黄牛',
    taunts: ['这台机器你攒三年才买得起。', '别碰，碰坏了你赔不起。'],
  },
  {
    id: 'chenghuang', name: '阳湖县城隍庙戏楼', emoji: '🎭', tier: 2,
    price: 120_000_000, baseIncome: 900_000, manager: '戏楼班主',
    taunts: ['这戏楼一百年了，轮不到你指手画脚。', '台下看戏的，也配上台？'],
  },
  {
    id: 'memory', name: '青果巷文化记忆馆', emoji: '🏛', tier: 2,
    price: 200_000_000, baseIncome: 1_500_000, manager: '道貌馆长',
    taunts: ['文化是需要门槛的，你没有。', '捐不起就别谈情怀。'],
  },

  // ===== 第三幕：资本大鳄 =====
  {
    id: 'songjiantang', name: '松健堂', emoji: '🌿', tier: 3,
    price: 1_000_000_000, baseIncome: 8_000_000, manager: '老派掌柜',
    taunts: ['松健堂百年基业，你拿什么买？', '在这条街上，我说话才算数。'],
  },
  {
    id: 'zhaoyuanren', name: '赵元任故居', emoji: '🎼', tier: 3,
    price: 3_000_000_000, baseIncome: 20_000_000, manager: '名门管家',
    taunts: ['名门望族的地界，闲人免进。', '你家祖上，配与我同席吗？'],
  },
  {
    id: 'yunhongyi', name: '恽鸿仪故居 · 可园', emoji: '🏯', tier: 3,
    price: 10_000_000_000, baseIncome: 60_000_000, manager: '园林主人',
    taunts: ['这一园山水，你一辈子走不完。', '买园子？先掂量自己的斤两。'],
  },

  // ===== 第四幕：全球霸主 =====
  {
    id: 'baguitang', name: '八桂堂总部', emoji: '🏦', tier: 4,
    price: 50_000_000_000, baseIncome: 300_000_000, manager: '财阀家主',
    taunts: ['八桂堂的牌匾，你配碰吗？', '我一句话，就能让你在这条街消失。'],
  },
  {
    id: 'banyuan', name: '半园庄园', emoji: '🌸', tier: 4,
    price: 150_000_000_000, baseIncome: 800_000_000, manager: '世家公子',
    taunts: ['半园的客人，非富即贵，你算哪门子？', '别用你的身价，脏了我的地毯。'],
  },
  {
    id: 'lihetang', name: '礼和堂会所', emoji: '📖', tier: 4,
    price: 300_000_000_000, baseIncome: 1_500_000_000, manager: '会长秘书',
    taunts: ['会所会员名单里，没有你的名字。', '想进来？先证明你值这个价。'],
  },
  {
    id: 'finance', name: '西入口金融中心', emoji: '🏙', tier: 4,
    price: 500_000_000_000, baseIncome: 2_500_000_000, manager: '金融大亨',
    taunts: ['整条街的资金流，都在我手里。', '你那点钱，连我一天的利息都不够。'],
  },
];

const ASSET_MAP = new Map(ASSETS.map((a) => [a.id, a]));

export function findAsset(id) {
  return ASSET_MAP.get(id) || null;
}

/** 单店每秒收益：基础收益 × 1.6^(等级-1) */
export function incomeOf(asset, level = 1) {
  if (!asset) return 0;
  const lv = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1));
  return Math.round(asset.baseIncome * Math.pow(1.6, lv - 1));
}

/** 升到下一级的费用：资产价 × 0.8 × 1.8^(当前等级-1) */
export function upgradeCostOf(asset, level = 1) {
  if (!asset || level >= MAX_LEVEL) return null;
  return Math.round(asset.price * 0.8 * Math.pow(1.8, Math.max(0, level - 1)));
}

/** 资产当前身价：基础价 × 1.5^(等级-1)，踢馆出价按身价计算 */
export function assetValueOf(asset, level = 1) {
  if (!asset) return 0;
  return Math.round(asset.price * Math.pow(1.5, Math.max(0, Number(level) - 1)));
}

/** 踢馆出价 = 身价 × 1.5 */
export function attackBidOf(asset, level = 1) {
  return Math.round(assetValueOf(asset, level) * 1.5);
}

/** 称号阶梯：按已收购数量进化 */
export const TITLES = [
  { min: 15, title: '全球经济唯一的爹' },
  { min: 10, title: '千亿商业教父' },
  { min: 6, title: '千亿财阀' },
  { min: 3, title: '街区包租公' },
  { min: 1, title: '保安克星' },
  { min: 0, title: '街头路人甲' },
];

export function titleFor(count) {
  const n = Math.max(0, Number(count) || 0);
  return (TITLES.find((t) => n >= t.min) || TITLES[TITLES.length - 1]).title;
}

/** 距离下一个称号还差几家（已满级返回 null） */
export function nextTitle(count) {
  const n = Math.max(0, Number(count) || 0);
  const higher = TITLES.filter((t) => t.min > n).sort((a, b) => a.min - b.min)[0];
  return higher ? { title: higher.title, need: higher.min - n } : null;
}

/** 金额格式化：万 / 亿 / 万亿 */
export function formatMoney(value) {
  const v = Math.floor(Number(value) || 0);
  const trim = (num) => num.toFixed(2).replace(/\.?0+$/, '');
  if (v >= 1e12) return `${trim(v / 1e12)}万亿`;
  if (v >= 1e8) return `${trim(v / 1e8)}亿`;
  if (v >= 1e4) return `${trim(v / 1e4)}万`;
  return v.toLocaleString('zh-CN');
}
