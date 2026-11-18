// 店铺信息数据
// 每个店铺对应场景中的一个 mesh（通过 userData.shopId 匹配）
import { findAsset, TIERS } from '../../shared/assets.js';

export const SHOPS = [
  {
    id: 'cafe',
    name: '街角咖啡',
    emoji: '☕',
    category: '餐饮 · 咖啡',
    desc: '一家温馨的社区咖啡店，提供手冲单品与现烤可颂，是午后休憩的好去处。',
    hours: '08:00 - 22:00',
    phone: '010-8888-0001',
    rating: 4.7,
    products: [
      { emoji: '☕', name: '手冲单品', price: 38, desc: '埃塞俄比亚耶加雪菲，花果香' },
      { emoji: '🥐', name: '黄油可颂', price: 18, desc: '法式手工现烤，层层酥脆' },
      { emoji: '🍰', name: '提拉米苏', price: 32, desc: '意式经典，马斯卡彭芝士' },
      { emoji: '🥛', name: '燕麦拿铁', price: 32, desc: '燕麦奶替代，醇香顺滑' }
    ]
  },
  {
    id: 'bakery',
    name: '麦香面包房',
    emoji: '🥐',
    category: '餐饮 · 烘焙',
    desc: '每日清晨现烤的欧式面包，主打天然酵母酸种与法式甜点。',
    hours: '07:00 - 21:00',
    phone: '010-8888-0002',
    rating: 4.6,
    products: [
      { emoji: '🍞', name: '酸种面包', price: 35, desc: '天然酵母发酵72小时' },
      { emoji: '🥖', name: '法棍', price: 15, desc: '外脆内软，传统法式' },
      { emoji: '🥐', name: '巧克力可颂', price: 22, desc: '比利时黑巧克力夹心' },
      { emoji: '🧁', name: '肉桂卷', price: 20, desc: '锡兰肉桂，糖霜淋面' }
    ]
  },
  {
    id: 'bookstore',
    name: '时光书店',
    emoji: '📚',
    category: '零售 · 图书',
    desc: '独立书店，精选人文与设计类书籍，设有阅读区与不定期分享会。',
    hours: '10:00 - 22:00',
    phone: '010-8888-0003',
    rating: 4.8,
    products: [
      { emoji: '📖', name: '设计中的设计', price: 68, desc: '原研哉著，设计美学经典' },
      { emoji: '📕', name: '百年孤独', price: 55, desc: '马尔克斯代表作，魔幻现实主义' },
      { emoji: '📓', name: '手账笔记本', price: 45, desc: '意大利进口纸张，A5尺寸' },
      { emoji: '✒️', name: '钢笔礼盒', price: 288, desc: '德国原产，书写流畅' }
    ]
  },
  {
    id: 'flower',
    name: '花语花坊',
    emoji: '💐',
    category: '零售 · 鲜花',
    desc: '提供鲜花订制、花束配送与花艺课程，主打当季时令花材。',
    hours: '09:00 - 20:00',
    phone: '010-8888-0004',
    rating: 4.5,
    products: [
      { emoji: '🌹', name: '红玫瑰花束', price: 168, desc: '11朵卡罗拉，浪漫告白' },
      { emoji: '🌷', name: '郁金香盆栽', price: 58, desc: '荷兰进口，多色可选' },
      { emoji: '💐', name: '混搭花束', price: 128, desc: '当季花材，花艺师搭配' },
      { emoji: '🪴', name: '多肉盆栽', price: 38, desc: '易养护，桌面摆件' }
    ]
  },
  {
    id: 'tech',
    name: '极客数码',
    emoji: '💻',
    category: '零售 · 数码',
    desc: '数码产品体验店，提供电脑、外设及维修服务，可现场试用。',
    hours: '10:00 - 22:00',
    phone: '010-8888-0005',
    rating: 4.4,
    products: [
      { emoji: '⌨️', name: '机械键盘', price: 399, desc: '红轴，RGB背光，87键' },
      { emoji: '🖱️', name: '无线鼠标', price: 159, desc: '人体工学，静音点击' },
      { emoji: '🎧', name: '降噪耳机', price: 899, desc: '主动降噪，30小时续航' },
      { emoji: '💾', name: '移动硬盘', price: 459, desc: '2TB，USB 3.2 高速传输' }
    ]
  },
  {
    id: 'wonton',
    name: '巷口馄饨铺',
    emoji: '🍜',
    category: '餐饮 · 小吃',
    desc: '巷口开了三十年的馄饨铺，皮薄馅鲜，一碗热气腾腾的常州味道。',
    hours: '06:30 - 20:30',
    phone: '010-8888-0006',
    rating: 4.6,
    products: [
      { emoji: '🥟', name: '鲜肉小馄饨', price: 12, desc: '现包现煮，汤头鲜甜' },
      { emoji: '🍜', name: '大排面', price: 22, desc: '酥炸大排，红汤细面' },
      { emoji: '🥚', name: '卤蛋', price: 3, desc: '老卤入味，配面一绝' }
    ]
  },
  {
    id: 'teahouse',
    name: '青果茶肆',
    emoji: '🍵',
    category: '餐饮 · 茶饮',
    desc: '临河而设的茶肆，一壶本地绿茶配几样茶点，听雨看船正好。',
    hours: '09:00 - 22:00',
    phone: '010-8888-0007',
    rating: 4.7,
    products: [
      { emoji: '🍵', name: '雨前绿茶', price: 48, desc: '本地明前茶，清香回甘' },
      { emoji: '🥮', name: '茶点拼盘', price: 28, desc: '麻糕、酥糖、蜜饯三样' },
      { emoji: '🌰', name: '桂花糖炒栗', price: 18, desc: '现炒现卖，甜糯不粘牙' }
    ]
  },
  {
    id: 'dessert',
    name: '糖芋苗小铺',
    emoji: '🍡',
    category: '餐饮 · 甜品',
    desc: '专做常州糖芋苗的小铺，红糖汤底、桂花糖露，甜到心里。',
    hours: '10:00 - 21:00',
    phone: '010-8888-0008',
    rating: 4.8,
    products: [
      { emoji: '🍡', name: '桂花糖芋苗', price: 15, desc: '桂花蜜浇头，软糯绵密' },
      { emoji: '🍮', name: '酒酿圆子', price: 12, desc: '小圆子配甜酒酿' },
      { emoji: '🥣', name: '藕粉圆子', price: 18, desc: '藕粉皮包芝麻馅' }
    ]
  },
  {
    id: 'milktea',
    name: '东牌坊奶茶铺',
    emoji: '🧋',
    category: '餐饮 · 茶饮',
    desc: '牌坊下第一家奶茶铺，黑糖珍珠现煮现卖，队能排到街心。',
    hours: '09:00 - 22:30',
    phone: '0519-8888-0009',
    rating: 4.5,
    products: [
      { emoji: '🧋', name: '黑糖珍珠鲜奶', price: 15, desc: '珍珠现煮，黑糖挂壁' },
      { emoji: '🍵', name: '桂花乌龙', price: 12, desc: '本地桂花窨制，清爽解腻' },
      { emoji: '🥤', name: '芋泥啵啵', price: 16, desc: '芋头现蒸，绵密带颗粒' }
    ]
  },
  {
    id: 'chenghuang',
    name: '阳湖县城隍庙戏楼',
    emoji: '🎭',
    category: '文化 · 戏楼',
    desc: '一百多年的老戏楼，梁上彩画未改，逢周末连唱两场。',
    hours: '10:00 - 21:00',
    phone: '0519-8888-0010',
    rating: 4.8,
    products: [
      { emoji: '🎫', name: '戏楼前排票', price: 180, desc: '前三排，能看清水袖' },
      { emoji: '🎟️', name: '戏楼后排票', price: 80, desc: '后排长凳，听个热闹' },
      { emoji: '🍵', name: '茶水瓜子', price: 20, desc: '一壶茶配一碟瓜子' }
    ]
  },
  {
    id: 'memory',
    name: '青果巷文化记忆馆',
    emoji: '🏛',
    category: '文化 · 展馆',
    desc: '以巷名界碑为镇馆之宝的小型展馆，讲这条巷子一千年的来路。',
    hours: '09:00 - 17:00',
    phone: '0519-8888-0011',
    rating: 4.6,
    products: [
      { emoji: '🎫', name: '记忆馆门票', price: 20, desc: '含常设展与临展' },
      { emoji: '📖', name: '青果巷导览手册', price: 35, desc: '手绘街区图，附地标典故' },
      { emoji: '✉️', name: '明信片一套', price: 25, desc: '八张，旧巷照片复刻' }
    ]
  },
  {
    id: 'songjiantang',
    name: '松健堂',
    emoji: '🌿',
    category: '文化 · 书斋',
    desc: '五进老宅改的书斋，收着字画、旧家具和一方天井。',
    hours: '09:30 - 18:00',
    phone: '0519-8888-0012',
    rating: 4.6,
    products: [
      { emoji: '🌿', name: '松健堂香囊', price: 45, desc: '艾草与陈皮，手工缝制' },
      { emoji: '🖌️', name: '手抄字帖', price: 68, desc: '掌柜亲笔，宣纸线装' },
      { emoji: '📚', name: '旧书一册', price: 120, desc: '民国旧版，品相随机' }
    ]
  },
  {
    id: 'zhaoyuanren',
    name: '赵元任故居',
    emoji: '🎼',
    category: '文化 · 故居',
    desc: '语言学家赵元任的旧居，琴房里还摆着那架老钢琴。',
    hours: '09:00 - 17:30',
    phone: '0519-8888-0013',
    rating: 4.7,
    products: [
      { emoji: '🎫', name: '故居门票', price: 25, desc: '含前厅、琴房、书房' },
      { emoji: '🎼', name: '《教我如何不想她》曲谱', price: 40, desc: '影印手稿版' },
      { emoji: '💿', name: '黑胶唱片', price: 260, desc: '赵元任作品选，复刻发行' }
    ]
  },
  {
    id: 'yunhongyi',
    name: '恽鸿仪故居 · 可园',
    emoji: '🏯',
    category: '园林 · 可园',
    desc: '三亩见方的宅园，廊子绕、假山旧，雨天听水最好。',
    hours: '09:00 - 17:00',
    phone: '0519-8888-0014',
    rating: 4.7,
    products: [
      { emoji: '🎫', name: '可园门票', price: 30, desc: '含全园导览' },
      { emoji: '🍵', name: '园中茶席', price: 88, desc: '水榭一席，两泡绿茶' },
      { emoji: '🪨', name: '太湖石摆件', price: 320, desc: '园中同源石料，小件' }
    ]
  },
  {
    id: 'baguitang',
    name: '八桂堂总部',
    emoji: '🏦',
    category: '商业 · 总部',
    desc: '八桂堂刘国钧旧宅，如今是整条街最贵的会客与总部所在。',
    hours: '10:00 - 22:00',
    phone: '0519-8888-0015',
    rating: 4.9,
    products: [
      { emoji: '🍽️', name: '八桂堂会席', price: 1200, desc: '八人席，主厨定制' },
      { emoji: '🏮', name: '家宴定制', price: 8800, desc: '整进院子，含堂会' },
      { emoji: '📈', name: '私募份额', price: 50000, desc: '入伙一份，年结一次' }
    ]
  },
  {
    id: 'banyuan',
    name: '半园庄园',
    emoji: '🌸',
    category: '园林 · 庄园',
    desc: '一半是园、一半让给街坊的宅园，两株老桂秋天香透半条巷。',
    hours: '10:00 - 20:00',
    phone: '0519-8888-0016',
    rating: 4.8,
    products: [
      { emoji: '🍵', name: '半园茶会', price: 168, desc: '初一十五，园主亲泡' },
      { emoji: '🍶', name: '桂花酿', price: 98, desc: '园中老桂窨制，一坛' },
      { emoji: '📷', name: '园林写真', price: 880, desc: '一小时，含五张精修' }
    ]
  },
  {
    id: 'lihetang',
    name: '礼和堂会所',
    emoji: '📖',
    category: '会所 · 文化',
    desc: '礼和堂周氏旧宅，三楼是周有光图书馆，楼下是会所与茶室。',
    hours: '10:00 - 23:00',
    phone: '0519-8888-0017',
    rating: 4.7,
    products: [
      { emoji: '🎟️', name: '会所日票', price: 600, desc: '含茶室、书房、小戏台' },
      { emoji: '📚', name: '图书借阅卡', price: 200, desc: '周有光图书馆年卡' },
      { emoji: '🥃', name: '雪茄吧单次', price: 380, desc: '含一杯威士忌' }
    ]
  },
  {
    id: 'finance',
    name: '西入口金融中心',
    emoji: '🏙',
    category: '金融 · 总部',
    desc: '西入口的三层玻璃楼，整条街的资金流水都从这里过。',
    hours: '09:00 - 18:00',
    phone: '0519-8888-0018',
    rating: 4.4,
    products: [
      { emoji: '📊', name: '财富管理咨询', price: 2000, desc: '一对一，含资产体检' },
      { emoji: '🔐', name: '保险箱年租', price: 1200, desc: '标准格，年付' },
      { emoji: '🏦', name: '街铺贷月供', price: 5000, desc: '按揭试算，先付首月' }
    ]
  }
];

export function getShopById(id) {
  const shop = SHOPS.find((s) => s.id === id);
  if (shop) return shop;
  // 历史建筑等可收购资产没有商品数据，这里给出统一的展示降级
  const asset = findAsset(id);
  if (!asset) return null;
  return {
    id: asset.id,
    name: asset.name,
    emoji: asset.emoji,
    category: TIERS[asset.tier]?.name || '商业资产',
    desc: asset.taunts?.[0] || '',
    products: [],
  };
}
