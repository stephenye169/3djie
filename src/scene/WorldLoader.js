import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { buildProceduralStreet } from './ProceduralStreet.js';
import { createShopMarker } from './ShopMarker.js';

/**
 * 世界加载器
 * - 优先加载外部 GLB（通过 URL 参数 ?glb=xxx 或 MODEL_PATH 指定）——整场景替换
 * - 加载失败 / 未提供时，回退到程序化生成的街道场景
 * - 程序化场景里，layout.js 带 model 的建筑会在后台用 GLB 逐栋替换（失败则保留程序化）
 * 通过 onProgress(percent, status) 汇报进度
 */
export class WorldLoader {
  constructor() {
    this.colliders = []; // 建筑碰撞体（THREE.Box3 数组）
    this.shopMeshes = []; // 可点击的店铺 mesh 列表
    this.lodMeshes = []; // LOD 细构件（门窗/店招/灯笼，远距离隐藏）
    this.groundY = 0;
    this.bounds = null; // 可行走边界 {minX,maxX,minZ,maxZ}
    this.progressive = null; // { nearCount, farCount, done }（渐进加载时存在）
    this.modelRequests = []; // 逐建筑 GLB 替换请求
    this.modelLoads = []; // 替换用的 Promise（不经阻塞首屏，失败不影响游玩）
    this._gltfCache = new Map(); // url → Promise<gltf>（同一模型多栋复用只下一次）
    this._draco = null;
  }

  /**
   * @param {THREE.Scene} scene
   * @param {(pct:number, status:string)=>void} onProgress
   * @param {(msg:string)=>void} [onError]
   * @param {{spawnZ?: number}} [opts] 渐进加载的首屏中心（玩家出生点 z）
   */
  async load(scene, onProgress, onError, { spawnZ = 10 } = {}) {
    const glbUrl = this._resolveGlbUrl();

    if (glbUrl) {
      try {
        await this._loadGlb(scene, glbUrl, onProgress);
      } catch (err) {
        console.warn('GLB 加载失败，使用程序化场景:', err);
        const msg = '模型加载失败，已切换到内置示例场景';
        onError?.(msg);
        this._buildFallback(scene, onProgress, msg, spawnZ);
      }
    } else {
      this._buildFallback(scene, onProgress, '未指定 GLB 模型，使用内置程序化街道', spawnZ);
    }

    // 为所有店铺生成可点击图标。
    // 渐进加载模式下等全部建筑建成后再建（图标位置依赖建筑包围盒）。
    if (this.progressive) {
      this.progressive.done.then(() => this._createShopMarkers(scene));
    } else {
      this._createShopMarkers(scene);
    }

    return {
      colliders: this.colliders,
      shopMeshes: this.shopMeshes,
      lodMeshes: this.lodMeshes,
      occluderProxies: this.occluderProxies,
      groundY: this.groundY,
      bounds: this.bounds,
      progressive: this.progressive,
      finalizeMerge: this.finalizeMerge,
    };
  }

  _resolveGlbUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('glb');
    if (fromUrl) return fromUrl;
    // 也可在此处硬编码模型路径，例如:
    // return '/models/street.glb';
    return null;
  }

  async _loadGlb(scene, url, onProgress) {
    onProgress?.(5, `正在下载模型…`);

    const loader = this._createGltfLoader();

    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        url,
        resolve,
        (xhr) => {
          if (xhr.lengthComputable) {
            const pct = Math.round((xhr.loaded / xhr.total) * 90) + 5;
            onProgress?.(pct, `加载模型中… ${pct}%`);
          }
        },
        (err) => reject(err)
      );
    });

    onProgress?.(95, '解析碰撞体…');
    this._processGltf(scene, gltf.scene);
    onProgress?.(100, '加载完成');
  }

  /** 共用一个 GLTFLoader（带 Draco 解码） */
  _createGltfLoader() {
    const loader = new GLTFLoader();
    // 尝试启用 Draco 解码（如模型经过压缩）
    try {
      if (!this._draco) {
        this._draco = new DRACOLoader();
        this._draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      }
      loader.setDRACOLoader(this._draco);
    } catch (e) { /* 忽略 */ }
    return loader;
  }

  _processGltf(scene, root) {
    scene.add(root);

    // 遍历 mesh，收集碰撞体与店铺
    const box = new THREE.Box3();
    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;

        // 以名称中包含 "ground" / "floor" / "road" 视为地面
        const name = (obj.name || '').toLowerCase();
        if (/(ground|floor|road|terrain|street)/.test(name)) {
          box.setFromObject(obj);
          this.groundY = Math.max(this.groundY, box.max.y);
        }

        // 以名称中包含 "wall" / "building" / "house" / "shop" 视为建筑碰撞
        if (/(wall|building|house|shop|store)/.test(name)) {
          const b = new THREE.Box3().setFromObject(obj);
          this.colliders.push(b);
        }

        // 店铺识别：userData.shopId 或名称包含 shop_xxx
        const shopId = obj.userData?.shopId || (name.match(/shop[_-]?(\w+)/) || [])[1];
        if (shopId) {
          obj.userData.shopId = shopId;
          this.shopMeshes.push(obj);
        }
      }
    });

    // 若未识别到地面，使用包围盒底部
    if (this.groundY === 0) {
      const sceneBox = new THREE.Box3().setFromObject(root);
      this.groundY = sceneBox.min.y;
    }

    // 计算可行走边界：取场景包围盒的 XZ 范围，收缩 1 单位作为安全边距
    const sceneBox = new THREE.Box3().setFromObject(root);
    this.bounds = {
      minX: sceneBox.min.x + 1,
      maxX: sceneBox.max.x - 1,
      minZ: sceneBox.min.z + 1,
      maxZ: sceneBox.max.z - 1
    };
  }

  _buildFallback(scene, onProgress, reason, spawnZ = 10) {
    onProgress?.(30, reason);
    onProgress?.(60, '生成程序化街道…');

    const result = buildProceduralStreet(scene, { spawnZ });
    this.colliders = result.colliders;
    this.shopMeshes = result.shopMeshes;
    this.lodMeshes = result.lodMeshes;
    this.occluderProxies = result.occluderProxies;
    this.groundY = result.groundY;
    this.bounds = result.bounds;
    this.progressive = result.progressive;
    this.finalizeMerge = result.progressive?.finalizeMerge ?? null;

    onProgress?.(100, '场景就绪');
  }

  /* ---------------- 逐建筑 GLB 替换（后台，失败回退程序化） ---------------- */

  /** 排队一次建筑模型替换；不改首屏加载时长 */
  _queueBuildingModel(req) {
    const task = this._applyBuildingModel(req).catch((err) => {
      console.warn(`[GLB] 保留程序化建筑（${req.building.id}）：`, err?.message || err);
    });
    this.modelLoads.push(task);
    return task;
  }

  async _loadGltfModel(url) {
    if (this._gltfCache.has(url)) return this._gltfCache.get(url);
    const loader = this._createGltfLoader();
    const p = new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
    this._gltfCache.set(url, p);
    try {
      return await p;
    } catch (err) {
      this._gltfCache.delete(url); // 失败不缓存，下次进入还能重试
      throw err;
    }
  }

  /**
   * 用 GLB 替换某栋建筑的程序化几何体
   * - 保留 group（名字 / userData.shopId / 历史建筑浮动名牌），只换内部模型
   * - 碰撞体按模型实际包围盒就地更新（Player 持有同一个 Box3 引用）
   * - 店铺图标、门口触发圈、地图标注都基于 group / layout 数据，不用重建
   */
  async _applyBuildingModel({ building, group, collider, url }) {
    const gltf = await this._loadGltfModel(url);
    const source = gltf.scene || gltf.scenes?.[0];
    if (!source) throw new Error('GLB 里没有可用的 scene');

    const model = source.clone(true);
    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    if (building.modelFit === 'none') {
      model.position.set(0, 0, 0);
    } else {
      this._fitModelToBuilding(model, building);
    }

    // 替换程序化几何体（保留历史建筑的浮动名牌）
    for (const child of [...group.children]) {
      if (!child.userData?.isBuildingLabel) group.remove(child);
    }
    group.add(model);

    // 碰撞体按模型包围盒更新
    group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    if (!box.isEmpty()) collider.copy(box);

    // 名牌跟到新屋顶上方
    for (const child of group.children) {
      if (child.userData?.isBuildingLabel && !box.isEmpty()) {
        child.position.set(0, box.max.y + 1.0, 0);
      }
    }

    // 被换掉的细构件已脱离场景，从 LOD 列表里就地摘除（main.js 持有同一数组）
    for (let i = this.lodMeshes.length - 1; i >= 0; i--) {
      if (!this.lodMeshes[i].parent) this.lodMeshes.splice(i, 1);
    }

    console.info(`[GLB] 建筑已替换：${building.id} ← ${url}`);
  }

  /** 等比缩放到这栋建筑的面宽 / 进深 / 檐口高，并居中贴地 */
  _fitModelToBuilding(model, b) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const targetH = (b.h || 4) + 1.2; // 檐口 + 屋脊的近似总高
    const scale = Math.min(
      b.d / Math.max(size.x, 1e-3),
      b.w / Math.max(size.z, 1e-3),
      targetH / Math.max(size.y, 1e-3)
    );
    if (Number.isFinite(scale) && scale > 0) model.scale.setScalar(scale);

    const scaled = new THREE.Box3().setFromObject(model);
    const center = scaled.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= scaled.min.y;
  }

  /**
   * 为每个店铺 mesh 生成浮动图标，并加入可点击列表
   * 图标位置基于建筑包围盒顶部，不依赖建筑内部结构
   */
  _createShopMarkers(scene) {
    const markers = [];
    for (const shopMesh of this.shopMeshes) {
      const marker = createShopMarker(shopMesh);
      if (marker) {
        scene.add(marker);
        markers.push(marker);
      }
    }
    // 图标也加入可点击列表，点击图标等同点击店铺
    this.shopMeshes.push(...markers);
  }
}
