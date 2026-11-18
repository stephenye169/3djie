import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHOPS } from '../data/shops.js';
import { findAsset } from '../../shared/assets.js';
import { STREET, LANES, BUILDINGS, PAIFANG, WEST_GATE } from '../data/layout.js';

/**
 * 程序化街道（按 layout.js 的真实位置数据生成）
 *
 * 简化极速版：
 * - 一次性同步构建并合并全街（轻量体块，仅约 3~4k 三角面，毫秒级完成），
 *   消除“先出 2 栋、其余突然弹出”的加载断层
 * - 相邻建筑沿 Z 留出干净缝隙，屋顶/门窗/店招零共面叠片，彻底消除 Z-fighting 闪烁
 * - 店招改用不透明材质，避免透明排序闪烁
 */
const PROGRESSIVE_NEAR_M = 10000;
const PROGRESSIVE_BATCH = 50;

/**
 * @param {THREE.Scene} scene
 * @param {{spawnZ?: number, progressive?: boolean, onModelRequest?: (req: {building: object, group: THREE.Group, collider: THREE.Box3, url: string}) => void}} [opts]
 */
export function buildProceduralStreet(scene, opts = {}) {
  const root = new THREE.Group();
  root.name = 'procedural_street';
  scene.add(root);

  const colliders = [];
  const shopMeshes = [];
  const lodMeshes = [];
  const occluderProxies = [];
  const materials = new Map();

  _buildGround(root, materials);
  _buildRiver(root, materials);
  _buildLanes(root, materials);
  _buildPaifang(root, materials, colliders);
  _buildWestGate(root, materials, colliders);

  const spawnZ = Number(opts.spawnZ) || 10;
  const progressive = opts.progressive === true;

  const modelRequests = [];
  const requestModel = (req) => {
    modelRequests.push(req);
    opts.onModelRequest?.(req);
  };

  const ordered = [...BUILDINGS].sort(
    (a, b) => Math.abs(a.z - spawnZ) - Math.abs(b.z - spawnZ)
  );
  const near = [];
  const far = [];
  for (const building of ordered) {
    (progressive && Math.abs(building.z - spawnZ) > PROGRESSIVE_NEAR_M ? far : near).push(building);
  }

  for (const building of near) {
    const shopGroup = _buildBuilding(root, building, materials, colliders, requestModel);
    if (shopGroup) shopMeshes.push(shopGroup);
  }

  const scheduleIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (fn) => setTimeout(fn, 16);
  let farIndex = 0;
  let resolveDone = null;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  function buildNextFar() {
    const batch = far.slice(farIndex, farIndex + PROGRESSIVE_BATCH);
    farIndex += batch.length;
    for (const building of batch) {
      const shopGroup = _buildBuilding(root, building, materials, colliders, requestModel);
      if (shopGroup) shopMeshes.push(shopGroup);
    }
    if (farIndex < far.length) scheduleIdle(buildNextFar);
    else resolveDone();
  }
  if (far.length) scheduleIdle(buildNextFar);
  else resolveDone();

  _buildLanternPosts(root, materials);

  let mergedDone = false;
  const finalizeMerge = () => {
    if (mergedDone) return occluderProxies;
    mergedDone = true;
    const proxies = mergeStreetGeometries(root);
    freezeStatic(root);
    occluderProxies.push(...proxies);
    return proxies;
  };

  if (far.length === 0) finalizeMerge();

  return {
    colliders,
    shopMeshes,
    lodMeshes,
    occluderProxies,
    modelRequests,
    groundY: 0.06,
    bounds: STREET.bounds,
    progressive: {
      nearCount: near.length,
      farCount: far.length,
      done: far.length ? done.then(() => finalizeMerge()) : Promise.resolve(),
      finalizeMerge,
    },
  };
}

/**
 * 几何体合并（Draw Call 优化）：
 * - shop 建筑按「shopId × 材质」合并回各自的 shopGroup 局部空间（保持拔高缩放、点击与包围盒）
 * - 民居/路面/牌坊等公共静态物体按材质合并进 root
 */
function mergeStreetGeometries(root) {
  root.updateMatrixWorld(true);

  const buckets = new Map();
  const doomed = [];
  const occluderProxies = [];
  const shopBoxes = new Map();
  const ownerInvCache = new Map();
  const relMatrix = new THREE.Matrix4();
  const worldBox = new THREE.Box3();

  const findOwnerGroup = (obj, shopId) => {
    if (!shopId) return root;
    let cur = obj.parent;
    while (cur && cur !== root) {
      if (cur.isGroup && cur.userData?.shopId === shopId) return cur;
      cur = cur.parent;
    }
    return root;
  };

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!mat) return;
    const shopId = obj.userData?.shopId ?? null;
    const ownerGroup = findOwnerGroup(obj, shopId);
    const key = `${shopId ?? 'common'}|${mat.uuid}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mat, shopId, ownerGroup, geos: [], castShadow: false, receiveShadow: false };
      buckets.set(key, bucket);
    }
    if (obj.castShadow) bucket.castShadow = true;
    if (obj.receiveShadow) bucket.receiveShadow = true;

    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    if (ownerGroup === root) {
      geo.applyMatrix4(obj.matrixWorld);
    } else {
      let inv = ownerInvCache.get(ownerGroup);
      if (!inv) {
        inv = new THREE.Matrix4().copy(ownerGroup.matrixWorld).invert();
        ownerInvCache.set(ownerGroup, inv);
      }
      relMatrix.multiplyMatrices(inv, obj.matrixWorld);
      geo.applyMatrix4(relMatrix);
    }
    bucket.geos.push(geo);
    doomed.push(obj);
  });

  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geos, false);
    for (const g of bucket.geos) g.dispose();
    if (!merged) continue;

    merged.computeBoundingBox();
    const ownerGroup = bucket.ownerGroup;

    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    if (bucket.shopId) mesh.userData.shopId = bucket.shopId;
    ownerGroup.add(mesh);

    if (bucket.shopId && merged.boundingBox) {
      worldBox.copy(merged.boundingBox);
      if (ownerGroup !== root) worldBox.applyMatrix4(ownerGroup.matrixWorld);
      let sb = shopBoxes.get(bucket.shopId);
      if (!sb) {
        sb = new THREE.Box3();
        shopBoxes.set(bucket.shopId, sb);
      }
      sb.union(worldBox);
    }
  }

  // 为每栋 shop 建筑建 1 个隐形包围盒代理（供遮挡剔除射线快速检测）
  const proxyMat = new THREE.MeshBasicMaterial();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (const [shopId, box] of shopBoxes) {
    box.getSize(size);
    box.getCenter(center);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) continue;

    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
    proxy.visible = false;
    proxy.position.copy(center);
    proxy.userData.shopId = shopId;
    root.add(proxy);
    occluderProxies.push(proxy);
  }

  for (const obj of doomed) {
    obj.parent?.remove(obj);
    obj.geometry.dispose();
  }

  return occluderProxies;
}

/** 静态物体矩阵冻结：位置/旋转烘焙进 matrix，跳过每帧矩阵重算 */
function freezeStatic(root) {
  root.traverse((obj) => {
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
  });
  root.matrixAutoUpdate = false;
  root.updateMatrix();
}

/* ------------------------------------------------------------------ */
/* 地面 / 河 / 支巷                                                     */
/* ------------------------------------------------------------------ */

function _buildGround(parent, cache) {
  const pavingMat = _material(cache, 'paving', 0x8f887c, { roughness: 0.96 });

  const length = PAIFANG.z - STREET.westZ;
  const centerZ = (PAIFANG.z + STREET.westZ) / 2;

  // 巷子石板路（top = 0.06）
  const alley = new THREE.Mesh(new THREE.BoxGeometry(STREET.halfWidth * 2, 0.06, length), pavingMat);
  alley.position.set(0, 0.03, centerZ);
  alley.receiveShadow = true;
  parent.add(alley);

  // 东入口广场（独立抬高 1cm，避免与巷路共面闪烁）
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(16, 0.07, 8), pavingMat);
  plaza.position.set(0, 0.035, 10);
  plaza.receiveShadow = true;
  parent.add(plaza);

  // 底色地面（压低 6cm，彻底避免与路面底面接触）
  const backMat = _material(cache, 'backdrop', 0x6f6a60, { roughness: 1 });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(140, length + 40), backMat);
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.set(30, -0.06, centerZ);
  backdrop.receiveShadow = true;
  parent.add(backdrop);
}

function _buildRiver(parent, cache) {
  const { xNear, xFar, y } = STREET.river;
  const length = PAIFANG.z - STREET.westZ;
  const centerZ = (PAIFANG.z + STREET.westZ) / 2;

  const waterMat = _material(cache, 'water', 0x4a6b78, { roughness: 0.15, metalness: 0.35 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(xNear - xFar, length), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set((xNear + xFar) / 2, y, centerZ);
  parent.add(water);

  const bankMat = _material(cache, 'bank', 0x8c887e, { roughness: 0.95 });
  const bank = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, length), bankMat);
  bank.position.set(xNear - 0.35, y + 0.6, centerZ);
  bank.receiveShadow = true;
  parent.add(bank);
}

function _buildLanes(parent, cache) {
  const laneMat = _material(cache, 'lane', 0x9a9387, { roughness: 0.97 });

  for (const lane of LANES) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(lane.length, 0.05, lane.width),
      laneMat
    );
    strip.position.set(STREET.halfWidth + lane.length / 2, 0.025, lane.z);
    strip.receiveShadow = true;
    parent.add(strip);
  }
}

/* ------------------------------------------------------------------ */
/* 入口牌坊 / 西入口                                                    */
/* ------------------------------------------------------------------ */

function _buildPaifang(parent, cache, colliders) {
  const woodMat = _material(cache, 'paifang', 0x5d4a3a, { roughness: 0.85 });
  const span = PAIFANG.width;

  for (const x of [-span / 2 + 0.6, -1.7, 1.7, span / 2 - 0.6]) {
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.42, PAIFANG.height, 0.42), woodMat);
    column.position.set(x, PAIFANG.height / 2, PAIFANG.z);
    column.castShadow = true;
    parent.add(column);

    colliders.push(
      new THREE.Box3(
        new THREE.Vector3(x - 0.22, 0, PAIFANG.z - 0.22),
        new THREE.Vector3(x + 0.22, PAIFANG.height, PAIFANG.z + 0.22)
      )
    );
  }

  for (const y of [4.0, 5.15, 6.6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.3, 0.5), woodMat);
    beam.position.set(0, y, PAIFANG.z);
    beam.castShadow = true;
    parent.add(beam);
  }

  const plaque = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.95, 0.18), woodMat);
  plaque.position.set(0, 5.75, PAIFANG.z);
  parent.add(plaque);

  const plaqueMat = new THREE.MeshBasicMaterial({
    map: _textTexture('青果巷', { bg: '#3a2c22', color: '#f3dcb0' }),
  });
  for (const dir of [1, -1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.8), plaqueMat);
    face.position.set(0, 5.75, PAIFANG.z + dir * 0.11);
    if (dir < 0) face.rotation.y = Math.PI;
    parent.add(face);
  }
}

function _buildWestGate(parent, cache, colliders) {
  const wallMat = _material(cache, 'wall', 0xf2ece0, { roughness: 0.9 });
  const half = WEST_GATE.width / 2;
  const gap = 2.4;

  for (const sign of [-1, 1]) {
    const segW = half - gap;
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(segW, WEST_GATE.height, 0.5),
      wallMat
    );
    seg.position.set(sign * (gap + segW / 2), WEST_GATE.height / 2, WEST_GATE.z);
    seg.castShadow = true;
    seg.receiveShadow = true;
    parent.add(seg);

    colliders.push(
      new THREE.Box3(
        new THREE.Vector3(sign > 0 ? gap : -half, 0, WEST_GATE.z - 0.3),
        new THREE.Vector3(sign > 0 ? half : -gap, WEST_GATE.height, WEST_GATE.z + 0.3)
      )
    );
  }

  const header = new THREE.Mesh(new THREE.BoxGeometry(gap * 2, 1.0, 0.5), wallMat);
  header.position.set(0, WEST_GATE.height - 0.5, WEST_GATE.z);
  parent.add(header);
}

/* ------------------------------------------------------------------ */
/* 单体建筑（简洁白墙黛瓦体块，零叠片，易加载不闪烁）                    */
/* ------------------------------------------------------------------ */

function _buildBuilding(parent, b, cache, colliders, requestModel = null) {
  const sideSign = b.side === 'north' ? 1 : -1;
  const setback = b.setback || 0;
  const centerX = sideSign * (STREET.halfWidth + setback + b.d / 2);

  const group = new THREE.Group();
  group.position.set(centerX, 0, b.z);
  group.name = b.id;
  parent.add(group);

  // 石柱类小品
  if (b.kind === 'stone') {
    const stoneMat = _material(cache, 'stone', 0x9d968a, { roughness: 0.95 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, b.h, 0.42), stoneMat);
    post.position.set(sideSign * (STREET.halfWidth - 0.9) - centerX, b.h / 2, 0);
    post.castShadow = true;
    group.add(post);
    return null;
  }

  const wallMat = _tintedMaterial(cache, 'wall', b.id, WALL_TINTS, { roughness: 0.92 });
  const roofMat = _tintedMaterial(cache, 'roof', b.id, ROOF_TINTS, { roughness: 0.9 });
  const plinthMat = _material(cache, 'plinth', 0x8b8780, { roughness: 0.95 });
  const woodMat = _material(cache, 'wood', 0x6a4632, { roughness: 0.88 });
  const glassMat = _material(cache, 'glass', 0x2f3b46, { roughness: 0.25, metalness: 0.3 });

  // 沿 Z 向内收缩 0.08m，确保相邻建筑之间留出干净缝隙，绝不共面闪烁
  const cleanW = Math.max(0.8, b.w - 0.08);
  const plinthH = 0.4;
  const eaveY = plinthH + b.h;

  // 1. 台基
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(b.d + 0.3, plinthH, cleanW), plinthMat);
  plinth.position.y = plinthH / 2;
  plinth.receiveShadow = true;
  group.add(plinth);

  // 2. 主体墙身
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.d, b.h, cleanW), wallMat);
  body.position.y = plinthH + b.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 3. 黛瓦挑檐 + 简洁重檐/屋顶体块（用梯形收分两层瓦顶代替繁杂交叉斜板，零共面/零穿插）
  const eave = new THREE.Mesh(new THREE.BoxGeometry(b.d + 0.65, 0.26, cleanW), roofMat);
  eave.position.y = eaveY + 0.13;
  eave.castShadow = true;
  eave.receiveShadow = true;
  group.add(eave);

  const roofH = Math.min(1.5, Math.max(0.65, b.d * 0.05));
  const roofCap = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(1.2, b.d - 1.2), roofH, Math.max(0.6, cleanW - 0.4)),
    roofMat
  );
  roofCap.position.y = eaveY + 0.26 + roofH / 2;
  roofCap.castShadow = true;
  roofCap.receiveShadow = true;
  group.add(roofCap);

  // 4. 临街立面（简洁木门 + 窗，外凸足够距离不与墙面共面）
  const frontSign = -sideSign;
  const doorX = frontSign * (b.d / 2 + 0.04);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.25, Math.min(1.5, cleanW * 0.22)), woodMat);
  door.position.set(doorX, plinthH + 1.125, 0);
  group.add(door);

  // 左右各放 1 扇简洁窗户（面宽够宽时），二层加 2 扇上窗
  if (cleanW >= 6.5) {
    const winOffset = Math.min(cleanW * 0.28, 3.8);
    for (const wz of [-winOffset, winOffset]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.15), glassMat);
      win.position.set(doorX, plinthH + 1.55, wz);
      group.add(win);

      if (b.floors > 1) {
        const upWin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 1.15), glassMat);
        upWin.position.set(doorX, eaveY - 1.25, wz);
        group.add(upWin);
      }
    }
  }

  // 5. 店铺 / 地标专属：牌匾 + 门前红灯笼（普通民居跳过，大幅减少纹理和面数）
  const isFeatured = Boolean(b.shopId || b.kind === 'landmark');
  const label = isFeatured ? (b.name || _shopName(b.shopId)) : '';
  if (label) {
    const signY = Math.min(eaveY - 0.5, plinthH + 3.35);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(cleanW * 0.6, 4.4), 0.8),
      new THREE.MeshBasicMaterial({
        map: _textTexture(label, { bg: '#1a1612', color: '#f1d9a8' }),
      })
    );
    sign.position.set(frontSign * (b.d / 2 + 0.18), signY, 0);
    sign.rotation.y = -sideSign * Math.PI / 2;
    group.add(sign);
  }

  if (b.shopId) {
    const lanternMat = _material(cache, 'lantern', 0xc0392b, {
      emissive: 0x8c1d18,
      emissiveIntensity: 0.55,
      roughness: 0.7
    });
    for (const z of [-1.45, 1.45]) {
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lanternMat);
      lantern.position.set(frontSign * (b.d / 2 + 0.42), plinthH + 2.75, z);
      group.add(lantern);
    }
  }

  // 6. 历史建筑屋顶名牌
  if (b.kind === 'landmark' && b.name) {
    const tagHeight = eaveY + 0.26 + roofH + 1.0;
    const sprite = _labelSprite(b.name);
    sprite.position.set(0, tagHeight, 0);
    sprite.userData.isBuildingLabel = true;
    group.add(sprite);
  }

  // 碰撞体
  const colliderBox = new THREE.Box3(
    new THREE.Vector3(centerX - b.d / 2, 0, b.z - b.w / 2),
    new THREE.Vector3(centerX + b.d / 2, eaveY, b.z + b.w / 2)
  );
  colliders.push(colliderBox);

  if (b.shopId) {
    group.userData.shopId = b.shopId;
    group.traverse((obj) => {
      if (obj.isMesh) obj.userData.shopId = b.shopId;
    });
  }

  const modelUrl = _resolveModelUrl(b);
  if (modelUrl && requestModel) {
    requestModel({ building: b, group, collider: colliderBox, url: modelUrl });
  }

  return b.shopId ? group : null;
}

/* ------------------------------------------------------------------ */
/* 路灯 / 灯笼柱                                                        */
/* ------------------------------------------------------------------ */

function _buildLanternPosts(parent, cache) {
  const poleMat = _material(cache, 'pole', 0x3f3a34, { roughness: 0.8, metalness: 0.35 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffe1a8,
    emissive: 0xffc46b,
    emissiveIntensity: 1.4,
    roughness: 0.5
  });

  for (let z = -20; z > STREET.westZ + 10; z -= 55) {
    for (const sign of [-1, 1]) {
      const x = sign * (STREET.halfWidth - 0.7);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.0, 6), poleMat);
      pole.position.set(x, 1.5, z);
      pole.castShadow = true;
      parent.add(pole);

      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), glowMat);
      lamp.position.set(x, 3.05, z);
      parent.add(lamp);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 材质与文字纹理                                                       */
/* ------------------------------------------------------------------ */

const WALL_TINTS = [0xf2ece0, 0xece4d3, 0xf7f2e9, 0xe7dfcc];
const ROOF_TINTS = [0x41454d, 0x4a4e57, 0x3a3e45];

function _hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

function _tintedMaterial(cache, prefix, seed, tints, options) {
  const idx = _hash(seed) % tints.length;
  return _material(cache, `${prefix}-${idx}`, tints[idx], options);
}

function _material(cache, key, color, options = {}) {
  if (cache.has(key)) return cache.get(key);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
    ...options
  });
  cache.set(key, mat);
  return mat;
}

function _resolveModelUrl(b) {
  if (b.model) {
    if (/^(https?:)?\/\//.test(b.model) || b.model.startsWith('/')) return b.model;
    return `/models/${b.model}`;
  }
  const base = new URLSearchParams(window.location.search).get('models');
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${b.id}.glb`;
}

function _shopName(shopId) {
  const shop = SHOPS.find((s) => s.id === shopId);
  if (shop) return shop.name;
  return findAsset(shopId)?.name || '';
}

function _textTexture(text, { bg = '#1a1612', color = '#f1d9a8', fontSize = 64 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(241,217,168,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

  ctx.fillStyle = color;
  ctx.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = fontSize;
  while (ctx.measureText(text).width > canvas.width - 60 && size > 28) {
    size -= 4;
    ctx.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", serif`;
  }
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function _labelSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(20, 26, 33, 0.82)';
  _roundRect(ctx, 8, 26, canvas.width - 16, 76, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 208, 169, 0.9)';
  ctx.lineWidth = 3;
  _roundRect(ctx, 12, 30, canvas.width - 24, 68, 14);
  ctx.stroke();

  ctx.fillStyle = '#f7e6c8';
  ctx.font = '700 44px "PingFang SC", "Microsoft YaHei", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 44;
  while (ctx.measureText(text).width > canvas.width - 70 && size > 22) {
    size -= 3;
    ctx.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", serif`;
  }
  ctx.fillText(text, canvas.width / 2, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  sprite.scale.set(5.4, 1.35, 1);
  sprite.renderOrder = 900;
  return sprite;
}