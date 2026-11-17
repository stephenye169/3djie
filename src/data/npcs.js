// 店内服务员（NPC）数据
// 与建筑模型、商铺商品数据分离：这里只描述"人和对话"，不涉及任何 3D 模型
export const SHOP_NPCS = {
  cafe: {
    name: '小雅',
    role: '咖啡师',
    avatar: '👩‍🍳',
    greeting: '欢迎光临街角咖啡～今天的耶加雪菲刚到货，要不要来一杯？',
    topics: [
      { label: '推荐一杯', reply: '推荐「雨前龙井拿铁」，茶香和咖啡的坚果味很搭，是我们的招牌。' },
      { label: '有什么优惠', reply: '两杯手冲送一份提拉米苏，工作日下午两点到五点第二杯半价。' },
      { label: '几点打烊', reply: '每天八点到晚上十点，周末会延时到十一点，随时来找我。' }
    ]
  },
  bakery: {
    name: '阿荣',
    role: '烘焙师',
    avatar: '👨‍🍳',
    greeting: '刚出炉的酸种面包还热着，香味飘了整条街～要尝尝吗？',
    topics: [
      { label: '今天有什么', reply: '酸种面包和巧克力可颂是刚出炉的，肉桂卷要再等十分钟。' },
      { label: '能切片吗', reply: '当然可以，法棍我帮您切成斜片，回去直接配黄油。' },
      { label: '怎么保存', reply: '常温放两天没问题，想久一点就冷冻，吃之前回炉三分钟。' }
    ]
  },
  bookstore: {
    name: '林晚',
    role: '店长',
    avatar: '🧑‍🎨',
    greeting: '欢迎，慢慢看。喜欢的话可以坐到窗边读一会儿。',
    topics: [
      { label: '推荐一本书', reply: '《设计中的设计》很适合入门，讲的是"看不见的设计"。' },
      { label: '有阅读区吗', reply: '窗边两张桌子都可以坐，点杯咖啡就能待一下午。' },
      { label: '办读书会吗', reply: '每月最后一个周六有分享会，门口小黑板会写主题。' }
    ]
  },
  flower: {
    name: '阿蛮',
    role: '花艺师',
    avatar: '💁‍♀️',
    greeting: '今天的花材很新鲜，玫瑰和郁金香都是早上到的。',
    topics: [
      { label: '送人推荐', reply: '送朋友选混搭花束，色彩柔和不挑人；表白就红玫瑰最直接。' },
      { label: '怎么养得久', reply: '两天换一次水，剪掉斜口，避开空调风口，能多开一周。' },
      { label: '可以定制吗', reply: '可以，告诉我预算和场合，我帮您搭配。' }
    ]
  },
  tech: {
    name: '阿哲',
    role: '技术顾问',
    avatar: '🧑‍💻',
    greeting: '随便体验，键盘鼠标都可以试，有想了解的配置问我。',
    topics: [
      { label: '键盘怎么选', reply: '办公选红轴静音，游戏选银轴触发快，担心吵就用静音红轴。' },
      { label: '能试用吗', reply: '都能试，耳机也可以连手机听，戴上感受一下降噪。' },
      { label: '有保修吗', reply: '国行正品，整机一年保修，外设两年只换不修。' }
    ]
  },
  wonton: {
    name: '阿福',
    role: '馄饨师傅',
    avatar: '👨‍🍳',
    greeting: '来啦？馄饨刚包好，汤是大骨熬的，先坐。',
    topics: [
      { label: '什么馅的', reply: '鲜肉荠菜馅，皮是自己擀的，薄得能透光。' },
      { label: '开多久了', reply: '三十年了，我阿爹那辈就在巷口摆摊。' },
      { label: '推荐一份', reply: '小馄饨配卤蛋，再来碗大排面，管饱。' }
    ]
  },
  teahouse: {
    name: '阿茶',
    role: '茶博士',
    avatar: '🧑‍🍵',
    greeting: '客官楼上请，临窗的位置正对着南市河。',
    topics: [
      { label: '什么茶好', reply: '雨前绿茶现在最鲜，泡三泡还有回甘。' },
      { label: '配什么点心', reply: '茶点拼盘是麻糕、酥糖、蜜饯，甜咸都有。' },
      { label: '能坐多久', reply: '一壶茶一下午，不赶人。' }
    ]
  },
  dessert: {
    name: '糖糖',
    role: '糖水西施',
    avatar: '👩‍🍳',
    greeting: '糖芋苗刚出锅，桂花蜜是今年新酿的。',
    topics: [
      { label: '糖芋苗是什么', reply: '小芋头加红糖汤，撒桂花，软糯甜香。' },
      { label: '还有别的吗', reply: '酒酿圆子和藕粉圆子也很受欢迎。' },
      { label: '能带走吗', reply: '可以，打包盒是保温的，回家还是热的。' }
    ]
  }
};

export const DEFAULT_NPC = {
  name: '店员',
  role: '店员',
  avatar: '🙂',
  greeting: '欢迎光临，有什么可以帮您？',
  topics: [
    { label: '随便看看', reply: '好的，慢慢看，需要的时候招呼我。' },
    { label: '营业时间', reply: '每天上午十点到晚上十点。' }
  ]
};

export function getShopNpc(shopId) {
  return SHOP_NPCS[shopId] || DEFAULT_NPC;
}
