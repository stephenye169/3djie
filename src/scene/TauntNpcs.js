import * as THREE from 'three';
import { TAUNT_NPCS } from '../../shared/tauntNpcs.js';
import { formatMoney } from '../../shared/assets.js';

/**
 * 隐藏在青果巷角落的「碰瓷 NPC」
 *
 * 走到身边会直接触发打脸对话（由 onTrigger 回调打开 UI）。
 * 每人每个 NPC 独立冷却，奖励由服务端发放。
 */

const TRIGGER_RADIUS = 2.4;
const RESET_RADIUS = 4.0;

function makeNameSprite(cfg) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 160;

  ctx.fillStyle = 'rgba(24, 14, 6, 0.82)';
  ctx.beginPath();
  ctx.roundRect(8, 10, canvas.width - 16, canvas.height - 20, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 208, 120, 0.75)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe6a3';
  ctx.font = 'bold 46px "Microsoft YaHei", sans-serif';
  ctx.fillText(`😤 ${cfg.name}`, canvas.width / 2, 58);

  ctx.fillStyle = '#ffd24a';
  ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
  ctx.fillText(`点我打脸 · 爆 ¥${formatMoney(cfg.reward)}`, canvas.width / 2, 112);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false,
  }));
  sprite.renderOrder = 20;
  sprite.scale.set(3.6, 1.12, 1);
  sprite.position.y = 2.55;
  return sprite;
}

function buildNpc(cfg) {
  const group = new THREE.Group();
  group.name = `taunt-npc-${cfg.id}`;

  const suit = new THREE.MeshStandardMaterial({
    color: 0xd4a017, roughness: 0.55, metalness: 0.35,
    emissive: 0x3a2600, emissiveIntensity: 0.4,
  });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.4 });
  const gold = new THREE.MeshBasicMaterial({ color: 0xffe08a });

  // 腿
  for (const x of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.55, 6, 12), pants);
    leg.position.set(x, 0.42, 0);
    leg.castShadow = true;
    group.add(leg);
  }

  // 西装外套 + 白衬衫 + 金链子
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.34, 8, 20), suit);
  torso.position.y = 1.08;
  torso.scale.z = 0.78;
  torso.castShadow = true;
  group.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.05), shirt);
  chest.position.set(0, 1.08, 0.19);
  group.add(chest);

  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 20, Math.PI), gold);
  chain.rotation.z = Math.PI;
  chain.position.set(0, 1.2, 0.2);
  group.add(chain);

  // 手臂抱胸（嚣张站姿）
  for (const x of [-0.3, 0.3]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 6, 12), suit);
    arm.position.set(x, 1.1, 0.06);
    arm.rotation.z = x > 0 ? -0.5 : 0.5;
    arm.rotation.x = -0.6;
    arm.castShadow = true;
    group.add(arm);
  }

  // 头 + 墨镜 + 油头
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), skin);
  head.position.y = 1.63;
  head.castShadow = true;
  group.add(head);

  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.12), dark);
  glasses.position.set(0, 1.65, 0.16);
  group.add(glasses);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.197, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
    dark
  );
  hair.position.y = 1.655;
  group.add(hair);

  // 脚下金圈 + 头顶感叹号光晕
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffd24a, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 220, 120, 0.55)');
  grad.addColorStop(1, 'rgba(255, 200, 60, 0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.scale.set(3.2, 3.2, 1);
  glow.position.y = 1.1;
  glow.renderOrder = 4;
  group.add(glow);

  group.add(makeNameSprite(cfg));
  return { group, ring };
}

export class TauntNpcs {
  /**
   * @param {THREE.Scene} scene
   * @param {number} groundY
   * @param {{onTrigger:(cfg:object)=>void}} handlers
   */
  constructor(scene, groundY, handlers = {}) {
    this.onTrigger = handlers.onTrigger || (() => {});
    this.time = 0;
    this.npcs = TAUNT_NPCS.map((cfg) => {
      const { group, ring } = buildNpc(cfg);
      group.position.set(cfg.x, groundY, cfg.z);
      scene.add(group);
      return {
        cfg, group, ring, inside: false, hidden: false,
        // 巡逻状态：以出生点为中心沿街闲逛（±12m），到点停 2–4.5 秒再选新目标
        homeZ: cfg.z,
        targetX: cfg.x,
        targetZ: cfg.z,
        waitUntil: 0,
        speed: 1.2, // 巡逻速度 m/s（玩家 6m/s，NPC 慢悠悠晃）
      };
    });
    for (const npc of this.npcs) this._pickTarget(npc);
  }

  /** 选下一个闲逛目标：出生点 ±12m 沿街漂移，x 只在小范围抖动 */
  _pickTarget(npc) {
    const WANDER_Z = 12;
    npc.targetX = npc.cfg.x + (Math.random() - 0.5) * 2;
    npc.targetZ = npc.homeZ + (Math.random() - 0.5) * 2 * WANDER_Z;
  }

  /** 触发后让该 NPC 从场景里消失（本次会话内不再出现） */
  hide(id) {
    const npc = this.npcs.find((n) => n.cfg.id === id);
    if (!npc || npc.hidden) return;
    npc.hidden = true;
    npc.group.parent?.remove(npc.group);
    npc.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        obj.material?.dispose?.();
      } else if (obj.isSprite) {
        obj.material?.map?.dispose();
        obj.material?.dispose?.();
      }
    });
  }

  update(dt, playerPos, interactive) {
    this.time += dt;

    for (const npc of this.npcs) {
      if (npc.hidden) continue;

      const dx = npc.group.position.x - playerPos.x;
      const dz = npc.group.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);

      const pulse = (Math.sin(this.time * 3 + npc.cfg.z) + 1) / 2;
      npc.ring.material.opacity = 0.45 + pulse * 0.45;
      npc.ring.scale.setScalar(1 + pulse * 0.06);

      if (dist > RESET_RADIUS) npc.inside = false;

      if (interactive && dist <= TRIGGER_RADIUS && !npc.inside) {
        npc.inside = true;
        this.onTrigger(npc.cfg);
      }
    }

    this._updateWander(dt, playerPos, interactive);
  }

  /** 巡逻状态机：到点停留 2–4.5 秒 → 选新目标 → 慢速走过去；对话面板打开时站定等玩家 */
  _updateWander(dt, playerPos, interactive) {
    for (const npc of this.npcs) {
      if (npc.hidden) continue;

      // 与玩家触发对话期间（interactive=false）站定不走，等面板关闭
      if (!interactive) continue;

      if (npc.waitUntil > this.time) continue; // 停留中

      const dx = npc.targetX - npc.group.position.x;
      const dz = npc.targetZ - npc.group.position.z;
      const d = Math.hypot(dx, dz);

      if (d < 0.2) {
        // 到点：随机停留，然后选下一个目标
        npc.waitUntil = this.time + 2 + Math.random() * 2.5;
        this._pickTarget(npc);
        continue;
      }

      const step = Math.min(npc.speed * dt, d);
      npc.group.position.x += (dx / d) * step;
      npc.group.position.z += (dz / d) * step;

      // 朝向移动方向（与远端玩家同款 yaw 平滑）
      const targetYaw = Math.atan2(dx, dz);
      const diff = Math.atan2(Math.sin(targetYaw - npc.group.rotation.y), Math.cos(targetYaw - npc.group.rotation.y));
      npc.group.rotation.y += diff * Math.min(1, dt * 5);
    }
  }
}
