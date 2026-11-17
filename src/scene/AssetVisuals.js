import * as THREE from 'three';
import { acquireCanvas, releaseCanvas } from '../utils/canvasPool.js';

const COOLDOWN_TOTAL_MS = 5 * 60 * 1000; // 5 分钟保护期
const AURA_SEGMENTS = 48;

/**
 * 资产归属的 3D 表现 + 保护期光环：
 * - 被玩家持有后建筑整体拔高（按装修等级）
 * - 建筑上方悬挂霓虹归属灯牌，显示店主昵称
 * - 保护期（cooldownMs > 0）：建筑周围罩一个冰蓝穹顶 + 地面光圈 + 倒计时 Sprite
 */
export class AssetVisuals {
  constructor(scene, shopMeshes, groundY = 0) {
    this.scene = scene;
    this.groundY = groundY;
    this.meshes = new Map();
    this.bounds = new Map();
    this.markers = new Map();
    this.signs = new Map();
    this.auras = new Map(); // shopId -> { group, expireAt, ringMat, domeMat, countdownSprite, lastCountdownSec }
    this.time = 0;
    this.shopMeshesRef = shopMeshes; // 渐进加载：建筑会陆续填充进同一数组，apply 时懒注册

    shopMeshes.forEach((mesh) => this._registerShopMesh(mesh));
  }

  /** 注册一栋建筑：拔高/店招/光环都挂在它身上 */
  _registerShopMesh(mesh) {
    const id = mesh.userData?.shopId;
    if (!id) return;
    // 店铺图标是 sprite，不能当建筑缩放
    if (mesh.userData?.isShopMarker || mesh.isSprite) {
      if (!this.markers.has(id)) this.markers.set(id, mesh);
      return;
    }
    if (this.meshes.has(id)) return;
    this.meshes.set(id, mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    this.bounds.set(id, { min: box.min.y, max: box.max.y });
  }

  /** 每次游戏状态更新时调用 */
  apply(assets, myId) {
    // 渐进加载：补注册陆续建成的建筑（同一数组引用，遍历增量部分）
    for (const mesh of this.shopMeshesRef) {
      const sid = mesh.userData?.shopId;
      if (sid && !this.meshes.has(sid) && !(mesh.userData?.isShopMarker || mesh.isSprite)) {
        this._registerShopMesh(mesh);
      }
    }

    const activeAuraIds = new Set();

    assets.forEach((asset) => {
      const mesh = this.meshes.get(asset.id);
      if (!mesh) return;

      const level = asset.level || 1;
      // 收购即拔高 15%，每升一级再高 10%，最高 1.5 倍
      const scaleY = asset.ownerId ? Math.min(1.5, 1.15 + 0.1 * (level - 1)) : 1;
      mesh.scale.y = scaleY;

      const box = this.bounds.get(asset.id) || { min: 0, max: 6 };
      const top = box.min + (box.max - box.min) * scaleY;
      const marker = this.markers.get(asset.id);
      if (marker) marker.position.y = top + 1.6;

      if (!asset.ownerId) {
        this._removeSign(asset.id);
      } else {
        const key = `${asset.ownerId}:${asset.ownerNick}`;
        const isMine = asset.ownerId === myId;
        const y = top + 5.2;

        const existing = this.signs.get(asset.id);
        if (existing && existing.userData.key === key && existing.userData.mine === isMine) {
          existing.position.y = y;
        } else {
          this._removeSign(asset.id);
          this._addSign(asset.id, asset.ownerNick, isMine, y, key);
        }
      }

      // === 保护期光环 ===
      const cooldownMs = Math.max(0, asset.cooldownMs || 0);
      if (cooldownMs > 0) {
        activeAuraIds.add(asset.id);
        this._ensureAura(asset.id, cooldownMs, mesh);
      } else {
        this._removeAura(asset.id);
      }
    });

    // 清理已过期的 aura（服务端状态已更新但本地 aura 还挂着的情况）
    for (const id of this.auras.keys()) {
      if (!activeAuraIds.has(id)) this._removeAura(id);
    }
  }

  /** 主循环每帧调用：呼吸动画 + 倒计时更新 + 过期清理 */
  update(dt) {
    this.time += dt;
    for (const [shopId, aura] of this.auras) {
      const remain = Math.max(0, aura.expireAt - Date.now());
      if (remain <= 0) {
        this._removeAura(shopId);
        continue;
      }

      // 呼吸：ring + dome opacity 正弦脉冲
      const pulse = (Math.sin(this.time * 3.5 + shopId.charCodeAt(0)) + 1) / 2; // 0~1
      const ringAlpha = 0.35 + pulse * 0.45;
      const domeAlpha = 0.12 + pulse * 0.1;
      if (aura.ringMat) aura.ringMat.opacity = ringAlpha;
      if (aura.domeMat) aura.domeMat.opacity = domeAlpha;

      // 穹顶自旋转（慢）
      if (aura.dome) aura.dome.rotation.y += dt * 0.2;

      // 每秒刷新倒计时文字 Sprite（复用 canvas，仅重绘）
      const secs = Math.ceil(remain / 1000);
      if (secs !== aura.lastCountdownSec) {
        aura.lastCountdownSec = secs;
        this._updateCountdownSprite(aura, remain);
      }
    }
  }

  _ensureAura(shopId, cooldownMs, mesh) {
    let aura = this.auras.get(shopId);
    if (!aura) {
      aura = this._buildAura(shopId, mesh);
      aura.expireAt = Date.now() + cooldownMs;
      this.auras.set(shopId, aura);
    }
    // 重新对齐位置（建筑可能移动/缩放）
    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);
    aura.group.position.x = world.x;
    aura.group.position.z = world.z;
  }

  _buildAura(shopId, mesh) {
    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);
    const box = this.bounds.get(shopId) || { min: 0, max: 6 };
    const halfH = (box.max - box.min) / 2;
    const topH = halfH + 2.2;

    const group = new THREE.Group();
    group.name = `protection-aura-${shopId}`;

    // 地面光圈（在建筑脚下发光，罩住整个街区地块）
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x60a5fa, transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ringRadius = 9;
    const ringGeo = new THREE.RingGeometry(ringRadius * 0.85, ringRadius, AURA_SEGMENTS);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = this.groundY + 0.08;
    group.add(ring);

    // 辅助发光底（更宽更淡）
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glowGeo = new THREE.CircleGeometry(ringRadius * 1.15, AURA_SEGMENTS);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = this.groundY + 0.04;
    group.add(glow);

    // 半透明穹顶（圆柱，无顶无底，罩住建筑）
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, roughness: 0.5, metalness: 0.0,
      depthWrite: false,
    });
    const domeRadius = ringRadius * 0.95;
    const domeHeight = topH - this.groundY + 3.5;
    const domeGeo = new THREE.CylinderGeometry(domeRadius, domeRadius * 0.92, domeHeight, AURA_SEGMENTS, 1, true);
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = this.groundY + domeHeight / 2;
    group.add(dome);

    // 穹顶上沿发光圈
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const rimGeo = new THREE.TorusGeometry(domeRadius, 0.12, 8, AURA_SEGMENTS);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = this.groundY + domeHeight;
    group.add(rim);

    // 穹顶顶部（淡盖）
    const topMat = new THREE.MeshStandardMaterial({
      color: 0x60a5fa, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const topGeo = new THREE.CircleGeometry(domeRadius * 0.92, AURA_SEGMENTS);
    const topCap = new THREE.Mesh(topGeo, topMat);
    topCap.rotation.x = -Math.PI / 2;
    topCap.position.y = this.groundY + domeHeight;
    group.add(topCap);

    // 倒计时 Sprite（冰蓝胶囊）——canvas/texture 建一次，之后每秒原地重绘
    const canvas = acquireCanvas(512, 128);
    const ctx = canvas.getContext('2d');
    const countdownTexture = new THREE.CanvasTexture(canvas);
    countdownTexture.colorSpace = THREE.SRGBColorSpace;
    const countdownSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: countdownTexture, transparent: true, depthTest: false,
    }));
    countdownSprite.scale.set(4.2, 1.3, 1);
    countdownSprite.position.y = this.groundY + domeHeight + 2.2;
    countdownSprite.renderOrder = 30;
    group.add(countdownSprite);

    group.position.set(world.x, 0, world.z);
    this.scene.add(group);

    return {
      group, ringMat, domeMat, glowMat, topMat, rimMat, dome,
      countdownSprite, countdownCanvas: canvas, countdownCtx: ctx, countdownTexture,
      lastCountdownSec: -1, expireAt: 0,
    };
  }

  /** 原地重绘倒计时内容（复用 canvas，不新建 texture，避免每秒 GC） */
  _updateCountdownSprite(aura, remainMs) {
    const totalSec = Math.ceil(remainMs / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    const text = `🛡 保护中 ${mm}:${String(ss).padStart(2, '0')}`;

    const canvas = aura.countdownCanvas;
    const ctx = aura.countdownCtx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 深色胶囊底 + 冰蓝边
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.beginPath();
    ctx.roundRect(10, 14, 492, 100, 30);
    ctx.fill();
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 4;
    ctx.stroke();

    // 进度弧（表示 5min 还剩多少）
    const elapsed = 1 - Math.max(0, Math.min(1, remainMs / COOLDOWN_TOTAL_MS));
    const progressDeg = elapsed * 360;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(42, 64, 16, -Math.PI / 2, -Math.PI / 2 + (progressDeg * Math.PI) / 180);
    ctx.stroke();

    // 文字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#bae6fd';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 14;
    ctx.fillText(text, 280, 66);

    aura.countdownTexture.needsUpdate = true;
  }

  _removeAura(shopId) {
    const aura = this.auras.get(shopId);
    if (!aura) return;
    if (aura.countdownCanvas) releaseCanvas(aura.countdownCanvas);
    // 释放所有几何体/材质
    aura.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
        else { child.material.map?.dispose?.(); child.material.dispose?.(); }
      }
    });
    this.scene.remove(aura.group);
    this.auras.delete(shopId);
  }

  _addSign(shopId, nickname, isMine, y, key) {
    const texture = this._makeSignTexture(nickname, isMine);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(10, 2.5, 1);
    sprite.position.y = y;
    sprite.userData = { key, mine: isMine };

    const mesh = this.meshes.get(shopId);
    if (mesh) {
      // 灯牌跟随建筑水平位置，避免建筑旋转时错位
      const world = new THREE.Vector3();
      mesh.getWorldPosition(world);
      sprite.position.x = world.x;
      sprite.position.z = world.z;
    }
    this.scene.add(sprite);
    this.signs.set(shopId, sprite);
  }

  _removeSign(shopId) {
    const sign = this.signs.get(shopId);
    if (!sign) return;
    this.scene.remove(sign);
    sign.material.map?.dispose();
    sign.material.dispose();
    this.signs.delete(shopId);
  }

  _makeSignTexture(nickname, isMine) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = isMine ? 'rgba(20, 14, 2, 0.9)' : 'rgba(40, 6, 6, 0.92)';
    ctx.strokeStyle = isMine ? '#f5d0a9' : '#ef4444';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(8, 18, 496, 92, 22);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 46px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isMine ? '#fde68a' : '#fca5a5';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 18;

    const text = `♛ ${nickname}`;
    const trimmed = text.length > 12 ? `${text.slice(0, 12)}…` : text;
    ctx.fillText(trimmed, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }
}
