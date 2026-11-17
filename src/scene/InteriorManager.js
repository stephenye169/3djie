import * as THREE from 'three';
import { INTERIOR_STYLES, DEFAULT_INTERIOR_STYLE } from '../data/interiors.js';
import { getShopNpc } from '../data/npcs.js';

/**
 * 店铺室内场景管理器
 *
 * 采用"同场景传送"方案：每个室内房间建在街道场景之外的一个独立坐标区，
 * 玩家进入时传送到对应房间，退出时传送回街道。
 * 好处是复用同一套渲染器 / 灯光 / 碰撞 / 相机，不需要场景切换，进店无加载等待。
 *
 * 室内房间在首次进入时才构建（懒加载），避免拖慢首屏。
 * 当前为程序化室内占位实现；后续接入真实 GLB 室内模型时，只需替换 _buildRoom 内部。
 */

const ROOM_W = 14; // 房间宽（x）
const ROOM_D = 14; // 房间深（z）
const WALL_H = 3.4;
const WALL_T = 0.3;
const DOOR_W = 2.6;
const DOOR_H = 2.5;

const BASE_X = 600; // 室内区域起点（远离街道）
const GAP_X = 40; // 每个房间间距

export class InteriorManager {
  constructor(scene) {
    this.scene = scene;
    this.rooms = new Map();
    this.activeId = null;
    this._nextIndex = 0;
  }

  /** 进入（或首次构建）某店铺的室内，返回房间信息 */
  enter(shopId, shop) {
    let room = this.rooms.get(shopId);
    if (!room) {
      room = this._buildRoom(shopId, shop);
      this.rooms.set(shopId, room);
    }
    for (const [id, r] of this.rooms) {
      r.group.visible = id === shopId;
    }
    this.activeId = shopId;
    return room;
  }

  /** 离开当前室内（隐藏房间，但不销毁，便于再次进入） */
  leave() {
    if (!this.activeId) return;
    const room = this.rooms.get(this.activeId);
    if (room) room.group.visible = false;
    this.activeId = null;
  }

  _buildRoom(shopId, shop) {
    const style = INTERIOR_STYLES[shopId] || DEFAULT_INTERIOR_STYLE;
    const index = this._nextIndex++;
    const ox = BASE_X + index * GAP_X;
    const oz = 0;

    const group = new THREE.Group();
    group.position.set(ox, 0, oz);
    group.visible = false;

    const colliders = [];
    const wallMeshes = [];
    // 店内可点击物件（柜台 / 货架 / 商品 / 店员）
    const interactives = [];

    const mat = (color, opts = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });

    // 地板
    const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, 0.2, ROOM_D), mat(style.floor, { roughness: 0.95 }));
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    group.add(floor);

    // 天花板：正面朝下（rotation.x = +90°），只有站在室内抬头才看得到；
    // 从上方俯视时是背面被剔除，不会挡住第三人称相机，也避免墙顶上方露出天空。
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_W, ROOM_D),
      mat(style.wall, { roughness: 1 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_H;
    group.add(ceiling);

    // 三面实墙
    const back = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W, WALL_H, WALL_T), mat(style.wall));
    back.position.set(0, WALL_H / 2, -ROOM_D / 2);
    group.add(back);
    wallMeshes.push(back);

    const left = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, WALL_H, ROOM_D), mat(style.wall));
    left.position.set(-ROOM_W / 2, WALL_H / 2, 0);
    group.add(left);
    wallMeshes.push(left);

    const right = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, WALL_H, ROOM_D), mat(style.wall));
    right.position.set(ROOM_W / 2, WALL_H / 2, 0);
    group.add(right);
    wallMeshes.push(right);

    // 前墙（带门洞）
    const segW = (ROOM_W - DOOR_W) / 2;
    const frontL = new THREE.Mesh(new THREE.BoxGeometry(segW, WALL_H, WALL_T), mat(style.wall));
    frontL.position.set(-(DOOR_W / 2 + segW / 2), WALL_H / 2, ROOM_D / 2);
    group.add(frontL);
    wallMeshes.push(frontL);

    const frontR = new THREE.Mesh(new THREE.BoxGeometry(segW, WALL_H, WALL_T), mat(style.wall));
    frontR.position.set(DOOR_W / 2 + segW / 2, WALL_H / 2, ROOM_D / 2);
    group.add(frontR);
    wallMeshes.push(frontR);

    const header = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, WALL_H - DOOR_H, WALL_T), mat(style.wall));
    header.position.set(0, (DOOR_H + WALL_H) / 2, ROOM_D / 2);
    group.add(header);
    wallMeshes.push(header);

    // 踢脚线
    const skirtMat = mat(style.accent, { roughness: 0.7 });
    const skirtBack = new THREE.Mesh(new THREE.BoxGeometry(ROOM_W - 0.2, 0.12, 0.06), skirtMat);
    skirtBack.position.set(0, 0.06, -ROOM_D / 2 + WALL_T / 2 + 0.03);
    group.add(skirtBack);

    // 柜台
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.0, 0.9), mat(style.accent));
    counter.position.set(0, 0.5, -2.4);
    counter.castShadow = true;
    group.add(counter);

    const counterTop = new THREE.Mesh(
      new THREE.BoxGeometry(4.9, 0.08, 1.05),
      mat(0xf7f3ea, { roughness: 0.5 })
    );
    counterTop.position.set(0, 1.04, -2.4);
    group.add(counterTop);

    // 靠墙货架
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 0.35), mat(style.accent));
    shelf.position.set(0, 1.1, -ROOM_D / 2 + 0.45);
    group.add(shelf);

    // 货架上的商品装饰
    const productColors = [0xe8b07a, 0xd99a6c, 0xc9b18a, 0xe6c9a8, 0xb9c9a3];
    const shelfProducts = [];
    for (let i = 0; i < 10; i++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.36, 0.28),
        mat(productColors[i % productColors.length])
      );
      box.position.set(-3 + i * 0.66, 1.35 + (i % 2) * 0.55, -ROOM_D / 2 + 0.68);
      group.add(box);
      shelfProducts.push(box);
    }

    // 柜台 / 货架 / 商品 → 可点击打开商品卡片（店内购物）
    for (const mesh of [counter, counterTop, shelf, ...shelfProducts]) {
      mesh.userData.shopId = shopId;
      mesh.userData.kind = 'shop';
      interactives.push(mesh);
    }

    // 店员（服务员）：站在柜台后方，可点击交谈
    const npcData = getShopNpc(shopId);
    const npc = this._buildNpc(style, npcData);
    npc.position.set(1.6, 0, -3.6);
    group.add(npc);
    npc.traverse((obj) => {
      if (obj.isMesh || obj.isSprite) {
        obj.userData.shopId = shopId;
        obj.userData.kind = 'npc';
        interactives.push(obj);
      }
    });

    // 两张圆桌 + 凳
    const tableMat = mat(style.accent);
    const tableTopMat = mat(0xf7f3ea, { roughness: 0.5 });
    const tablePositions = [
      { x: -3.6, z: 1.2 },
      { x: 3.6, z: 1.2 }
    ];
    for (const pos of tablePositions) {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 24), tableTopMat);
      top.position.set(pos.x, 0.75, pos.z);
      group.add(top);

      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.75, 12), tableMat);
      leg.position.set(pos.x, 0.375, pos.z);
      group.add(leg);

      for (const offset of [-0.95, 0.95]) {
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 16), tableMat);
        stool.position.set(pos.x + offset, 0.225, pos.z);
        group.add(stool);
      }
    }

    // 店名招牌
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.5),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(shop.name, shop.category || '') })
    );
    sign.position.set(0, 2.5, -ROOM_D / 2 + WALL_T / 2 + 0.02);
    group.add(sign);

    // 门口出口标识
    const exitSign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.45),
      new THREE.MeshBasicMaterial({ map: makeSignTexture('出口 EXIT', '', true), transparent: true })
    );
    exitSign.position.set(0, DOOR_H + 0.42, ROOM_D / 2 - WALL_T / 2 - 0.02);
    exitSign.rotation.y = Math.PI;
    group.add(exitSign);

    // 出口光圈
    const exitRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 40),
      new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    exitRing.rotation.x = -Math.PI / 2;
    exitRing.position.set(0, 0.02, ROOM_D / 2 - 1.1);
    group.add(exitRing);

    // 室内照明独立于街道：
    // 房间网格放到 layer 1，太阳光只照 layer 0，避免阳光"穿墙"把室内墙面烧白
    const roomHemi = new THREE.HemisphereLight(0xfff3e2, 0x7a6a58, 1.15);
    roomHemi.position.set(0, WALL_H, 0);
    group.add(roomHemi);

    // 室内暖光：吊灯高度的点光，负责层次与暖调
    const light = new THREE.PointLight(style.light, 12, 16, 2);
    light.position.set(0, 2.3, 0);
    group.add(light);

    group.traverse((obj) => obj.layers.set(1));

    this.scene.add(group);
    group.updateMatrixWorld(true);

    // 碰撞体：墙体 + 柜台 + 货架 + 店员
    for (const mesh of [...wallMeshes, counter, shelf, npc]) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
    }

    return {
      group,
      shopId,
      colliders,
      interactives,
      groundY: 0,
      bounds: {
        minX: ox - ROOM_W / 2 + 0.6,
        maxX: ox + ROOM_W / 2 - 0.6,
        minZ: oz - ROOM_D / 2 + 0.6,
        maxZ: oz + ROOM_D / 2 - 0.6
      },
      spawn: { x: ox, z: oz + ROOM_D / 2 - 6.4 },
      exit: { x: ox, z: oz + ROOM_D / 2 - 1.1, radius: 0.95 }
    };
  }

  /** 店员模型（占位）：胶囊身体 + 头部 + 围裙 + 头顶名牌 */
  _buildNpc(style, npcData) {
    const group = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6d3ae, roughness: 0.8 });
    const clothMat = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.85 });
    const apronMat = new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2f2622, roughness: 0.9 });

    // 身体
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.62, 4, 12), clothMat);
    torso.position.y = 1.02;
    torso.castShadow = true;
    group.add(torso);

    // 围裙
    const apron = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.06), apronMat);
    apron.position.set(0, 0.95, 0.27);
    group.add(apron);

    // 头部 + 头发
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 18), skinMat);
    head.position.y = 1.72;
    head.castShadow = true;
    group.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.255, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hairMat
    );
    hair.position.y = 1.74;
    group.add(hair);

    // 朝向标记（鼻子），模型默认面向 +z（顾客方向）
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.08), skinMat);
    nose.position.set(0, 1.70, 0.23);
    group.add(nose);

    // 脚下金色光圈，提示可交互
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.72, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf5d0a9,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);

    // 头顶名牌
    const tag = makeNameTag(`${npcData.role || '店员'} · ${npcData.name}`);
    tag.position.y = 2.28;
    group.add(tag);

    return group;
  }
}

/** 生成头顶名牌 Sprite */
function makeNameTag(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  roundRect(ctx, 8, 18, canvas.width - 16, canvas.height - 36, 32);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 208, 169, 0.8)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#f5d0a9';
  ctx.font = 'bold 52px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  sprite.scale.set(1.8, 0.45, 1);
  return sprite;
}

/** 生成文字招牌纹理 */
function makeSignTexture(title, subtitle, compact = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = compact ? 128 : 256;
  const ctx = canvas.getContext('2d');

  if (compact) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.92)';
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 24);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, canvas.width / 2, canvas.height / 2);
  } else {
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5d0a9';
    ctx.font = 'bold 68px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, canvas.width / 2, 110);
    if (subtitle) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '28px sans-serif';
      ctx.fillText(subtitle, canvas.width / 2, 185);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
