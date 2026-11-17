import { getShopById } from '../data/shops.js';

/**
 * 靠近店铺交互系统
 * - 每帧检测玩家与各店铺"门口触发点"的水平距离
 * - 走进门口圆圈（半径 = 圆环视觉半径）并**停下脚步**时自动弹出店铺信息卡片
 *   （奔跑/路过不会打断移动——否则贴街边跑动会频繁被弹窗锁住）
 * - 触发圈内按 E 进入店铺（唯一的进店方式），移动中也可直接按 E
 * - 每次进入圆圈最多自动弹一次；离开范围后再次靠近可重新触发
 */
export class ProximityInteraction {
  /**
   * @param {Player} player
   * @param {Array<THREE.Object3D>} shopMeshes 含 shopId 的店铺 mesh 列表
   * @param {InteractHint} hint
   * @param {(shop:object)=>void} onInteract 打开店铺详情回调
   * @param {Array<{shopId:string,x:number,z:number,radius:number}>} [entrances] 门口触发点
   * @param {number} triggerDistance 无门口配置时的回退距离（米）
   * @param {(shop:object)=>void} [onEnter] 触发圈内按 E 进店
   */
  constructor(player, shopMeshes, hint, onInteract, entrances = null, triggerDistance = 5, onEnter = null) {
    this.player = player;
    this.hint = hint;
    this.onInteract = onInteract;
    this.onEnter = onEnter;
    this.triggerDistance = triggerDistance;

    // 优先使用门口触发点；否则回退到建筑中心 + 固定距离
    if (entrances && entrances.length > 0) {
      this.targets = entrances.map((e) => ({
        shopId: e.shopId,
        x: e.x,
        z: e.z,
        radius: e.radius
      }));
    } else {
      this.targets = shopMeshes
        .filter((m) => m.userData?.shopId && !m.userData.isShopMarker)
        .map((m) => ({
          shopId: m.userData.shopId,
          x: m.position.x,
          z: m.position.z,
          radius: triggerDistance
        }));
    }

    this.currentShop = null; // 当前最近的店铺 {shopId, shop, distance}
    this.wasInRange = false; // 上一帧是否在触发范围内
    this.openedHere = false; // 本次进入圆圈是否已经自动弹过卡片

    this._onKeyDown = (e) => {
      if (e.code !== 'KeyE' || !this.currentShop) return;
      // 正在输入框/聊天框里打字时不触发
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      e.preventDefault();
      if (this.onEnter) this.onEnter(this.currentShop.shop);
      else this.onInteract(this.currentShop.shop);
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** @param {boolean} [isMoving] 玩家当前是否有移动输入 */
  update(isMoving = false) {
    if (!this.player) return;
    const px = this.player.position.x;
    const pz = this.player.position.z;

    let nearest = null;
    let nearestDist = Infinity;

    // 找出距离最近的门口圆圈（按实际进入圆内判断）
    for (const t of this.targets) {
      const dx = t.x - px;
      const dz = t.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= t.radius && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    if (nearest) {
      const shop = getShopById(nearest.shopId);
      if (shop) {
        this.currentShop = { shopId: nearest.shopId, shop, distance: nearestDist };
        this.hint.show(shop.name, nearestDist);

        if (!this.wasInRange) {
          this.wasInRange = true;
          this.openedHere = false;
        }
        // 只有停下脚步才自动弹卡片，避免跑动路过被突然锁住
        if (!this.openedHere && !isMoving) {
          this.openedHere = true;
          this.onInteract(shop);
        }
        return;
      }
    }

    // 不在任何圆圈内
    this.currentShop = null;
    this.hint.hide();
    this.wasInRange = false;
    this.openedHere = false;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
