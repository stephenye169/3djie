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
