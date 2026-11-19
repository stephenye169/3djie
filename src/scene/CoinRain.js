import * as THREE from 'three';

/**
 * 街头金币雨 / 财阀金币箱
 *
 * - 玩家在街道漫游时，身边随机刷新旋转的金币与金色宝箱
 * - 走近 1.7m 自动拾取，或鼠标点击直接收走
 * - 周期性触发「金币雨」：一堆金币从天上砸下来，落地后四散发光
 * - 金额由服务端决定（onCollect 回调），前端只负责表现
 */

const MAX_COINS = 12;
const MAX_BOXES = 2;
const PICK_RADIUS = 2.0;
const PICK_RADIUS_SQ = PICK_RADIUS * PICK_RADIUS;
const CLICK_RANGE = 9;const COIN_LIFE_MS = 65_000;
const RAIN_INTERVAL_MS = [42_000, 75_000];

let glowTexture = null;

function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 232, 120, 0.95)');
  grad.addColorStop(0.35, 'rgba(255, 196, 0, 0.4)');
  grad.addColorStop(1, 'rgba(255, 196, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

let _sharedCoinAssets = null;
let _sharedBoxAssets = null;

function getCoinAssets() {
  if (_sharedCoinAssets) return _sharedCoinAssets;
  _sharedCoinAssets = {
    coinGeo: new THREE.CylinderGeometry(0.28, 0.28, 0.07, 24),
    coinMat: new THREE.MeshStandardMaterial({
      color: 0xffd24a, emissive: 0xff9d00, emissiveIntensity: 0.85, metalness: 0.9, roughness: 0.22,
    }),
    rimGeo: new THREE.TorusGeometry(0.29, 0.025, 8, 28),
    rimMat: new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
    glowMat: new THREE.SpriteMaterial({
      map: getGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  };
  return _sharedCoinAssets;
}

function getBoxAssets() {
  if (_sharedBoxAssets) return _sharedBoxAssets;
  _sharedBoxAssets = {
    boxGeo: new THREE.BoxGeometry(0.78, 0.62, 0.78),
    boxMat: new THREE.MeshStandardMaterial({
      color: 0xffc125, emissive: 0xff8a00, emissiveIntensity: 0.55, metalness: 0.95, roughness: 0.2,
    }),
    bandGeo: new THREE.BoxGeometry(0.84, 0.1, 0.84),
    bandMat: new THREE.MeshBasicMaterial({ color: 0xfff6c8 }),
    glowMat: new THREE.SpriteMaterial({
      map: getGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  };
  return _sharedBoxAssets;
}

function makeCoinMesh() {
  const a = getCoinAssets();
  const group = new THREE.Group();
  const coin = new THREE.Mesh(a.coinGeo, a.coinMat);
  coin.rotation.x = Math.PI / 2;
  coin.castShadow = true;
  group.add(coin);
  group.add(new THREE.Mesh(a.rimGeo, a.rimMat));

  const glow = new THREE.Sprite(a.glowMat);
  glow.scale.set(2.1, 2.1, 1);
  glow.renderOrder = 5;
  group.add(glow);
  return group;
}

function makeBoxMesh() {
  const a = getBoxAssets();
  const group = new THREE.Group();
  const box = new THREE.Mesh(a.boxGeo, a.boxMat);
  box.castShadow = true;
  group.add(box);
  for (const y of [-0.2, 0.2]) {
    const band = new THREE.Mesh(a.bandGeo, a.bandMat);
    band.position.y = y;
    group.add(band);
  }
  const glow = new THREE.Sprite(a.glowMat);
  glow.scale.set(3.4, 3.4, 1);
  glow.renderOrder = 5;
  group.add(glow);
  return group;
}

export class CoinRain {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./Player.js').Player} player
   * @param {number} groundY
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}|null} bounds
   * @param {THREE.Camera} camera
   * @param {HTMLElement} dom
   * @param {{onCollect:(type:'coin'|'box')=>Promise<boolean>|boolean}} handlers
   */
  constructor(scene, player, groundY, bounds, camera, dom, handlers = {}) {
    this.scene = scene;
    this.player = player;
    this.groundY = groundY;
    this.bounds = bounds;
    this.camera = camera;
    this.dom = dom;
    this.onCollect = handlers.onCollect || (() => {});

    this.entries = [];
    this.enabled = true;
    this.time = 0;
    this.spawnTimer = 0;
    this.nearTimer = 2.5;
    this.rainTimer = 10_000;
    this.pickRadiusSq = PICK_RADIUS_SQ; // 吸金磁铁 buff 动态调整（setMagnetMult）
    this.clickRange = CLICK_RANGE;
    // 客源金币（店铺流水档位奖励）：门口刷新，type='shopflow'
    this.entrances = [];
    this.flowShops = [];
    this.flowTimer = 30;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.camera = camera; // 金币/宝箱含 Sprite 时：Sprite.raycast 需要 raycaster.camera
    this.pointer = new THREE.Vector2();

    this._onClick = (e) => this._handleClick(e);
    dom.addEventListener('click', this._onClick, true);
  }

  /** 达档店铺列表 [{shopId}]（main.js 定期从 /api/shops/flowtiers 拉取后注入） */
  setFlowShops(list) {
    this.flowShops = Array.isArray(list) ? list : [];
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  /** 吸金磁铁 buff：拾取半径倍率（1 = 原始 2m） */
  setMagnetMult(mult) {
    const m = Math.max(1, Number(mult) || 1);
    const r = PICK_RADIUS * m;
    this.pickRadiusSq = r * r;
    this.clickRange = CLICK_RANGE * m;
  }

  _xRange() {
    const b = this.bounds;
    if (!b) return [-3.2, 3.2];
    return [b.minX + 0.4, b.maxX - 0.4];
  }

  _zRange() {
    const b = this.bounds;
    if (!b) return [-480, 10];
    return [b.minZ + 1, b.maxZ - 1];
  }

  /** 在玩家附近取一个街道上的落点（尽量不直接砸在脚下） */
  _pickSpot(radius = 16) {
    const [minX, maxX] = this._xRange();
    const [minZ, maxZ] = this._zRange();
    const px = this.player.position.x;
    const pz = this.player.position.z;
    let spot = null;
    for (let i = 0; i < 6; i += 1) {
      const x = Math.min(maxX, Math.max(minX, px + (Math.random() * 2 - 1) * 1.9));
      const z = Math.min(maxZ, Math.max(minZ, pz + (Math.random() * 2 - 1) * radius));
      spot = { x, z };
      if (Math.hypot(x - px, z - pz) > 3.2) break;
    }
    return spot;
  }

  _addEntry(type, spot, { falling = false, height = 0, shopId = null } = {}) {
    const mesh = type === 'box' ? makeBoxMesh() : makeCoinMesh();
    const hoverY = this.groundY + (type === 'box' ? 0.42 : 0.85);
    const startY = falling ? this.groundY + height : hoverY;

    mesh.position.set(spot.x, startY, spot.z);
    mesh.userData.lootType = type;
    this.scene.add(mesh);

    const entry = {
      type,
      shopId,
      mesh,
      hoverY,
      baseY: startY,
      fallSpeed: falling ? 6 + Math.random() * 4 : 0,
      falling,
      bornAt: performance.now(),
      phase: Math.random() * Math.PI * 2,
      spin: type === 'box' ? 0.7 : 2.4,
      claimed: false,
    };
    mesh.userData.entry = entry;
    this.entries.push(entry);
    return entry;
  }

  /** 客源金币：达档店铺门口刷新，走近拾取（拾取者得全额、店主按档位分成） */
  spawnShopFlowCoin() {
    if (!this.flowShops.length || !this.entrances.length) return null;
    const shop = this.flowShops[Math.floor(Math.random() * this.flowShops.length)];
    const entrance = this.entrances.find((e) => e.shopId === shop.shopId);
    if (!entrance) return null;
    const [minX, maxX] = this._xRange();
    const x = Math.min(maxX, Math.max(minX, entrance.x + (Math.random() * 2 - 1) * 1.2));
    return this._addEntry('shopflow', { x, z: entrance.z }, {});
  }

  _count(type) {
    return this.entries.filter((e) => e.type === type).length;
  }

  spawnCoin() {
    const spot = this._pickSpot();
    return this._addEntry('coin', spot);
  }

  /** 在脚边 1.2–1.7m 掉一枚「幸运金币」，站着也能捡到 */
  spawnNearPlayer() {
    if (this._count('coin') >= MAX_COINS) {
      const farthest = this.entries
        .filter((entry) => entry.type === 'coin' && !entry.falling && !entry.claimed)
        .sort((a, b) => {
          const da = Math.hypot(
            a.mesh.position.x - this.player.position.x,
            a.mesh.position.z - this.player.position.z
          );
          const db = Math.hypot(
            b.mesh.position.x - this.player.position.x,
            b.mesh.position.z - this.player.position.z
          );
          return db - da;
        })[0];
      if (farthest) this._remove(farthest);
    }

    const angle = Math.random() * Math.PI * 2;
    const dist = 1.2 + Math.random() * 0.5;
    const [minX, maxX] = this._xRange();
    const [minZ, maxZ] = this._zRange();
    const x = Math.min(maxX, Math.max(minX, this.player.position.x + Math.cos(angle) * dist));
    const z = Math.min(maxZ, Math.max(minZ, this.player.position.z + Math.sin(angle) * dist));
    return this._addEntry('coin', { x, z });
  }

  spawnBox() {
    const spot = this._pickSpot(20);
    return this._addEntry('box', spot);
  }

  /** 每次金币雨都随机换一片区域：离玩家 10–34m，前/后随机，横向随机整条巷宽 */
  _pickRainCenter() {
    const [minX, maxX] = this._xRange();
    const [minZ, maxZ] = this._zRange();
    const dir = Math.random() < 0.5 ? 1 : -1;
    const dist = 10 + Math.random() * 24;
    return {
      x: minX + Math.random() * (maxX - minX),
      z: Math.min(maxZ, Math.max(minZ, this.player.position.z + dir * dist)),
    };
  }

  /** 金币雨：在随机雨区中心周围天降一堆金币 */
  triggerRain(count = 14) {
    const center = this._pickRainCenter();
    const [minX, maxX] = this._xRange();
    const [minZ, maxZ] = this._zRange();
    for (let i = 0; i < count; i += 1) {
      const x = Math.min(maxX, Math.max(minX, center.x + (Math.random() * 2 - 1) * 3.2));
      const z = Math.min(maxZ, Math.max(minZ, center.z + (Math.random() * 2 - 1) * 6.5));
      this._addEntry('coin', { x, z }, {
        falling: true,
        height: 9 + Math.random() * 6,
      });
    }
  }

  _remove(entry) {
    this.scene.remove(entry.mesh);
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }

  async _collect(entry) {
    if (!entry || entry.claimed) return;
    entry.claimed = true;
    // 服务端冷却拒绝时，把金币留在原地，避免玩家白丢钱
    const ok = await this.onCollect(entry.type, entry);
    if (!ok) {
      entry.claimed = false;
      entry.retryAt = performance.now() + 800;
      return;
    }
    this._remove(entry);
  }

  _handleClick(e) {
    if (!this.enabled || !this.entries.length) return;

    if (document.pointerLockElement === this.dom) {
      this.pointer.set(0, 0);
    } else {
      const rect = this.dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const meshes = this.entries.filter((entry) => !entry.falling).map((entry) => entry.mesh);
    const hit = this.raycaster.intersectObjects(meshes, true)[0];
    if (!hit) return;

    let obj = hit.object;
    while (obj && !obj.userData.entry) obj = obj.parent;
    const entry = obj?.userData.entry;
    if (!entry) return;
    if (entry.retryAt && performance.now() < entry.retryAt) return;

    const dx = entry.mesh.position.x - this.player.position.x;
    const dz = entry.mesh.position.z - this.player.position.z;
    if (Math.hypot(dx, dz) > this.clickRange) return;

    e.stopPropagation();
    e.preventDefault();
    this._collect(entry);
  }

  update(dt, active) {
    this.time += dt;

    if (active) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 1.1 + Math.random() * 1.4;
        if (this._count('coin') < MAX_COINS) this.spawnCoin();
        if (this._count('box') < MAX_BOXES && Math.random() < 0.12) this.spawnBox();
      }

      this.rainTimer -= dt * 1000;
      if (this.rainTimer <= 0) {
        this.rainTimer = RAIN_INTERVAL_MS[0]
          + Math.random() * (RAIN_INTERVAL_MS[1] - RAIN_INTERVAL_MS[0]);
        this.triggerRain();
      }

      // 每 8–13 秒在脚边补一枚，保证站着也能有得捡
      this.nearTimer -= dt;
      if (this.nearTimer <= 0) {
        this.nearTimer = 8 + Math.random() * 5;
        this.spawnNearPlayer();
      }

      // 客源金币：25~45s 在某个达档店铺门口刷一枚
      if (this.flowShops.length && this.entrances.length) {
        this.flowTimer -= dt;
        if (this.flowTimer <= 0) {
          this.flowTimer = 25 + Math.random() * 20;
          if (this._count('shopflow') < 3) this.spawnShopFlowCoin();
        }
      }
    }

    const now = performance.now();
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (!entry || entry.claimed) continue;

      const mesh = entry.mesh;
      if (entry.falling) {
        mesh.position.y -= entry.fallSpeed * dt;
        if (mesh.position.y <= entry.hoverY) {
          mesh.position.y = entry.hoverY;
          entry.falling = false;
          entry.baseY = entry.hoverY;
        }
      } else {
        mesh.position.y = entry.baseY + Math.sin(this.time * 2.4 + entry.phase) * 0.12;
      }

      mesh.rotation.y += dt * entry.spin;
      if (entry.type !== 'box') {
        mesh.rotation.x = Math.sin(this.time * 1.8 + entry.phase) * 0.35;
      }

      if (now - entry.bornAt > COIN_LIFE_MS) {
        this._remove(entry);
        continue;
      }

      if (!active || entry.falling) continue;
      if (now - entry.bornAt < 350) continue;
      if (entry.retryAt && now < entry.retryAt) continue;
      const dx = mesh.position.x - this.player.position.x;
      const dz = mesh.position.z - this.player.position.z;
      if (dx * dx + dz * dz <= this.pickRadiusSq) this._collect(entry);
    }
  }

  dispose() {
    this.dom.removeEventListener('click', this._onClick, true);
    for (const entry of [...this.entries]) this._remove(entry);
  }
}