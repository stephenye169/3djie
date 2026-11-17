/**
 * 青果巷街区布局数据（按公开资料近似还原）
 *
 * 坐标系约定（与场景一致）：
 * - 巷子沿 z 轴延伸，z = 0 为东入口（和平北路侧牌坊），往西 z 递减（负数）
 * - x = 0 为巷子中线，+x 为北侧，-x 为南侧
 * - 每栋建筑的 w 是临街面宽（沿 z），d 是进深（沿 x），h 是檐口高度
 *
 * 数据来源：青果巷官网游线、常州市政府/钟楼区政府资料、常州日报与 OSM 轮廓量测
 * 说明：体块尺寸为近似值，用于"位置关系正确"的 3D 地图，不等同于测绘数据。
 */

export const STREET = {
  halfWidth: 4.5, // 巷宽 9m（真实 4–6m，为第三人称漫游略放宽）
  eastZ: 14, // 东侧牌坊广场边缘
  westZ: -494, // 西入口（晋陵中路）
  // 可行走范围 = rects 的并集；顶层 minX/maxX/minZ/maxZ 是给金币雨等用的外接包络
  // 巷道开到临街立面（±4.5 处有建筑碰撞体兜底），东广场按铺装范围（±8，z 6–14）放宽
  bounds: {
    minX: -4.4, maxX: 4.4, minZ: -491, maxZ: 13.6,
    rects: [
      { minX: -4.4, maxX: 4.4, minZ: -491, maxZ: 13.6 }, // 巷道 + 牌坊
      { minX: -7.6, maxX: 7.6, minZ: 6, maxZ: 13.6 }      // 东入口广场
    ]
  },
  // 南市河：位于巷南、与巷平行
  river: { xNear: -25, xFar: -44, y: -0.9 },
  lanePavingDepth: 34 // 北侧支巷的进深
};

/** 北侧支巷（自东向西），与真实位置对应 */
export const LANES = [
  { name: '正素巷', z: -88, width: 5, length: 34 },
  { name: '天井巷', z: -300, width: 5, length: 34 },
  { name: '雪洞巷', z: -365, width: 5, length: 30 }
];

/**
 * 建筑列表（自东向西，尽量连续覆盖街面）
 * kind:
 *  - landmark  历史建筑/名人故居（真实名称，不可进入）
 *  - shop      可进入的店铺（shopId 关联 shops.js）
 *  - residence 临街民居（补足街面连续性）
 *  - stone     石柱等小品
 *
 * 面宽参考：临街 3–5 开间 = 10–16m；进深 3–5 进 = 30–45m
 *
 * model（可选）：这家建筑的真实 GLB 模型。留着不写 = 用程序化几何体。
 *  - 相对路径按 /models/ 解析（`model: 'cafe.glb'` → `/models/cafe.glb`），也可写 `/abs/path.glb` 或完整 http(s) URL
 *  - 也可不改数据、用 URL 参数批量试模型：`?models=/models` 时按 `<id>.glb` 自动匹配
 *  - 模型按 w/d/h 等比缩放并居中贴地；若模型已是真实尺度与原位，加 `modelFit: 'none'` 关闭适配
 *  - 朝街立面请朝 -x（北侧建筑）/ +x（南侧建筑）导出；加载失败自动回退程序化建筑
 */
export const BUILDINGS = [
  // ===== 北侧 =====
  { id: 'milktea', kind: 'shop', shopId: 'milktea', side: 'north', z: -12, w: 10, d: 16, h: 4.0, floors: 1 },
  { id: 'wonton', kind: 'shop', shopId: 'wonton', side: 'north', z: -24, w: 12, d: 18, h: 4.0, floors: 1 },
  { id: 'res-n-33', kind: 'residence', side: 'north', z: -33, w: 6, d: 16, h: 3.9, floors: 1 },
  { id: 'chenghuang', kind: 'landmark', shopId: 'chenghuang', name: '阳湖县城隍庙戏楼', side: 'north', z: -45, w: 18, d: 25, h: 8.0, floors: 2 },
  { id: 'dessert', kind: 'shop', shopId: 'dessert', side: 'north', z: -58, w: 8, d: 16, h: 4.0, floors: 1 },
  { id: 'memory', kind: 'landmark', shopId: 'memory', name: '青果巷文化记忆馆', side: 'north', z: -72, w: 20, d: 35, h: 6.4, floors: 2 },
  // 例：接入真实模型 → 放 public/models/cafe.glb，然后 `model: 'cafe.glb'`
  { id: 'cafe', kind: 'shop', shopId: 'cafe', side: 'north', z: -100, w: 12, d: 20, h: 6.2, floors: 2 },
  { id: 'bakery', kind: 'shop', shopId: 'bakery', side: 'north', z: -112, w: 12, d: 18, h: 3.9, floors: 1 },
  { id: 'res-n-124', kind: 'residence', side: 'north', z: -124, w: 12, d: 18, h: 4.2, floors: 1 },
  { id: 'res-n-138', kind: 'residence', side: 'north', z: -138, w: 16, d: 18, h: 4.2, floors: 1 },
  { id: 'songjiantang', kind: 'landmark', shopId: 'songjiantang', name: '松健堂', side: 'north', z: -155, w: 18, d: 45, h: 6.0, floors: 2 },
  { id: 'res-n-171', kind: 'residence', side: 'north', z: -171, w: 14, d: 18, h: 4.2, floors: 1 },
  { id: 'zhaoyuanren', kind: 'landmark', shopId: 'zhaoyuanren', name: '赵元任故居', side: 'north', z: -185, w: 14, d: 50, h: 6.2, floors: 2 },
  { id: 'res-n-200', kind: 'residence', side: 'north', z: -200, w: 12, d: 18, h: 4.0, floors: 1 },
  { id: 'bookstore', kind: 'shop', shopId: 'bookstore', side: 'north', z: -214, w: 16, d: 24, h: 6.4, floors: 2 },
  { id: 'res-n-230', kind: 'residence', side: 'north', z: -230, w: 16, d: 20, h: 4.2, floors: 1 },
  { id: 'res-n-246', kind: 'residence', side: 'north', z: -246, w: 16, d: 20, h: 4.2, floors: 1 },
  { id: 'res-n-262', kind: 'residence', side: 'north', z: -262, w: 16, d: 20, h: 4.2, floors: 1 },
  { id: 'res-n-278', kind: 'residence', side: 'north', z: -278, w: 16, d: 20, h: 4.2, floors: 1 },
  { id: 'res-n-291', kind: 'residence', side: 'north', z: -291, w: 10, d: 18, h: 4.0, floors: 1 },
  { id: 'res-n-309', kind: 'residence', side: 'north', z: -309, w: 12, d: 20, h: 4.0, floors: 1 },
  { id: 'jinshifang', kind: 'stone', name: '进士坊', side: 'north', z: -318, w: 1, d: 1, h: 4.2 },
  { id: 'res-n-321', kind: 'residence', side: 'north', z: -321, w: 12, d: 18, h: 4.0, floors: 1 },
  { id: 'yunhongyi', kind: 'landmark', shopId: 'yunhongyi', name: '恽鸿仪故居 · 可园', side: 'north', z: -338, w: 18, d: 55, h: 6.2, floors: 2 },
  { id: 'res-n-352', kind: 'residence', side: 'north', z: -352, w: 10, d: 18, h: 4.0, floors: 1 },
  { id: 'res-n-372', kind: 'residence', side: 'north', z: -372, w: 8, d: 18, h: 4.0, floors: 1 },
  { id: 'baguitang', kind: 'landmark', shopId: 'baguitang', name: '八桂堂 · 刘国钧故居', side: 'north', z: -386, w: 18, d: 50, h: 6.2, floors: 2 },
  { id: 'res-n-400', kind: 'residence', side: 'north', z: -400, w: 10, d: 18, h: 4.0, floors: 1 },
  { id: 'banyuan', kind: 'landmark', shopId: 'banyuan', name: '半园', side: 'north', z: -412, w: 16, d: 20, h: 4.6, floors: 1 },
  { id: 'zhenhetang', kind: 'landmark', name: '贞和堂 · 唐荆川纪念馆', side: 'north', z: -418, w: 18, d: 45, h: 6.4, floors: 2 },
  { id: 'res-n-430', kind: 'residence', side: 'north', z: -430, w: 8, d: 18, h: 4.0, floors: 1 },
  { id: 'tech', kind: 'shop', shopId: 'tech', side: 'north', z: -440, w: 12, d: 18, h: 6.0, floors: 2 },
  { id: 'res-n-453', kind: 'residence', side: 'north', z: -453, w: 14, d: 20, h: 4.2, floors: 1 },
  { id: 'res-n-467', kind: 'residence', side: 'north', z: -467, w: 14, d: 20, h: 4.2, floors: 1 },
  { id: 'res-n-482', kind: 'residence', side: 'north', z: -482, w: 16, d: 20, h: 4.2, floors: 1 },

  // ===== 南侧（临河，最后一进常为二层）=====
  { id: 'res-s-26', kind: 'residence', side: 'south', z: -26, w: 16, d: 16, h: 6.2, floors: 2 },
  { id: 'teahouse', kind: 'shop', shopId: 'teahouse', side: 'south', z: -42, w: 16, d: 16, h: 6.2, floors: 2 },
  { id: 'flower', kind: 'shop', shopId: 'flower', side: 'south', z: -60, w: 12, d: 16, h: 4.0, floors: 1 },
  { id: 'res-s-78', kind: 'residence', side: 'south', z: -78, w: 20, d: 16, h: 6.2, floors: 2 },
  { id: 'res-s-100', kind: 'residence', side: 'south', z: -100, w: 22, d: 18, h: 6.2, floors: 2 },
  { id: 'res-s-124', kind: 'residence', side: 'south', z: -124, w: 24, d: 16, h: 6.2, floors: 2 },
  { id: 'res-s-150', kind: 'residence', side: 'south', z: -150, w: 26, d: 18, h: 6.2, floors: 2 },
  { id: 'res-s-178', kind: 'residence', side: 'south', z: -178, w: 28, d: 16, h: 6.2, floors: 2 },
  { id: 'res-s-206', kind: 'residence', side: 'south', z: -206, w: 26, d: 18, h: 6.2, floors: 2 },
  { id: 'res-s-234', kind: 'residence', side: 'south', z: -234, w: 28, d: 16, h: 6.2, floors: 2 },
  { id: 'res-s-262', kind: 'residence', side: 'south', z: -262, w: 26, d: 18, h: 6.2, floors: 2 },
  { id: 'res-s-290', kind: 'residence', side: 'south', z: -290, w: 28, d: 16, h: 6.2, floors: 2 },
  { id: 'res-s-318', kind: 'residence', side: 'south', z: -318, w: 26, d: 18, h: 6.2, floors: 2 },
  { id: 'res-s-346', kind: 'residence', side: 'south', z: -346, w: 28, d: 16, h: 6.2, floors: 2 },
  { id: 'res-s-374', kind: 'residence', side: 'south', z: -374, w: 26, d: 18, h: 6.2, floors: 2 },
  { id: 'res-s-402', kind: 'residence', side: 'south', z: -402, w: 28, d: 16, h: 6.2, floors: 2 },
  { id: 'res-s-424', kind: 'residence', side: 'south', z: -424, w: 14, d: 16, h: 6.2, floors: 2 },
  { id: 'lihetang', kind: 'landmark', shopId: 'lihetang', name: '礼和堂 · 周有光图书馆', side: 'south', z: -440, w: 18, d: 30, h: 6.4, floors: 2 },
  { id: 'res-s-461', kind: 'residence', side: 'south', z: -461, w: 22, d: 18, h: 6.2, floors: 2 },
  { id: 'res-s-482', kind: 'residence', side: 'south', z: -482, w: 18, d: 16, h: 6.2, floors: 2 },
  { id: 'finance', kind: 'shop', shopId: 'finance', side: 'south', z: -10, w: 16, d: 20, h: 8.4, floors: 3 }
];

/** 东入口牌坊 */
export const PAIFANG = { z: 0, height: 7.2, width: 12 };

/** 西入口（晋陵中路）收口墙 */
export const WEST_GATE = { z: -492, width: 12, height: 4.2 };
