// 店铺室内视觉配置（与商铺业务数据分离）
// 仅描述室内配色，实际布局由 InteriorManager 统一生成
export const INTERIOR_STYLES = {
  cafe: { wall: 0xf3ece1, floor: 0x8a5a3b, accent: 0xb07d4f, light: 0xffd9a0 },
  bakery: { wall: 0xf7efe2, floor: 0xa9784f, accent: 0xd9a066, light: 0xffe0b0 },
  bookstore: { wall: 0xefe7dc, floor: 0x6f4b32, accent: 0x8b5e3c, light: 0xffe6c0 },
  flower: { wall: 0xf2f0ea, floor: 0x9c7a5c, accent: 0x86a96f, light: 0xfff0d8 },
  tech: { wall: 0xe8ecf2, floor: 0x4b5563, accent: 0x7da7d9, light: 0xdbeafe },
  wonton: { wall: 0xf3eee6, floor: 0x7a5a3f, accent: 0xc98f5a, light: 0xffd9a0 },
  teahouse: { wall: 0xf1ece0, floor: 0x6f5439, accent: 0x8fa86f, light: 0xfff0cc },
  dessert: { wall: 0xf7ece8, floor: 0x8a5a4a, accent: 0xd98a6a, light: 0xffe0c0 }
};

export const DEFAULT_INTERIOR_STYLE = {
  wall: 0xf1ece4,
  floor: 0x8a6a4f,
  accent: 0xb08a5f,
  light: 0xffe4bb
};
