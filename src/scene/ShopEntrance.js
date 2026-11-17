import * as THREE from 'three';
import { STREET, BUILDINGS } from '../data/layout.js';

/** 圆环外半径（也是触发半径，单位：米） */
export const ENTRANCE_RADIUS = 1.5;
const RING_WIDTH = 0.14;
/** 圆环抬离地面的高度：石板路顶面约 0.06m，抬高后不会被埋 */
const RING_LIFT = 0.1;

/**
 * 数据版门口计算：直接用 layout.js 的建筑数据推出门口落点，不依赖 3D mesh。
 * 与 computeShopEntrances 同公式（建筑渐进加载时也能立刻得到全部触发点）。
 *
 * @returns {Array<{shopId:string, x:number, z:number, y:number, radius:number}>}
 */
export function computeEntrancesFromLayout(groundY = 0) {
  return BUILDINGS
    .filter((b) => b.shopId)
    .map((b) => {
      const sideSign = b.side === 'north' ? 1 : -1;
      const setback = b.setback || 0;
      const centerX = sideSign * (STREET.halfWidth + setback + b.d / 2);
      const towardsStreet = centerX < 0 ? 1 : -1;
      const facadeX = towardsStreet > 0 ? centerX + b.d / 2 : centerX - b.d / 2;
      return {
        shopId: b.shopId,
        x: facadeX + towardsStreet * 1.4,
        z: b.z,
        y: groundY,
        radius: ENTRANCE_RADIUS,
      };
    });
}

/**
 * 根据店铺建筑的计算包围盒，推断"门口"位置：
 * - 建筑中心在街道左侧(x<0) → 门口朝向 +x（街道方向）
 * - 建筑中心在街道右侧(x>0) → 门口朝向 -x
 * 这样对程序化建筑和 GLB 建筑都适用，不依赖硬编码坐标。
 *
 * @returns {Array<{shopId:string, x:number, z:number, y:number, radius:number}>}
 */
export function computeShopEntrances(shopMeshes, groundY = 0) {
  const box = new THREE.Box3();

  return shopMeshes
    .filter((m) => m.userData?.shopId && !m.userData.isShopMarker)
    .map((mesh) => {
      box.setFromObject(mesh);
      const centerX = (box.min.x + box.max.x) / 2;
      const centerZ = (box.min.z + box.max.z) / 2;

      const towardsStreet = centerX < 0 ? 1 : -1;
      const facadeX = towardsStreet > 0 ? box.max.x : box.min.x;

      return {
        shopId: mesh.userData.shopId,
        x: facadeX + towardsStreet * 1.4,
        z: centerZ,
        y: groundY,
        radius: ENTRANCE_RADIUS
      };
    });
}

/**
 * 地面发光触发圈
 * 玩家走进圈内并停下时自动弹出店铺窗口，进入时高亮为绿色
 */
export class TriggerRing {
  constructor(scene, entrance) {
    this.shopId = entrance.shopId;
    this._baseColor = new THREE.Color(0xf5d0a9);
    this._activeColor = new THREE.Color(0x34d399);

    const group = new THREE.Group();
    group.position.set(entrance.x, entrance.y + RING_LIFT, entrance.z);

    // 外圈亮环
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(entrance.radius - RING_WIDTH, entrance.radius, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffc98a,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 3;
    group.add(this.ring);

    // 内圈淡光，标示整个触发区域
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(entrance.radius - RING_WIDTH, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffc98a,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = -0.01;
    this.disc.renderOrder = 2;
    group.add(this.disc);

    this.mesh = group;
    this.mesh.renderOrder = 2;
    scene.add(group);
  }

  /** 玩家是否在圈内，用于高亮 */
  setActive(active) {
    this._active = active;
  }

  update(time) {
    const pulse = (Math.sin(time * 2.4) + 1) / 2;

    this.ring.material.opacity = Math.min(
      1,
      (this._active ? 0.9 : 0.68) + pulse * 0.2
    );
    this.disc.material.opacity = (this._active ? 0.24 : 0.12) + pulse * 0.06;

    const color = this._active ? this._activeColor : this._baseColor;
    this.ring.material.color.copy(color);
    this.disc.material.color.copy(color);

    const scale = 1 + pulse * 0.02;
    this.ring.scale.setScalar(scale);
  }
}
