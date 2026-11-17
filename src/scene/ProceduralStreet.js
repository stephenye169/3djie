import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHOPS } from '../data/shops.js';
import { findAsset } from '../../shared/assets.js';
import { STREET, LANES, BUILDINGS, PAIFANG, WEST_GATE } from '../data/layout.js';

/**
 * 程序化街道（按 layout.js 的真实位置数据生成）
 *
 * 目标：像百度地图 3D 视图那样——形体可以简单，但每栋楼的位置、左右与先后顺序
 * 必须与现实对应。所有建筑尺寸、朝向、沿街顺序全部来自 data/layout.js。
 */
/** LOD：细构件的显示距离（相机 30m 内显示门窗/店招/灯笼，更远只留体块） */
const LOD_DETAIL_M = 30;
/** 渐进加载：覆盖整条 500m 街道范围，进街前即全部构建合并完毕，避免进入后建筑刷新/弹出 */
const PROGRESSIVE_NEAR_M = 600;
const PROGRESSIVE_BATCH = 8;

/**
 * @param {THREE.Scene} scene
 * @param {{spawnZ?: number, progressive?: boolean, onModelRequest?: (req: {building: object, group: THREE.Group, collider: THREE.Box3, url: string}) => void}} [opts]
 *   progressive 默认开启：首屏只同步建 600m 内建筑，其余 requestIdleCallback 分批补齐；
 *   返回值里的 progressive.done 在全部建筑建成时 resolve（用于刷新地图标注等下游）。
 *   onModelRequest：layout.js 里带 model 的建筑会把「程序化占位 + 模型地址」交出去，
 *   由 WorldLoader 后台加载 GLB 后就地替换；加载失败/未提供回调时程序化建筑原样保留（回退）。
 */
export function buildProceduralStreet(scene, opts = {}) {
  const root = new THREE.Group();
  root.name = 'procedural_street';
  scene.add(root);

  const colliders = [];
  const shopMeshes = [];
  const lodMeshes = [];
  const occluderProxies = []; // 遮挡剔除代理：渐进模式下由 finalizeMerge 填充
  const materials = new Map();

  _buildGround(root, materials);
  _buildRiver(root, materials);
  _buildLanes(root, materials);
  _buildPaifang(root, materials, colliders);
  _buildWestGate(root, materials, colliders);

  const spawnZ = Number(opts.spawnZ) || 10;
  const progressive = opts.progressive !== false;
  const lodOut = lodMeshes;

  // 逐建筑 GLB 替换请求（渐进加载期间随时可能追加，所以用回调而不是一次性列表）
  const modelRequests = [];
  const requestModel = (req) => {
    modelRequests.push(req);
    opts.onModelRequest?.(req);
  };

  // 按与出生点的距离排序：近的先建（首屏可见），远的后台分批补齐
  const ordered = [...BUILDINGS].sort(
    (a, b) => Math.abs(a.z - spawnZ) - Math.abs(b.z - spawnZ)
  );
  const near = [];
  const far = [];
  for (const building of ordered) {
    (progressive && Math.abs(building.z - spawnZ) > PROGRESSIVE_NEAR_M ? far : near).push(building);
  }

  for (const building of near) {
    const shopGroup = _buildBuilding(root, building, materials, colliders, lodOut, requestModel);
    if (shopGroup) shopMeshes.push(shopGroup);
  }

  const scheduleIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (fn) => setTimeout(fn, 60);
  let farIndex = 0;
  let resolveDone = null;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  function buildNextFar() {
    const batch = far.slice(farIndex, farIndex + PROGRESSIVE_BATCH);
    farIndex += batch.length;
    for (const building of batch) {
      const shopGroup = _buildBuilding(root, building, materials, colliders, lodOut, requestModel);
      if (shopGroup) shopMeshes.push(shopGroup);
    }
    if (farIndex < far.length) scheduleIdle(buildNextFar);
    else resolveDone();
  }
  if (far.length) scheduleIdle(buildNextFar);
  else resolveDone();

  _buildLanternPosts(root, materials);

  /** 渐进完成后的收尾：几何合并 + 静态矩阵冻结（draw call 大幅下降） */
  let mergedDone = false;
  const finalizeMerge = () => {
    if (mergedDone) return occluderProxies;
    mergedDone = true;
    const proxies = mergeStreetGeometries(root, lodMeshes);
    freezeStatic(root);
    occluderProxies.push(...proxies);
    return proxies;
  };

  if (far.length === 0) finalizeMerge(); // 非渐进 / 全部首屏：立即收尾

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
 * 按「归属（shopId / common / 50m 分段 detail）× 材质 × LOD 档」分桶，桶内构件合成单个 Mesh。
 * - shop 建筑按栋独立合并，并挂回各自的 shopGroup 局部空间（保持拔高缩放与包围盒有效）
 * - 公共构件（路面/河/牌坊/灯杆/民居）合并进 common 桶；民居 detail 按 50m 分段，避免整街一起闪现
 * - detail（门窗/店招/灯笼）单独成桶并记录世界坐标 lodCenter，保留 LOD 远距离整体隐藏
 * - 烘焙坐标后统一 toNonIndexed，避免 attributes/index 不一致导致合并失败
 */
function mergeStreetGeometries(root, lodMeshes) {
  lodMeshes.length = 0; // 旧的单构件 detail mesh 即将被移除，清空避免 LOD 定时器遍历死引用

  root.updateMatrixWorld(true); // 渐进构建后矩阵可能未传播，先完整烘焙

  const buckets = new Map();
  const doomed = [];
  const occluderProxies = []; // 遮挡剔除射线用的隐形包围盒代理（每栋 shop 1 个，代替打几千三角的合并 mesh）
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
    const lod = obj.userData?.lod === 'detail' ? 'detail' : 'core';
    const lodScope = shopId ?? (lod === 'detail' ? `common-z${Math.round(obj.matrixWorld.elements[14] / 50)}` : 'common');
    const key = `${lodScope}|${mat.uuid}|${lod}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mat, shopId, ownerGroup, detail: lod === 'detail', geos: [], castShadow: false, receiveShadow: false };
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
    if (bucket.detail) {
      mesh.userData.lod = 'detail';
      const lodCenter = new THREE.Vector3();
      if (merged.boundingBox) {
        merged.boundingBox.getCenter(lodCenter);
        if (ownerGroup !== root) lodCenter.applyMatrix4(ownerGroup.matrixWorld);
      }
      mesh.userData.lodCenter = lodCenter;
      lodMeshes.push(mesh);
    }
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

  // 为每栋 shop 建筑建一个隐形包围盒代理（仅参与遮挡剔除射线，visible=false 不渲染）
  const proxyMat = new THREE.MeshBasicMaterial();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (const [shopId, box] of shopBoxes) {
    box.getSize(size);
    box.getCenter(center);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) continue;

    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
    proxy.visible = false; // 不渲染，仅被遮挡剔除射线命中
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

  // 巷子石板路
  const alley = new THREE.Mesh(new THREE.BoxGeometry(STREET.halfWidth * 2, 0.06, length), pavingMat);
  alley.position.set(0, 0.03, centerZ);
  alley.receiveShadow = true;
  parent.add(alley);

  // 东入口广场
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(16, 0.06, 8), pavingMat);
  plaza.position.set(0, 0.036, 10);
  plaza.receiveShadow = true;
  parent.add(plaza);

  // 北侧建筑后的底色地面，避免缝隙漏出天空
  const backMat = _material(cache, 'backdrop', 0x6f6a60, { roughness: 1 });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(140, length + 40), backMat);
  backdrop.rotation.x = -Math.PI / 2;
  backdrop.position.set(30, -0.02, centerZ);
  backdrop.receiveShadow = true;
  parent.add(backdrop);
}

function _buildRiver(parent, cache) {
  const { xNear, xFar, y } = STREET.river;
  const length = PAIFANG.z - STREET.westZ;
  const centerZ = (PAIFANG.z + STREET.westZ) / 2;

  // 南市河水面
  const waterMat = _material(cache, 'water', 0x4a6b78, { roughness: 0.15, metalness: 0.35 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(xNear - xFar, length), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set((xNear + xFar) / 2, y, centerZ);
  parent.add(water);

  // 河岸石栏（南侧临河民居的驳岸）
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
    strip.position.set(STREET.halfWidth + lane.length / 2, 0.028, lane.z);
    strip.receiveShadow = true;
    parent.add(strip);
  }
}

/* ------------------------------------------------------------------ */
/* 入口牌坊 / 西入口                                                    */
/* ------------------------------------------------------------------ */

function _buildPaifang(parent, cache, colliders) {
  const woodMat = _material(cache, 'paifang', 0x5d4a3a, { roughness: 0.85 });
  const roofMat = _material(cache, 'roof', 0x41454d, { roughness: 0.9 });
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

  // 三道额枋
  for (const y of [4.0, 5.15, 6.6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.3, 0.5), woodMat);
    beam.position.set(0, y, PAIFANG.z);
    beam.castShadow = true;
    parent.add(beam);
  }

  // 匾额（正反两面）
  const plaqueGeo = new THREE.BoxGeometry(3.0, 0.95, 0.18);
  const plaque = new THREE.Mesh(plaqueGeo, woodMat);
  plaque.position.set(0, 5.75, PAIFANG.z);
  parent.add(plaque);

  for (const dir of [1, -1]) {
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 0.8),
      new THREE.MeshBasicMaterial({ map: _textTexture('青果巷', { bg: '#3a2c22', color: '#f3dcb0' }), transparent: true })
    );
    face.position.set(0, 5.75, PAIFANG.z + dir * 0.1);
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
/* 单体建筑                                                             */
/* ------------------------------------------------------------------ */

function _buildBuilding(parent, b, cache, colliders, lodOut = null, requestModel = null) {
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
  const glassMat = _material(cache, 'glass', 0x2f3b46, { roughness: 0.2, metalness: 0.35 });

  const plinthH = 0.4;
  const eaveY = plinthH + b.h;

  // 台基（沿街方向保留前后余量，沿 Z 收缩 0.02 避免与紧邻建筑共面 Z-fighting）
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(b.d + 0.4, plinthH, Math.max(0.5, b.w - 0.02)), plinthMat);
  plinth.position.y = plinthH / 2;
  plinth.receiveShadow = true;
  group.add(plinth);

  // 墙身
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.d, b.h, b.w), wallMat);
  body.position.y = plinthH + b.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 檐口
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(b.d + 0.7, 0.28, Math.max(0.5, b.w - 0.02)), roofMat);
  cornice.position.y = eaveY + 0.02;
  cornice.castShadow = true;
  group.add(cornice);

  // 硬山双坡屋顶：沿进深方向按"进"分段，每段各自起脊，
  // 避免深宅（d 30–55m）被做成一个十几米高的巨型屋面。
  const segments = Math.max(1, Math.round(b.d / 8));
  const segD = b.d / segments;
  const rise = Math.min(segD * 0.42, 2.3);
  const half = segD / 2 + 0.22;
  const slopeLen = Math.hypot(half, rise);
  const angle = Math.atan2(rise, half);

  const triShape = new THREE.Shape();
  triShape.moveTo(-segD / 2, 0);
  triShape.lineTo(segD / 2, 0);
  triShape.lineTo(0, rise);
  triShape.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(triShape, { depth: 0.16, bevelEnabled: false });

  for (let i = 0; i < segments; i++) {
    const segX = -b.d / 2 + segD * (i + 0.5);

    for (const dir of [1, -1]) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(slopeLen, 0.16, Math.max(0.5, b.w - 0.02)),
        roofMat
      );
      slab.position.set(segX + (dir * half) / 2, eaveY + rise / 2, 0);
      slab.rotation.z = -dir * angle;
      slab.castShadow = true;
      slab.receiveShadow = true;
      group.add(slab);
    }

    // 每段屋顶两端的山墙封头（收进建筑宽度内，避免探入紧邻建筑引发闪烁）
    for (const dir of [1, -1]) {
      const gable = new THREE.Mesh(gableGeo, wallMat);
      gable.position.set(segX, eaveY, dir > 0 ? b.w / 2 - 0.16 : -b.w / 2);
      gable.castShadow = true;
      group.add(gable);
    }
  }

  // ---- 临街立面（按开间排布门窗，避免整面白墙）----
  const frontSign = -sideSign; // 立面朝向：北侧建筑朝 -x，南侧朝 +x
  const frontX = frontSign * (b.d / 2 + 0.04);

  const bayCount = Math.max(2, Math.round(b.w / 3.4));
  const step = b.w / bayCount;
  const doorBays = new Set([Math.floor((bayCount - 1) / 2)]);
  if (bayCount >= 6) doorBays.add(Math.floor((bayCount - 1) / 2) + Math.floor(bayCount / 2));

  for (let i = 0; i < bayCount; i++) {
    const z = -b.w / 2 + step * (i + 0.5);

    if (doorBays.has(i)) {
      const doorW = Math.min(1.5, step * 0.55);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, doorW), woodMat);
      door.position.set(frontX, plinthH + 1.15, z);
      door.userData.lod = 'detail';
      group.add(door);

      // 门楣
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, doorW + 0.34), woodMat);
      lintel.position.set(frontX, plinthH + 2.42, z);
      lintel.userData.lod = 'detail';
      group.add(lintel);
    } else {
      _addWindow(group, frontX, frontSign, z, plinthH + 1.55, woodMat, glassMat);
    }

    if (b.floors > 1) {
      _addWindow(group, frontX, frontSign, z, eaveY - 1.25, woodMat, glassMat);
    }
  }

  // 店招 / 名称匾
  const label = b.name || _shopName(b.shopId);
  if (label) {
    const signY = Math.min(eaveY - 0.55, plinthH + 3.45);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(b.w * 0.62, 4.6), 0.82),
      new THREE.MeshBasicMaterial({
        map: _textTexture(label, { bg: 'rgba(26,22,18,0.88)', color: '#f1d9a8' }),
        transparent: true
      })
    );
    sign.position.set(frontX + frontSign * 0.11, signY, 0);
    sign.rotation.y = -sideSign * Math.PI / 2;
    sign.userData.lod = 'detail';
    group.add(sign);
  }

  // 门口灯笼（复用缓存材质，合并进同一批次）
  const lanternMat = _material(cache, 'lantern', 0xc0392b, {
    emissive: 0x8c1d18,
    emissiveIntensity: 0.55,
    roughness: 0.7
  });
  for (const z of [-1.45, 1.45]) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), lanternMat);
    lantern.position.set(frontX + frontSign * 0.42, plinthH + 2.75, z);
    lantern.userData.lod = 'detail';
    group.add(lantern);
  }

  // 历史建筑：屋顶上方浮动名牌（地图式标注）
  if (b.kind === 'landmark' && b.name) {
    const tagHeight = eaveY + rise + 1.0;
    const sprite = _labelSprite(b.name);
    sprite.position.set(0, tagHeight, 0);
    sprite.userData.isBuildingLabel = true; // 换 GLB 时保留，并跟随新屋顶高度
    group.add(sprite);
  }

  // 碰撞体（取建筑外墙范围）；留引用，GLB 替换后按模型包围盒就地更新
  const colliderBox = new THREE.Box3(
    new THREE.Vector3(centerX - b.d / 2, 0, b.z - b.w / 2),
    new THREE.Vector3(centerX + b.d / 2, eaveY, b.z + b.w / 2)
  );
  colliders.push(colliderBox);

  // 可交互资产绑定 shopId（店铺 + 可收购的历史建筑）
  if (b.shopId) {
    group.userData.shopId = b.shopId;
    group.traverse((obj) => {
      if (obj.isMesh) obj.userData.shopId = b.shopId;
    });
  }

  // LOD：收集远距离需要隐藏的细构件（门窗 / 门楣 / 店招 / 灯笼）
  if (lodOut) {
    group.traverse((obj) => {
      if (obj.userData?.lod === 'detail') lodOut.push(obj);
    });
  }

  // 真实 GLB：数据里给了 model（或 URL 带 ?models=）→ 交给 WorldLoader 后台替换
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
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.0, 8), poleMat);
      pole.position.set(x, 1.5, z);
      pole.castShadow = true;
      parent.add(pole);

      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), glowMat);
      lamp.position.set(x, 3.05, z);
      parent.add(lamp);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 材质与文字纹理                                                       */
/* ------------------------------------------------------------------ */

/** 白墙 / 黛瓦的几档色差，让相邻建筑不是同一块色板 */
const WALL_TINTS = [0xf2ece0, 0xece4d3, 0xf7f2e9, 0xe7dfcc];
const ROOF_TINTS = [0x41454d, 0x4a4e57, 0x3a3e45];

function _hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** 按建筑 id 稳定地挑一档色差，材料仍按色档复用 */
function _tintedMaterial(cache, prefix, seed, tints, options) {
  const idx = _hash(seed) % tints.length;
  return _material(cache, `${prefix}-${idx}`, tints[idx], options);
}

/** 一扇木框窗（挂在临街立面上） */
function _addWindow(group, frontX, frontSign, z, y, woodMat, glassMat) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.35, 1.15), woodMat);
  frame.position.set(frontX, y, z);
  frame.userData.lod = 'detail';
  group.add(frame);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.08, 0.9), glassMat);
  glass.position.set(frontX + frontSign * 0.06, y, z);
  glass.userData.lod = 'detail';
  group.add(glass);
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

/**
 * 解析某栋建筑的真实模型地址：
 * 1. layout.js 显式 `model`（相对 /models/，或 / 开头、http(s) 完整地址）
 * 2. 否则看 URL 参数 `?models=/models`：按 `<building.id>.glb` 批量匹配，便于整街替换试模型
 * 都没有 → null（纯程序化）
 */
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

/** 生成带圆角深色底 + 暖金字的牌匾纹理 */
function _textTexture(text, { bg = 'rgba(26,22,18,0.9)', color = '#f1d9a8', fontSize = 64 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bg;
  _roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(241,217,168,0.85)';
  ctx.lineWidth = 4;
  _roundRect(ctx, 10, 10, canvas.width - 20, canvas.height - 20, 12);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = `700 ${fontSize}px "PingFang SC", "Microsoft YaHei", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 名称过长时自动缩小字号
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

/** 屋顶浮动名牌（Sprite，始终面向相机） */
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