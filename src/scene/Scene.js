import * as THREE from 'three';

/**
 * 场景基础：renderer / scene / camera / 灯光 / 大气氛围 / 自适应
 *
 * 氛围方案（不依赖任何外部贴图 / HDR）：
 * - 程序化天空渐变作为背景，配合指数雾让远景自然淡出
 * - ACES 电影级色调映射，高光柔和不发白，暗部有层次
 * - 暖色主光（投影）+ 冷色天空光 + 反向补光 + 地面反弹光，消除"纯方块塑料感"
 */

const SKY_TOP = '#6f9ec4';
const SKY_MID = '#b7cfdd';
const SKY_HORIZON = '#e6ded0';
const FOG_COLOR = 0xdfe6e6;

/** 游戏内一天 = 6 分钟真实时间 */
export const DAY_LENGTH_S = 360;

/**
 * 昼夜关键帧（dayT ∈ [0,1) 循环）：
 * 白天（0–0.3）→ 黄昏（0.42）→ 夜晚（0.55–0.85）→ 黎明（0.95）→ 回白天
 */
const DAY_KEYS = [
  { t: 0.0,  skyTop: '#6f9ec4', skyMid: '#b7cfdd', skyHor: '#e6ded0', fog: 0xdfe6e6, sun: 1.7,  sunColor: 0xfff3e6, hemi: 1.65, fill: 0.5,  bounce: 0.25, fogD: 0.007 },
  { t: 0.30, skyTop: '#6f9ec4', skyMid: '#b7cfdd', skyHor: '#e6ded0', fog: 0xdfe6e6, sun: 1.6,  sunColor: 0xfff0dd, hemi: 1.55, fill: 0.45, bounce: 0.24, fogD: 0.007 },
  { t: 0.42, skyTop: '#5a6a9e', skyMid: '#c98a5a', skyHor: '#e8a06a', fog: 0xd9b38c, sun: 0.9,  sunColor: 0xffb27a, hemi: 0.9,  fill: 0.3,  bounce: 0.2,  fogD: 0.009 },
  { t: 0.55, skyTop: '#0d1226', skyMid: '#16203a', skyHor: '#243048', fog: 0x1a2436, sun: 0.18, sunColor: 0x9db4d6, hemi: 0.45, fill: 0.12, bounce: 0.08, fogD: 0.013 },
  { t: 0.85, skyTop: '#0d1226', skyMid: '#16203a', skyHor: '#243048', fog: 0x1a2436, sun: 0.18, sunColor: 0x9db4d6, hemi: 0.45, fill: 0.12, bounce: 0.08, fogD: 0.013 },
  { t: 0.95, skyTop: '#4a5c8e', skyMid: '#9a8aa0', skyHor: '#d9a08a', fog: 0xb8a8a8, sun: 1.0,  sunColor: 0xffc9a0, hemi: 1.1,  fill: 0.35, bounce: 0.18, fogD: 0.008 },
  { t: 1.0,  skyTop: '#6f9ec4', skyMid: '#b7cfdd', skyHor: '#e6ded0', fog: 0xdfe6e6, sun: 1.7,  sunColor: 0xfff3e6, hemi: 1.65, fill: 0.5,  bounce: 0.25, fogD: 0.007 },
];

const _cA = new THREE.Color();
const _cB = new THREE.Color();

/** 设备分档：移动端降像素比、关抗锯齿与阴影（低端机最贵的三项） */
export const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 0 && window.innerWidth < 900);

export function createScene(container) {
  const scene = new THREE.Scene();
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 16;
  skyCanvas.height = 256;
  scene.background = makeSkyTexture(skyCanvas);
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.007);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500
  );

  const renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
  renderer.shadowMap.enabled = !IS_MOBILE;
  if (renderer.shadowMap.enabled) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  container.appendChild(renderer.domElement);

  // 主光：柔和午后阳光，负责投影与方向感
  const sun = new THREE.DirectionalLight(0xfff3e6, 1.7);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); // 2048→1024：阴影质量差异肉眼几乎不可见，GPU 负载减半
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target); // 阴影相机跟随玩家时需要 target 也加入场景

  // 天空光：上方偏冷、地面偏暖，给暗面铺一层环境色，阴影不再死黑
  const hemi = new THREE.HemisphereLight(0xdcebf7, 0x8b8175, 1.65);
  scene.add(hemi);

  // 反向冷色补光：不投影，只提亮背光面
  const fill = new THREE.DirectionalLight(0xbcd6ee, 0.5);
  fill.position.set(-24, 18, -20);
  scene.add(fill);

  // 地面暖色反弹光：让檐下、台基有轻微暖调
  const bounce = new THREE.AmbientLight(0xfff0e0, 0.25);
  scene.add(bounce);

  // 自适应
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let lastSkyKey = '';
  /** 昼夜光照：按 dayT ∈ [0,1) 在关键帧之间插值（颜色未变化时跳过天空纹理重绘） */
  function applyDaylight(dayT) {
    const t = ((dayT % 1) + 1) % 1;
    let a = DAY_KEYS[0];
    let b = DAY_KEYS[DAY_KEYS.length - 1];
    for (let i = 0; i < DAY_KEYS.length - 1; i++) {
      if (t >= DAY_KEYS[i].t && t <= DAY_KEYS[i + 1].t) {
        a = DAY_KEYS[i];
        b = DAY_KEYS[i + 1];
        break;
      }
    }
    const span = b.t - a.t || 1;
    const k = Math.max(0, Math.min(1, (t - a.t) / span));

    sun.intensity = a.sun + (b.sun - a.sun) * k;
    sun.color.lerpColors(_cA.setHex(a.sunColor), _cB.setHex(b.sunColor), k);
    hemi.intensity = a.hemi + (b.hemi - a.hemi) * k;
    fill.intensity = a.fill + (b.fill - a.fill) * k;
    bounce.intensity = a.bounce + (b.bounce - a.bounce) * k;
    scene.fog.color.lerpColors(_cA.setHex(a.fog), _cB.setHex(b.fog), k);
    scene.fog.density = a.fogD + (b.fogD - a.fogD) * k;

    _cA.set(a.skyTop).lerp(_cB.set(b.skyTop), k);
    const top = `#${_cA.getHexString()}`;
    _cA.set(a.skyMid).lerp(_cB.set(b.skyMid), k);
    const mid = `#${_cA.getHexString()}`;
    _cA.set(a.skyHor).lerp(_cB.set(b.skyHor), k);
    const hor = `#${_cA.getHexString()}`;
    const skyKey = `${top}|${mid}|${hor}`;
    if (skyKey === lastSkyKey) return;
    lastSkyKey = skyKey;

    const ctx = skyCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, top);
    gradient.addColorStop(0.55, mid);
    gradient.addColorStop(0.82, hor);
    gradient.addColorStop(1, '#cfc6b6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 256);
    scene.background.needsUpdate = true;
  }

  applyDaylight(0); // 初始化为白天

  return { scene, camera, renderer, lighting: { sun, hemi, fill, bounce, applyDaylight } };
}

/** 程序化天空渐变（Canvas 生成，零外部资源） */
function makeSkyTexture(skyCanvas) {
  const ctx = skyCanvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(0.55, SKY_MID);
  gradient.addColorStop(0.82, SKY_HORIZON);
  gradient.addColorStop(1, '#cfc6b6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 256);

  const texture = new THREE.CanvasTexture(skyCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}