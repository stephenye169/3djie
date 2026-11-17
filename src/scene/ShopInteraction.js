import * as THREE from 'three';
import { AssetCard } from '../ui/AssetCard.js';

/**
 * 店铺点击交互
 * - 鼠标点击时发射射线，命中店铺 mesh 则显示信息卡片
 * - 卡片显示期间禁用移动与视角
 * - 进店只能走到门口触发圈后按 E（见 ProximityInteraction）
 */
export class ShopInteraction {
  constructor(camera, dom, shopMeshes, onCardOpen, onCardClose) {
    this.camera = camera;
    this.dom = dom;
    this.shopMeshes = shopMeshes;
    this.onCardOpen = onCardOpen;
    this.onCardClose = onCardClose;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = camera; // shopMeshes 含店铺图标 Sprite：Sprite.raycast 需要 raycaster.camera
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.cardOpen = false;
    this.enabled = true; // 进入店铺内部时禁用街道点击

    this.infoCard = new AssetCard(() => this.close());

    this._bindEvents();
  }

  setShopMeshes(meshes) {
    this.shopMeshes = meshes;
  }

  _bindEvents() {
    this.dom.addEventListener('click', (e) => this._onClick(e));
    this.dom.addEventListener('mousemove', (e) => this._onMove(e));
    document.addEventListener('keydown', (e) => {
      if (!this.cardOpen) return;
      // 焦点在收购/升级按钮上时，回车用于交易，不关闭卡片
      if (e.target && e.target.closest && e.target.closest('.asset-action')) return;
      // Esc 由 main.js 统一处理（避免店内既关卡片又退出店铺）
      if (e.key === 'Enter') {
        e.preventDefault();
        this.close();
      }
    });
  }

  _getPointer(e) {
    // 鼠标锁定时准星固定在屏幕中心，点击应使用屏幕中心射线（否则用的是锁定前的旧坐标）
    if (document.pointerLockElement === this.dom) {
      this.pointer.set(0, 0);
      return;
    }
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onMove(e) {
    if (this.cardOpen || !this.enabled) return;
    const hit = this._pickShop(e);
    this.hovered = hit ? hit.object : null;
    this.dom.style.cursor = this.hovered ? 'pointer' : 'default';
  }

  /**
   * 拾取店铺
   * 第三人称相机始终略微俯视角色，准星常常落在角色身后的地面上，
   * 所以屏幕射线未命中时，再沿摄像机水平朝向前方射一次，
   * 保证「站在店铺前、看向店铺点击」就能命中，不需要精确瞄准。
   */
  _pickShop(e) {
    this._getPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // 递归拾取：一栋建筑由台基/墙身/屋顶/门窗等多个构件组成
    const direct = this.raycaster.intersectObjects(this.shopMeshes, true);
    if (direct.length > 0) return direct[0];

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return null;
    dir.normalize();

    this.raycaster.set(this.camera.position, dir);
    const forward = this.raycaster.intersectObjects(this.shopMeshes, true);
    return forward[0] || null;
  }

  _onClick(e) {
    if (!this.enabled) return;
    const hit = this._pickShop(e);
    if (!hit) return;

    const shopId = resolveShopId(hit.object);
    if (!shopId) return;

    // 点击店铺图标或建筑：未收购弹出挑衅+收购，已收购弹出装修/收益面板
    if (!this.cardOpen) this.open(shopId);
  }

  /** @param {string|{id:string}} shopOrId */
  open(shopOrId) {
    const id = typeof shopOrId === 'string' ? shopOrId : shopOrId?.id;
    if (!id) return;
    this.cardOpen = true;
    this.infoCard.show(id);
    this.onCardOpen?.(shopOrId);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  close() {
    this.cardOpen = false;
    this.infoCard.hide();
    this.onCardClose?.();
  }

  isOpen() {
    return this.cardOpen;
  }
}

/** 命中建筑任意构件后，沿父级向上查找所属店铺的 shopId */
function resolveShopId(object) {
  let obj = object;
  while (obj) {
    if (obj.userData && obj.userData.shopId) return obj.userData.shopId;
    obj = obj.parent;
  }
  return null;
}
