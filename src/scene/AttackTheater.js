import * as THREE from 'three';
import { formatMoney } from '../../shared/assets.js';
import { lootMoney } from '../ui/LootFx.js';

/**
 * 踢馆 3D 演出（README §12 / 已知限制补齐）：
 *
 * 防守方视角：踢馆发起时，攻击者的远端模型自动跑到被踢店铺门口，
 * 到达后循环播放挑衅动作（小跳 + 左右扭身），演出期间接管位置插值，
 * 结算（护盘/认栽/超时/还价成交）后恢复服务端位置同步。优雅降级：
 * 攻击者不在视野内（不同房间/太远）时跳过跑位，只保留警报。
 *
 * 攻击方视角：发起踢馆时一张「黑卡」从镜头前甩向店门口，落点弹出金额飘字；
 * 成交时金币雨（由 main.js 的 moneyBurst 处理）。
 */

const CARD_FLIGHT_MS = 850;
const RUN_SPEED = 5.5;      // 演出跑速 m/s（比玩家略快，像气势汹汹冲过来）
const ARRIVE_DIST = 0.8;
const TAUNT_JUMP = 0.16;    // 挑衅小跳高度
const GROUND_Y = 0.06;

function makeCardSprite(amount) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');

  // 黑卡本体
  ctx.save();
  ctx.translate(128, 80);
  ctx.rotate(-0.12);
  ctx.fillStyle = 'rgba(10, 8, 6, 0.95)';
  ctx.beginPath();
  ctx.roundRect(-96, -46, 192, 92, 14);
  ctx.fill();
  ctx.strokeStyle = '#f0a900';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd24a';
  ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
  ctx.fillText('黑 卡', 0, -12);
  ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#ffe6a3';
  ctx.fillText(formatMoney(amount), 0, 20);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false,
  }));
  sprite.scale.set(1.6, 1.0, 1);
  sprite.renderOrder = 40;
  return sprite;
}

export class AttackTheater {
  /**
   * @param {THREE.Scene} scene
   * @param {Array<{shopId:string,x:number,z:number,radius:number}>} entrances 数据版门口落点
   */
  constructor(scene, entrances) {
    this.scene = scene;
    this.entrances = entrances;
    this.defenderShow = null; // { entry, entrance, phase, tauntT, attackId }
    this.cards = [];          // 飞行中的黑卡 { sprite, from, to, t }
    this._tmp = new THREE.Vector3();
  }

  /** 防守方演出：接管攻击者远端模型跑向店门口挑衅。找不到模型（不在视野）时返回 false 降级 */
  beginDefenderShow(attack, entry) {
    const entrance = this.entrances.find((e) => e.shopId === attack.shopId);
    if (!entry || !entrance) return false;
    if (this.defenderShow) this.end(); // 单场演出，新的顶掉旧的

    entry.theaterControlled = true;
    this.defenderShow = {
      entry,
      entrance,
      phase: 'run',
      tauntT: 0,
      attackId: attack.attackId,
      savedY: entry.player.mesh.position.y,
    };
    return true;
  }

  /** 结束演出，恢复服务端位置插值 */
  end() {
    if (!this.defenderShow) return;
    const { entry, savedY } = this.defenderShow;
    entry.theaterControlled = false;
    entry.player.mesh.position.y = savedY;
    this.defenderShow = null;
  }

  /** 当前是否在播防守方演出（某场踢馆） */
  isPlaying(attackId) {
    return this.defenderShow?.attackId === attackId;
  }

  /** 攻击方：甩出黑卡，飞向店铺门口，落点弹金额飘字 */
  playCardThrow(shopId, amount, camPos, shopMeshes) {
    const entrance = this.entrances.find((e) => e.shopId === shopId);
    if (!entrance) return;

    const sprite = makeCardSprite(amount);
    // 起点：相机前方 2.5m、略低（像从手里甩出去）
    const dir = new THREE.Vector3();
    camPos.getWorldDirection
      ? camPos.getWorldDirection(dir)
      : dir.set(0, 0, -1);
    const from = this._tmp.copy(camPos).add(dir.multiplyScalar(2.5)).add(new THREE.Vector3(0, -0.4, 0));
    const to = new THREE.Vector3(entrance.x, GROUND_Y + 1.6, entrance.z);
    sprite.position.copy(from);
    this.scene.add(sprite);
    this.cards.push({ sprite, from: from.clone(), to, t: 0, amount });

    // 拾取音效框架复用：落点飘字在到达时触发（update 内）
    this._pendingFloat = { amount, shopId, shopMeshes };
  }

  /** 每帧驱动：跑位/挑衅/黑卡飞行 */
  update(dt, camPos) {
    // --- 防守方跑位 + 挑衅 ---
    if (this.defenderShow) {
      const { entry, entrance, phase } = this.defenderShow;
      const g = entry.player.mesh;
      const dx = entrance.x - g.position.x;
      const dz = entrance.z - g.position.z;
      const d = Math.hypot(dx, dz);

      if (phase === 'run') {
        if (d > ARRIVE_DIST) {
          const sp = Math.min(RUN_SPEED * dt, d);
          g.position.x += (dx / d) * sp;
          g.position.z += (dz / d) * sp;
          const targetYaw = Math.atan2(dx, dz);
          const diff = Math.atan2(Math.sin(targetYaw - g.rotation.y), Math.cos(targetYaw - g.rotation.y));
          g.rotation.y += diff * Math.min(1, dt * 8);
        } else {
          this.defenderShow.phase = 'taunt';
          this.defenderShow.tauntT = 0;
        }
      } else {
        // 挑衅：小跳 + 左右扭身
        this.defenderShow.tauntT += dt;
        g.position.y = (this.defenderShow.savedY ?? 0) + Math.abs(Math.sin(this.defenderShow.tauntT * 7)) * TAUNT_JUMP;
        g.rotation.y += Math.sin(this.defenderShow.tauntT * 4.5) * dt * 2.5;
      }
    }

    // --- 黑卡飞行 ---
    for (let i = this.cards.length - 1; i >= 0; i--) {
      const card = this.cards[i];
      card.t += (dt * 1000) / CARD_FLIGHT_MS;
      if (card.t >= 1) {
        this.scene.remove(card.sprite);
        card.sprite.material.map?.dispose();
        card.sprite.material.dispose();
        this.cards.splice(i, 1);
        lootMoney(card.amount, { label: `甩出黑卡 · ¥${formatMoney(card.amount)}` });
        continue;
      }
      // 抛物线：位置插值 + 抬升
      const k = card.t;
      card.sprite.position.lerpVectors(card.from, card.to, k);
      card.sprite.position.y += Math.sin(k * Math.PI) * 1.2;
    }
  }
}
