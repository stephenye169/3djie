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
  dessert: { wall: 0xf7ece8, floor: 0x8a5a4a, accent: 0xd98a6a, light: 0xffe0c0 },
  // 以下为可收购资产（无独立商品数据，室内沿用同一套程序化布局）
  milktea: { wall: 0xfdeee6, floor: 0x8a5f4a, accent: 0xd9756a, light: 0xffe2c4 },
  chenghuang: { wall: 0xf2e6d8, floor: 0x5a3b30, accent: 0xb03a2e, light: 0xffd0a0 },
  memory: { wall: 0xeae6df, floor: 0x6b5b4a, accent: 0x9a8a6a, light: 0xfff0dd },
  songjiantang: { wall: 0xeee7da, floor: 0x6b4f37, accent: 0x8a7a4f, light: 0xffe8c0 },
  zhaoyuanren: { wall: 0xece7e0, floor: 0x5f4a3a, accent: 0x8f7f6a, light: 0xfff2dc },
  yunhongyi: { wall: 0xeff0e6, floor: 0x6f5a44, accent: 0x7f9a6a, light: 0xfdf3d8 },
  baguitang: { wall: 0xe9e3d6, floor: 0x4a3a2c, accent: 0xa8894f, light: 0xffdfa8 },
  banyuan: { wall: 0xf1eee4, floor: 0x74594a, accent: 0xa88f6a, light: 0xfff0d5 },
  lihetang: { wall: 0xe8e6e0, floor: 0x4f4a44, accent: 0x8f8574, light: 0xfff3e0 },
  finance: { wall: 0xe6e9ee, floor: 0x3f4753, accent: 0x6f8fb3, light: 0xdfeaff }
};

export const DEFAULT_INTERIOR_STYLE = {
  wall: 0xf1ece4,
  floor: 0x8a6a4f,
  accent: 0xb08a5f,
  light: 0xffe4bb
};
