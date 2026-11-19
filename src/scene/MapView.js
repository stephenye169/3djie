import * as THREE from 'three';
import { getShopById } from '../data/shops.js';
import { STREET } from '../data/layout.js';

/** 进入/退出的飞行动画时长（秒） */
const ENTER_TIME = 0.9;
const FLY_TIME = 1.1;
/** 地图模式下雾效与视距：总览要看清整条巷子 */
const MAP_FOG = 0.0016;
const MAP_FAR = 1200;

/**
 * 地图模式（仿百度地图 3D 总览）
 * - M 键进入：相机从第三人称升起为斜俯视，雾效减弱
 * - 左键拖拽平移，滚轮缩放
 * - 屋顶显示店名标签；点击店名/建筑 → 飞过去并落回该店门口
 * - M / Esc 返回玩家身后
 */
export class MapView {
  constructor(camera, scene, dom) {
    this.camera = camera;
    this.scene = scene;
    this.dom = dom;

    this.active = false;
    /** 当前飞行动画 {t,dur,fromPos,fromLook,toPos,toLook,done} */
    this.anim = null;
    /** 点击店铺回调（由 main.js 赋值） */
    this.onPick = null;

    // 俯瞰中心（地面点）与相机高度
    this.center = new THREE.Vector3();
    this.height = 90;
    this.minHeight = 35;
    this.maxHeight = 170;

    this._points = []; // { shop, labelPos, landX, landZ, label, root }
    this._raycaster = new THREE.Raycaster();
    this._raycaster.camera = camera; // 地图标签与店铺图标均为 Sprite：Sprite.raycast 需要 raycaster.camera
    this._pointer = new THREE.Vector2();
    this._look = new THREE.Vector3();
    this._dragging = false;
    this._moved = 0;
    this._lastX = 0;
    this._lastY = 0;

    // 导航增强：「我在哪」玩家标记 + 点击店铺后的导航虚线
    this.playerMarker = null;
    this.routeLine = null;
    this.time = 0;

    this._bind();
  }

  /** 「我在哪」标记：金色脉冲圆点标出玩家实时位置（地图模式可见） */
  setPlayerMarker(pos) {
    if (!this.playerMarker) {
      const group = new THREE.Group();
      group.name = 'map-player-marker';
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.3, 32),
        new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      group.add(ring);
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.35, 20),
        new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
      );
      dot.rotation.x = -Math.PI / 2;
      group.add(dot);
      group.position.y = 0.15;
      group.visible = false;
      this.scene.add(group);
      this.playerMarker = group;
    }
    this.playerMarker.position.x = pos.x;
    this.playerMarker.position.z = pos.z;
  }

  /** 导航虚线：玩家当前位置 → 目标店铺门口（L 形沿街路径），金色虚线 */
  showRoute(fromX, fromZ, toX, toZ) {
    // L 形路径：先沿街走到目标 z，再横移进门口 x
    const points = [
      new THREE.Vector3(fromX, 0.12, fromZ),
      new THREE.Vector3(fromX, 0.12, toZ),
      new THREE.Vector3(toX, 0.12, toZ),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    if (this.routeLine) {
      this.scene.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      this.routeLine.material.dispose();
    }
    this.routeLine = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: 0xffd24a, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.85,
    }));
    this.routeLine.computeLineDistances();
    this.routeLine.visible = true;
    this.scene.add(this.routeLine);
  }

  /**
   * @param shopMeshes 店铺建筑组（userData.shopId）
   * @param entrances  computeShopEntrances 的结果（店门口落点）
   */
  setData(shopMeshes, entrances) {
    const box = new THREE.Box3();
    for (const root of shopMeshes) {
      // shopMeshes 里混有店铺图标 sprite（isShopMarker），跳过，避免重复建标签
      if (root.userData?.isShopMarker) continue;
      const shopId = root.userData?.shopId;
      const shop = shopId && getShopById(shopId);
      const entrance = entrances.find((e) => e.shopId === shopId);
      if (!shop || !entrance) continue;

      box.setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());

      const label = this._makeLabel(`${shop.emoji} ${shop.name}`);
      label.position.set(center.x, box.max.y + 2.2, center.z);
      label.visible = false;
      label.userData.mapPointIndex = this._points.length;
      this.scene.add(label);

      this._points.push({
        shop,
        label,
        root,
        landX: entrance.x,
        landZ: entrance.z
      });
    }
  }

  /** 进入地图模式，focusPos 为初始俯瞰中心（一般是玩家位置） */
  enter(focusPos) {
    if (this.active) return;
    this.active = true;

    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this.dom.style.cursor = 'grab';

    // 总览要看清远处：减弱雾、拉远视锥
    this._savedFog = this.scene.fog?.density;
    this._savedFar = this.camera.far;
    if (this.scene.fog) this.scene.fog.density = MAP_FOG;
    this.camera.far = MAP_FAR;
    this.camera.updateProjectionMatrix();

    this.center.copy(focusPos);
    this.center.y = 0;
    this._clampCenter();

    for (const p of this._points) p.label.visible = true;

    // 从当前相机位姿飞到俯瞰位姿
    const fromLook = this.camera.getWorldDirection(new THREE.Vector3())
      .multiplyScalar(10)
      .add(this.camera.position);
    this._startAnim(ENTER_TIME, this._destPos(), this.center.clone(), null, null, fromLook);
  }

  /** 退出地图模式：飞回 targetPose（第三人称相机当前应有的位姿） */
  exitTo(targetPose, done) {
    if (!this.active) return;
    this._startAnim(FLY_TIME, targetPose.pos, targetPose.look, () => {
      this._teardown();
      done?.();
    });
  }

  /** 点击店铺：飞到该店门口上空后落地 */
  flyTo(point, done) {
    if (!this.active) return;
    const look = new THREE.Vector3(point.landX, 1.6, point.landZ);
    const pos = new THREE.Vector3(point.landX, 3.4, point.landZ + 6.0);
    this._startAnim(FLY_TIME, pos, look, () => {
      this._teardown();
      done?.(point);
    });
  }

  _teardown() {
    this.active = false;
    this.dom.style.cursor = '';
    for (const p of this._points) p.label.visible = false;
    if (this.playerMarker) this.playerMarker.visible = false; // 「我在哪」标记仅地图模式可见
    if (this.routeLine) this.routeLine.visible = false; // 导航虚线仅地图模式可见
    if (this.scene.fog && this._savedFog != null) this.scene.fog.density = this._savedFog;
    if (this._savedFar != null) {
      this.camera.far = this._savedFar;
      this.camera.updateProjectionMatrix();
    }
  }

  /** 俯瞰相机目标位姿：注视中心上方，向南偏移形成斜俯视 */
  _destPos() {
    return new THREE.Vector3(this.center.x, this.height, this.center.z + this.height * 0.55);
  }

  /** 俯瞰中心夹取在街道可行走包络内（拖拽平移不跑出地图） */
  _clampCenter() {
    const b = STREET.bounds;
    this.center.x = Math.max(b.minX, Math.min(b.maxX, this.center.x));
    this.center.z = Math.max(b.minZ, Math.min(b.maxZ, this.center.z));
  }

  /** 启动相机补间（进入/退出/飞店共用）；fromPos/fromLook 缺省取当前相机位姿 */
  _startAnim(dur, toPos, toLook, done, fromPos, fromLook) {
    this.anim = {
      t: 0,
      dur,
      fromPos: (fromPos || this.camera.position).clone(),
      fromLook: (fromLook || this._look).clone(),
      toPos: toPos.clone(),
      toLook: toLook.clone(),
      done,
    };
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;

    // 「我在哪」标记脉冲
    if (this.playerMarker?.visible) {
      const pulse = (Math.sin(this.time * 4) + 1) / 2;
      const ring = this.playerMarker.children[0];
      if (ring) ring.scale.setScalar(1 + pulse * 0.25);
    }

    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = _ease(Math.min(a.t / a.dur, 1));
      this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
      this._look.lerpVectors(a.fromLook, a.toLook, k);
      this.camera.lookAt(this._look);
      if (a.t >= a.dur) {
        this.anim = null;
        a.done?.();
      }
      return;
    }

    // 无动画时：跟随俯瞰中心（拖拽/滚轮即时生效，带一点平滑）
    this.camera.position.lerp(this._destPos(), 0.25);
    this._look.lerp(this.center, 0.25);
    this.camera.lookAt(this._look);
  }

  /* ---------------- 输入 ---------------- */

  _bind() {
    this.dom.addEventListener('mousedown', (e) => {
      if (!this.active || this.anim || e.button !== 0) return;
      this._dragging = true;
      this._moved = 0;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.dom.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._moved += Math.abs(dx) + Math.abs(dy);
      // 抓住地面拖动：视野中心随鼠标反向移动
      const s = this.height * 0.0016;
      this.center.x -= dx * s;
      this.center.z -= dy * s;
      this._clampCenter();
    });

    window.addEventListener('mouseup', () => {
      if (!this._dragging) return;
      this._dragging = false;
      if (this.active) this.dom.style.cursor = 'grab';
    });

    this.dom.addEventListener('wheel', (e) => {
      if (!this.active || this.anim) return;
      e.preventDefault();
      this.height = Math.max(
        this.minHeight,
        Math.min(this.maxHeight, this.height * (1 + e.deltaY * 0.001))
      );
    }, { passive: false });

    this.dom.addEventListener('click', (e) => {
      if (!this.active || this.anim || this._moved > 6) return;
      const point = this._pick(e);
      if (point) this.onPick?.(point);
    });
  }

  /** 点击拾取：先屋顶标签，再建筑本体 */
  _pick(e) {
    const rect = this.dom.getBoundingClientRect();
    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);

    const labels = this._points.map((p) => p.label);
    const hitLabel = this._raycaster.intersectObjects(labels, false)[0];
    if (hitLabel) return this._points[hitLabel.object.userData.mapPointIndex];

    const roots = this._points.map((p) => p.root);
    const hit = this._raycaster.intersectObjects(roots, true)[0];
    if (!hit) return null;
    let obj = hit.object;
    while (obj) {
      const idx = this._points.findIndex((p) => p.root === obj);
      if (idx >= 0) return this._points[idx];
      obj = obj.parent;
    }
    return null;
  }

  /** 店名标签：深色底 + 白字，始终置顶显示（类似地图 POI） */
  _makeLabel(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = 'bold 34px "Microsoft YaHei", sans-serif';
    ctx.font = font;
    const textW = ctx.measureText(text).width;
    canvas.width = Math.ceil(textW + 48);
    canvas.height = 64;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = 'rgba(22, 28, 38, 0.88)';
    _roundRect(ctx, 2, 6, w - 4, h - 12, 14);
    ctx.fill();
    ctx.font = font;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    );
    sprite.renderOrder = 20;
    const hWorld = 3.2;
    sprite.scale.set((canvas.width / canvas.height) * hWorld, hWorld, 1);
    return sprite;
  }
}

function _ease(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
