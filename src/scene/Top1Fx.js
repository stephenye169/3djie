import * as THREE from 'three';

/**
 * 首富排面：脚下金色光圈 + 红毯（README §19 情绪放大器 ③）
 *
 * 纯几何体 + 半透明材质，挂到角色 mesh 上（跟随走动），不参与碰撞、不投影。
 * 返回的 Group 带 update(dt)：呼吸脉冲 + 金环自转，由主循环每帧调用。
 */
export function createTop1Aura({ footY = -0.9 } = {}) {
  const group = new THREE.Group();
  group.name = 'top1_aura';

  // 红毯：铺在角色脚下（朝向无关，前后同宽，避免随朝向重算）
  const carpetMat = new THREE.MeshBasicMaterial({
    color: 0x8c1a1a,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.4), carpetMat);
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.012;
  carpet.renderOrder = 2;
  group.add(carpet);

  // 外圈光晕
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffb01f,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.2, 1.62, 56), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.02;
  halo.renderOrder = 2;
  group.add(halo);

  // 金色主环
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd24a,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.16, 56), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.renderOrder = 3;
  group.add(ring);

  group.position.y = footY;
  group.userData.top1Aura = true;
  group.traverse((obj) => {
    obj.userData.top1Aura = true;
    if (obj.isMesh) obj.castShadow = false;
  });

  let t = 0;
  group.update = (dt) => {
    t += dt;
    const pulse = (Math.sin(t * 2.2) + 1) / 2;
    ringMat.opacity = 0.62 + pulse * 0.32;
    haloMat.opacity = 0.09 + pulse * 0.12;
    carpetMat.opacity = 0.4 + pulse * 0.18;
    ring.rotation.z += dt * 0.55;   // 平面内自转（rotation.x 已是 -90°）
    halo.rotation.z -= dt * 0.3;
  };

  return group;
}
