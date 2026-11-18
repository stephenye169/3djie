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
  },

  // ===== 可收购资产：店内店员（商品数据为空，点柜台仍是收购/升级面板） =====
  milktea: {
    name: '奶茶西施',
    role: '店长',
    avatar: '\u{1F9CB}',
    greeting: '哟，是你啊。珍珠刚煮好，喝什么？先说好，别赊账。',
    topics: [
      { label: '招牌是哪杯', reply: '黑糖珍珠鲜奶，一天能卖两百杯。' },
      { label: '能少糖吗', reply: '可以，但少糖就没那个味了，我劝你别。' },
      { label: '这店卖不卖', reply: '五十万，一口价。看你这身行头，怕是拿不出来。' }
    ]
  },
  chenghuang: {
    name: '戏楼班主',
    role: '班主',
    avatar: '\u{1F3AD}',
    greeting: '票买了吗？今儿唱《牡丹亭》，后排还有座。',
    topics: [
      { label: '今天唱什么', reply: '《牡丹亭·游园》，头牌上场，锣鼓一响整条巷子都听得见。' },
      { label: '我能上台吗', reply: '先练三年水袖，再跟我提上台的事。' },
      { label: '戏楼多少年了', reply: '一百多年，梁上的彩画还是老的。' }
    ]
  },
  memory: {
    name: '道貌馆长',
    role: '馆长',
    avatar: '\u{1F3DB}',
    greeting: '欢迎参观青果巷文化记忆馆，展品请勿触摸。',
    topics: [
      { label: '镇馆之宝', reply: '一方明代青果巷的界碑，巷名就从这儿来的。' },
      { label: '能拍照吗', reply: '不开闪光灯就行。' },
      { label: '有讲解吗', reply: '每天两场，上午十点、下午三点，跟着人流走就是。' }
    ]
  },
  songjiantang: {
    name: '老派掌柜',
    role: '掌柜',
    avatar: '\u{1F33F}',
    greeting: '松健堂的规矩，先坐下喝口茶再说话。',
    topics: [
      { label: '堂里做什么', reply: '旧时是书斋，如今收着些字画和旧家具。' },
      { label: '老宅多少年', reply: '我这辈算第五代，梁柱一根没换过。' },
      { label: '收徒吗', reply: '收，但得先肯扫三年院子。' }
    ]
  },
  zhaoyuanren: {
    name: '名门管家',
    role: '管家',
    avatar: '\u{1F3BC}',
    greeting: '赵先生故居，请轻声。琴房的谱子不要动。',
    topics: [
      { label: '赵元任是谁', reply: '语言学家、作曲家，《教我如何不想她》就是他谱的曲。' },
      { label: '那架钢琴', reply: '按原样摆着的，琴键早没人弹了。' },
      { label: '参观路线', reply: '前厅、琴房、书房，从右手边开始走。' }
    ]
  },
  yunhongyi: {
    name: '园林主人',
    role: '园主',
    avatar: '\u{1F3EF}',
    greeting: '可园的廊子绕，跟着我走，别迷了。',
    topics: [
      { label: '园子多大', reply: '不大，三亩地，走一圈一炷香。' },
      { label: '那座假山', reply: '太湖石堆的，雨天听水声最好。' },
      { label: '能办宴吗', reply: '能，水榭摆四桌，多一桌都挤。' }
    ]
  },
  baguitang: {
    name: '财阀家主',
    role: '家主',
    avatar: '\u{1F3E6}',
    greeting: '八桂堂只谈生意。坐。',
    topics: [
      { label: '总部做什么', reply: '这条街的租约、账目、人情，都在这张桌上过。' },
      { label: '还收并购吗', reply: '收，但我只买能赚钱的，不买情怀。' },
      { label: '让我入个股', reply: '先拿五亿来，我们再谈。' }
    ]
  },
  banyuan: {
    name: '世家公子',
    role: '园主',
    avatar: '\u{1F338}',
    greeting: '半园今日不待客——罢了，既然进来了，就看看吧。',
    topics: [
      { label: '园名来历', reply: '半园半园，一半是园，一半是给街坊留的路。' },
      { label: '常办茶会吗', reply: '每月初一，来的都是些老面孔。' },
      { label: '园里有什么', reply: '一池、一亭、两株老桂，秋天香得整条巷子都知道。' }
    ]
  },
  lihetang: {
    name: '会长秘书',
    role: '秘书',
    avatar: '\u{1F4D6}',
    greeting: '请出示会员卡。没有？那先登记。',
    topics: [
      { label: '入会条件', reply: '名下资产过十亿，再两位会员推荐。' },
      { label: '会所设施', reply: '茶室、书房、小戏台，三楼是周有光图书馆。' },
      { label: '今天有活动吗', reply: '晚上有一场闭门分享，名单已经定了。' }
    ]
  },
  finance: {
    name: '金融大亨',
    role: '行长',
    avatar: '\u{1F3D9}',
    greeting: '西入口的每一笔钱都从我这儿过。说吧，借多少？',
    topics: [
      { label: '利率多少', reply: '看人。你这种，月息三分。' },
      { label: '整条街的资金', reply: '十八家店，流水最后都进这栋楼。' },
      { label: '有什么可投的', reply: '我不推荐，我只收利息。' }
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
