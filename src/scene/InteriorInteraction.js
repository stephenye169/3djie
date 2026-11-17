import * as THREE from 'three';

/**
 * 店内点击交互
 * - 点击柜台 / 货架 / 商品 → 打开店铺商品卡片（onShop）
 * - 点击店员 → 打开对话面板（onNpc）
 * 只在店内模式下启用；街道模式由 ShopInteraction 负责，两者互斥。
 */
export class InteriorInteraction {
  constructor(camera, dom, { onShop, onNpc } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.onShop = onShop;
    this.onNpc = onNpc;

    this.enabled = false;
    this.targets = [];
    this.raycaster = new THREE.Raycaster();
    // 室内物件在 layer 1，射线需要同时检测两层
    this.raycaster.layers.enableAll();
    this.raycaster.camera = camera; // 店员等交互物若为 Sprite：Sprite.raycast 需要 raycaster.camera
    this.pointer = new THREE.Vector2();

    this.dom.addEventListener('mousemove', (e) => this._onMove(e));
    this.dom.addEventListener('click', (e) => this._onClick(e));
  }

  setTargets(targets) {
    this.targets = targets || [];
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.dom.style.cursor = 'default';
  }

  _getPointer(e) {
    // 鼠标锁定时准星在屏幕中心，用中心射线拾取（瞄准即点击）
    if (document.pointerLockElement === this.dom) {
      this.pointer.set(0, 0);
      return;
    }
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pick(e) {
    this._getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.targets, false);
    return hits.length > 0 ? hits[0].object : null;
  }

  _onMove(e) {
    if (!this.enabled) return;
    this.dom.style.cursor = this._pick(e) ? 'pointer' : 'default';
  }

  _onClick(e) {
    if (!this.enabled) return;
    const obj = this._pick(e);
    if (!obj) return;

    const { kind, shopId } = obj.userData || {};
    if (kind === 'npc' && shopId) {
      this.onNpc?.(shopId);
    } else if (kind === 'shop' && shopId) {
      this.onShop?.(shopId);
    }
  }
}
