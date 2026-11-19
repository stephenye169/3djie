import * as THREE from 'three';

/**
 * 第三人称摄像机控制器
 * - 鼠标移动控制围绕玩家的 yaw / pitch
 * - 摄像机始终跟随玩家身后
 * - Pointer Lock 用于锁定鼠标（点击画面进入，ESC 退出）
 */
export class ThirdPersonCamera {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.distance = 6.5;
    this.height = 1.6;
    this.minPitch = -0.4;
    this.maxPitch = 1.2;
    this.sensitivity = 0.0025;

    this.yaw = 0;
    this.pitch = 0.16;

    this.locked = false;
    this.enabled = true; // 地图模式下为 false：不抢指针锁
    this._targetPos = new THREE.Vector3();
    // 复用临时向量：update() 每帧调用，避免每帧 new Vector3 触发 GC
    this._offset = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();

    this._bindEvents();
  }

  _bindEvents() {
    this.dom.addEventListener('click', () => {
      if (!this.enabled) return;
      if (!this.locked) {
        const p = this.dom.requestPointerLock?.();
        // requestPointerLock 在非用户手势或受限环境下会 reject，忽略即可
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
    });
  }

  getYaw() {
    return this.yaw;
  }

  /** 计算相机应有的位置（同时刷新 lookAt 目标点） */
  _desired(target) {
    // 目标点 = 玩家位置 + 头部高度偏移
    this._targetPos.copy(target);
    this._targetPos.y += 1.5;

    // 球坐标围绕目标
    const sinPitch = Math.sin(this.pitch);
    const cosPitch = Math.cos(this.pitch);
    this._offset.set(
      Math.sin(this.yaw) * cosPitch * this.distance,
      sinPitch * this.distance + this.height,
      Math.cos(this.yaw) * cosPitch * this.distance
    );
    return this._desiredPos.copy(this._targetPos).add(this._offset);
  }

  update(target) {
    const desired = this._desired(target);
    // 平滑跟随
    this.camera.position.lerp(desired, 0.15);
    this.camera.lookAt(this._targetPos);
  }

  /** 立即对齐到目标（进出店铺传送时使用，避免相机横跨整张地图） */
  snap(target) {
    const desired = this._desired(target);
    this.camera.position.copy(desired);
    this.camera.lookAt(this._targetPos);
  }

  /** 当前参数下相机应有的位姿（供地图模式退出动画衔接） */
  pose(target) {
    // 调用频率很低（仅地图退出衔接），拷出独立向量避免与每帧复用的缓存别名
    const pos = this._desired(target);
    return { pos: pos.clone(), look: this._targetPos.clone() };
  }

  /**
   * 切换室内/街道镜头
   * 室内用更近更低的镜头并压低俯仰上限，避免相机越过墙顶看到"盒子外面"
   */
  setInteriorMode(enabled) {
    if (enabled) {
      this._streetView = {
        distance: this.distance,
        height: this.height,
        minPitch: this.minPitch,
        maxPitch: this.maxPitch,
        pitch: this.pitch,
        yaw: this.yaw
      };
      this.distance = 3.2;
      this.height = 0.3;
      this.minPitch = -0.3;
      this.maxPitch = 0.18;
      this.pitch = 0.05;
      this.yaw = 0;
    } else if (this._streetView) {
      Object.assign(this, this._streetView);
      this._streetView = null;
    }
  }
}
