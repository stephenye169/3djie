import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 第三人称角色控制器
 * - WASD 相对摄像机水平朝向移动
 * - 简易重力 + 地面贴合
 * - 通过 colliders（THREE.Box3 数组）做 AABB 碰撞
 */
export class Player {
  /**
   * @param options { variant: 'male' | 'female', name: string }
   */
  constructor(colliders = [], groundY = 0, bounds = null, options = {}) {
    const { variant = 'male', name = '阿青' } = options;
    this.variant = variant;
    this.name = name;
    this.colliders = colliders;
    this.groundY = groundY;
    this.bounds = bounds; // {minX,maxX,minZ,maxZ} 或 null

    // 碰撞胶囊尺寸
    this.radius = 0.5;
    this.height = 1.8;
    this.speed = 6;
    this.sprintSpeed = 12; // Shift 加速奔跑速度
    this.jumpSpeed = 7;
    this.gravity = -18;

    this.velocity = new THREE.Vector3();
    this.onGround = true;

    this.mesh = this._buildMesh(variant);
    this.mesh.add(this._makeNameTag(name));
    this.mesh.position.set(0, groundY + this.height / 2, 10);

    this._walkPhase = 0; // 走路摆动相位

    // 用于碰撞检测与移动计算的临时向量/盒子（避免每帧重复 new Vector3）
    this._box = new THREE.Box3();
    this._half = new THREE.Vector3(this.radius, this.height / 2, this.radius);
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
  }

  /**
   * 程序化圆润小人（零外部资源）
   *
   * 层级结构：
   *   group（玩家总 Group，原点在碰撞体中心）
   *   └─ rig（原点在脚底）
   *      ├─ legLeft / legRight   髋部为轴心，走路只转这两个 Group
   *      ├─ torso / 裙摆         居中静态部件
   *      ├─ armLeft / armRight   肩部为轴心
   *      └─ headGroup            头心为轴心，头/眼/头发都挂在里面
   *
   * 对称部件只写左侧，再用 scale.x = -1 镜像出右侧（位置取反）；
   * 马尾、后脑短发等居中部件不做镜像。
   * 注意：组原点保持在玩家中心（离地 height/2），碰撞与传送逻辑不变
   */
  _buildMesh(variant) {
    const female = variant === 'female';
    const group = new THREE.Group();
    group.name = 'player';

    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: female ? 0x4a3020 : 0x3b2f2a, roughness: 0.85 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: female ? 0xc8323c : 0x3b82f6, roughness: 0.75 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.85 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
    const legMat = female ? skin : pantsMat; // 女生裙子下露出小腿

    // rig 原点在脚底，整体下移半高，使 group 原点保持在碰撞体中心
    const rig = new THREE.Group();
    rig.name = 'rig';
    rig.position.y = -this.height / 2;
    group.add(rig);

    /** 把单个 geometry 施加局部变换后返回（不修改原 geo，便于后续 mirror） */
    const _apply = (geo, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0 }) => {
      const g = geo.clone();
      g.translate(x, y, z);
      g.scale(sx, sy, sz);
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      if (rz) g.rotateZ(rz);
      return g;
    };

    /** 收集一组 {geo, mat, 变换}，按材质分组 merge 成 mesh 挂到 parent；每组必须同材质 */
    const _mergeToParent = (parts, parent) => {
      const byMat = new Map();
      for (const p of parts) {
        if (!byMat.has(p.mat)) byMat.set(p.mat, []);
        byMat.get(p.mat).push(_apply(p.geo, p));
      }
      for (const [mat, geos] of byMat) {
        const merged = mergeGeometries(geos, false);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true;
        parent.add(mesh);
      }
    };

    /** 只建左侧，再整体镜像到右侧（用于动态 Group） */
    const mirrorGroupX = (srcGroup) => {
      const copy = srcGroup.clone(true);
      copy.position.x = -srcGroup.position.x;
      copy.scale.x = -1;
      copy.name = (srcGroup.name || 'group').replace('Left', 'Right');
      srcGroup.parent.add(copy);
      return copy;
    };

    // ---- 腿：左侧构建后镜像（动态 Group，内部两个不同材质 mesh 无法合并） ----
    const legGeo = new THREE.CapsuleGeometry(0.075, 0.5, 4, 6);
    const shoeGeoRaw = new THREE.SphereGeometry(0.095, 8, 6);
    const legL = new THREE.Group();
    legL.name = 'legLeft';
    legL.position.set(-0.11, 0.8, 0);
    rig.add(legL);
    _mergeToParent([{ geo: legGeo, mat: legMat, y: -0.36 }], legL);
    _mergeToParent([{ geo: shoeGeoRaw, mat: shoeMat, y: -0.74, z: 0.05, sx: 1, sy: 0.55, sz: 1.5 }], legL);
    const legR = mirrorGroupX(legL);

    // ---- 躯干 + 女生裙摆（同材质 shirtMat，合并成一个 mesh） ----
    const torsoGeo = new THREE.CapsuleGeometry(0.19, 0.22, 5, 10);
    const torsoParts = [{ geo: torsoGeo, mat: shirtMat, y: 1.1, sz: 0.72 }];
    if (female) {
      torsoParts.push({ geo: new THREE.CylinderGeometry(0.2, 0.33, 0.44, 12), mat: shirtMat, y: 0.74 });
    }
    _mergeToParent(torsoParts, rig);

    // ---- 手臂：左侧构建后镜像（动态 Group，臂=shirtMat / 手=skin 不同材质） ----
    const armGeo = new THREE.CapsuleGeometry(0.052, 0.36, 4, 6);
    const handGeo = new THREE.SphereGeometry(0.058, 6, 5);
    const armL = new THREE.Group();
    armL.name = 'armLeft';
    armL.position.set(-0.28, 1.32, 0);
    rig.add(armL);
    _mergeToParent([{ geo: armGeo, mat: shirtMat, y: -0.22 }], armL);
    _mergeToParent([{ geo: handGeo, mat: skin, y: -0.47 }], armL);
    const armR = mirrorGroupX(armL);

    // ---- 头：headGroup 以头心为轴（眼睛=shoeMat / 发=hairMat 各自合并，头=skin 单独） ----
    const headGroup = new THREE.Group();
    headGroup.name = 'headGroup';
    headGroup.position.set(0, 1.56, 0);
    rig.add(headGroup);

    // 头（skin）
    _mergeToParent([{
      geo: new THREE.SphereGeometry(0.185, 12, 8),
      mat: skin, sx: 1, sy: 1.02, sz: 0.96,
    }], headGroup);

    // 眼睛（shoeMat：左眼 + 镜像右眼 → 同一材质合并）
    const eyeGeo = new THREE.SphereGeometry(0.026, 5, 4);
    const eyes = [
      { geo: eyeGeo, mat: shoeMat, x: -0.066, y: 0.025, z: 0.17 },
      { geo: eyeGeo, mat: shoeMat, x: 0.066, y: 0.025, z: 0.17 },
    ];
    _mergeToParent(eyes, headGroup);

    // 头发（hairMat：全部同材质 → 合并成 1 个 mesh）
    const hairParts = [];
    // 头顶发罩：半球
    hairParts.push({
      geo: new THREE.SphereGeometry(0.197, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.54),
      mat: hairMat, x: 0, y: 0.002, z: -0.008,
    });
    if (female) {
      // 后披长发（压扁胶囊）
      hairParts.push({ geo: new THREE.CapsuleGeometry(0.135, 0.24, 4, 7), mat: hairMat, y: -0.13, z: -0.12, sz: 0.6 });
      // 两侧鬓发：左侧 + 镜像右侧
      const sideGeo = new THREE.CapsuleGeometry(0.04, 0.2, 3, 5);
      hairParts.push({ geo: sideGeo, mat: hairMat, x: -0.172, y: -0.06, z: -0.01 });
      hairParts.push({ geo: sideGeo, mat: hairMat, x: 0.172, y: -0.06, z: -0.01 });
      // 马尾（居中）
      hairParts.push({ geo: new THREE.CapsuleGeometry(0.052, 0.26, 3, 5), mat: hairMat, y: -0.26, z: -0.21, rx: 0.3 });
    } else {
      // 后脑短发（压扁球）
      hairParts.push({ geo: new THREE.SphereGeometry(0.165, 10, 7), mat: hairMat, x: 0, y: -0.03, z: -0.09, sx: 1.05, sy: 0.9, sz: 0.8 });
    }
    _mergeToParent(hairParts, headGroup);

    this._parts = { legL, legR, armL, armR, headGroup };
    return group;
  }

  /** 头顶昵称牌（始终朝向相机） */
  _makeNameTag(name) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = 'bold 44px "Microsoft YaHei", sans-serif';
    ctx.font = font;
    const textW = ctx.measureText(name).width;
    canvas.width = Math.ceil(textW + 44);
    canvas.height = 72;

    ctx.fillStyle = 'rgba(22, 28, 38, 0.72)';
    ctx.beginPath();
    ctx.roundRect(2, 8, canvas.width - 4, canvas.height - 16, 16);
    ctx.fill();
    ctx.font = font;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2 + 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    );
    sprite.renderOrder = 15;
    // 名字越长越宽，适当压低字号，避免名牌横跨半条街
    const h = name.length > 8 ? 0.26 : 0.36;
    sprite.scale.set((canvas.width / canvas.height) * h, h, 1);
    sprite.position.y = this.height / 2 + 0.42;
    return sprite;
  }

  /** 在昵称上方显示聊天气泡，新消息会替换旧消息 */
  showChatBubble(text, duration = 5000) {
    const content = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!content) return;

    clearTimeout(this._chatBubbleTimer);
    if (this.chatBubble) {
      this.mesh.remove(this.chatBubble);
      this.chatBubble.material.map?.dispose();
      this.chatBubble.material.dispose();
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '36px "Microsoft YaHei", sans-serif';
    const maxTextWidth = 560;
    ctx.font = font;

    // 按实际像素宽度换行，兼容中文与英文；长消息最多显示三行
    const lines = [];
    let line = '';
    for (const char of content) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxTextWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    if (lines.length > 3) {
      lines.length = 3;
      let last = lines[2];
      while (last && ctx.measureText(last + '…').width > maxTextWidth) {
        last = last.slice(0, -1);
      }
      lines[2] = last + '…';
    }

    const textWidth = Math.max(...lines.map((item) => ctx.measureText(item).width));
    canvas.width = Math.ceil(textWidth + 44);
    const lineHeight = 46;
    const bodyHeight = lines.length * lineHeight + 24;
    canvas.height = bodyHeight + 14;

    ctx.font = font;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.beginPath();
    ctx.roundRect(2, 2, canvas.width - 4, bodyHeight - 4, 16);
    ctx.fill();
    // 气泡下方的小三角，指向人物昵称
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 10, bodyHeight - 3);
    ctx.lineTo(canvas.width / 2 + 10, bodyHeight - 3);
    ctx.lineTo(canvas.width / 2, canvas.height - 2);
    ctx.fill();

    ctx.fillStyle = '#1f2937';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((item, index) => {
      ctx.fillText(item, canvas.width / 2, 12 + lineHeight * (index + 0.5));
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    );
    sprite.renderOrder = 16;
    const h = canvas.height / 180;
    sprite.scale.set((canvas.width / canvas.height) * h, h, 1);
    sprite.position.y = this.height / 2 + 0.64 + h / 2;
    this.mesh.add(sprite);
    this.chatBubble = sprite;
    this._chatBubbleTimer = setTimeout(() => {
      if (this.chatBubble === sprite) sprite.visible = false;
    }, duration);
  }

  get position() {
    return this.mesh.position;
  }

  setColliders(colliders) {
    this.colliders = colliders;
  }

  setGroundY(y) {
    this.groundY = y;
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  /** 传送到指定水平坐标（用于进出店铺），并落地、清空速度 */
  teleport(x, z) {
    this.mesh.position.set(x, this.groundY + this.height / 2, z);
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
    this.onGround = true;
  }

  /**
   * @param {number} dt 秒
   * @param {Object} input {forward, back, left, right, jump}
   * @param {number} cameraYaw 摄像机水平朝向（弧度）
   */
  update(dt, input, cameraYaw) {
    dt = Math.min(dt, 0.05); // 防止大跳

    // 水平移动方向（相对摄像机）
    const forward = this._forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const right = this._right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));

    const moveDir = this._moveDir.set(0, 0, 0);
    if (input.forward) moveDir.add(forward);
    if (input.back) moveDir.sub(forward);
    if (input.right) moveDir.add(right);
    if (input.left) moveDir.sub(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
      const curSpeed = input.sprint ? this.sprintSpeed : this.speed;
      this.velocity.x = moveDir.x * curSpeed;
      this.velocity.z = moveDir.z * curSpeed;
      // 角色朝向移动方向
      const targetYaw = Math.atan2(moveDir.x, moveDir.z);
      this.mesh.rotation.y = this._lerpAngle(this.mesh.rotation.y, targetYaw, 0.2);
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // 走路动画：移动时四肢前后摆动（奔跑时更快），静止时平滑回正
    const moving = moveDir.lengthSq() > 0;
    if (moving) this._walkPhase += dt * (input.sprint ? 13 : 9);
    const swing = moving ? Math.sin(this._walkPhase) * 0.55 : 0;
    const ease = Math.min(1, dt * 12);
    const limbs = this._parts;
    limbs.legL.rotation.x += (swing - limbs.legL.rotation.x) * ease;
    limbs.legR.rotation.x += (-swing - limbs.legR.rotation.x) * ease;
    limbs.armL.rotation.x += (-swing * 0.85 - limbs.armL.rotation.x) * ease;
    limbs.armR.rotation.x += (swing * 0.85 - limbs.armR.rotation.x) * ease;

    // 跳跃
    if (input.jump && this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }

    // 重力
    this.velocity.y += this.gravity * dt;

    // 分轴移动 + 碰撞（XZ 轴做 AABB 碰撞，Y 轴做地面检测）
    // 分段边界：若走出可行走并集（巷道/广场），只回退该轴，沿边界仍可滑动
    if (this.bounds?.rects) this._clampToWalkable();
    const dx = this.velocity.x * dt;
    this._moveAxis('x', dx);
    if (this.bounds?.rects && !this._insideWalkable()) {
      this.mesh.position.x -= dx;
      this.velocity.x = 0;
    }
    const dz = this.velocity.z * dt;
    this._moveAxis('z', dz);
    if (this.bounds?.rects && !this._insideWalkable()) {
      this.mesh.position.z -= dz;
      this.velocity.z = 0;
    }

    // Y 轴
    this.mesh.position.y += this.velocity.y * dt;
    const minY = this.groundY + this.height / 2;
    if (this.mesh.position.y <= minY) {
      this.mesh.position.y = minY;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // 简单矩形边界钳制（室内等单矩形场景；分段边界已在上方逐轴处理）
    if (this.bounds && !this.bounds.rects) {
      const r = this.radius;
      if (this.mesh.position.x < this.bounds.minX + r) {
        this.mesh.position.x = this.bounds.minX + r;
        this.velocity.x = 0;
      } else if (this.mesh.position.x > this.bounds.maxX - r) {
        this.mesh.position.x = this.bounds.maxX - r;
        this.velocity.x = 0;
      }
      if (this.mesh.position.z < this.bounds.minZ + r) {
        this.mesh.position.z = this.bounds.minZ + r;
        this.velocity.z = 0;
      } else if (this.mesh.position.z > this.bounds.maxZ - r) {
        this.mesh.position.z = this.bounds.maxZ - r;
        this.velocity.z = 0;
      }
    }
  }

  /** 位置是否落在任一可行走矩形内（矩形按碰撞半径收缩） */
  _insideWalkable() {
    const r = this.radius;
    const p = this.mesh.position;
    return this.bounds.rects.some((b) =>
      p.x >= b.minX + r && p.x <= b.maxX - r &&
      p.z >= b.minZ + r && p.z <= b.maxZ - r
    );
  }

  /** 兜底：若当前位置已在边界之外（传送等），钳回最近的可行走矩形 */
  _clampToWalkable() {
    if (this._insideWalkable()) return;
    const r = this.radius;
    const p = this.mesh.position;
    let best = null;
    let bestD = Infinity;
    for (const b of this.bounds.rects) {
      const x = Math.min(b.maxX - r, Math.max(b.minX + r, p.x));
      const z = Math.min(b.maxZ - r, Math.max(b.minZ + r, p.z));
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, z };
      }
    }
    if (best) {
      p.x = best.x;
      p.z = best.z;
    }
  }

  _moveAxis(axis, delta) {
    if (delta === 0) return;
    this.mesh.position[axis] += delta;

    // 用当前位置构造玩家 AABB
    const half = this._half.set(this.radius, this.height / 2, this.radius);
    this._box.min.copy(this.mesh.position).sub(half);
    this._box.max.copy(this.mesh.position).add(half);

    for (const b of this.colliders) {
      if (this._box.intersectsBox(b)) {
        // 碰撞：回退
        if (axis === 'x') {
          if (delta > 0) this.mesh.position.x = b.min.x - this.radius - 0.001;
          else this.mesh.position.x = b.max.x + this.radius + 0.001;
        } else if (axis === 'z') {
          if (delta > 0) this.mesh.position.z = b.min.z - this.radius - 0.001;
          else this.mesh.position.z = b.max.z + this.radius + 0.001;
        }
        this.velocity[axis] = 0;
        this._box.min.copy(this.mesh.position).sub(half);
        this._box.max.copy(this.mesh.position).add(half);
      }
    }
  }

  _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}