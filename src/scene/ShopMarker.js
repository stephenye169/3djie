import * as THREE from 'three';
import { getShopById } from '../data/shops.js';
import { findAsset } from '../../shared/assets.js';

/**
 * 为店铺生成一个浮动的可点击图标（始终面向摄像机的 Sprite）
 * - 图标显示店铺 emoji，带圆形背景
 * - 位于店铺建筑顶部上方
 * - userData.shopId 与店铺绑定，可被 Raycaster 命中
 */
export function createShopMarker(shopMesh) {
  const shopId = shopMesh.userData.shopId;
  const shop = getShopById(shopId);
  const asset = findAsset(shopId);
  const emoji = shop?.emoji || asset?.emoji;
  if (!emoji) return null;

  const texture = _makeEmojiTexture(emoji);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false // 确保图标不被建筑遮挡
  });
  const sprite = new THREE.Sprite(material);

  // 计算图标位置：放在建筑包围盒顶部上方，不会被屋顶遮挡
  const box = new THREE.Box3().setFromObject(shopMesh);
  const center = box.getCenter(new THREE.Vector3());
  sprite.position.set(
    center.x,
    box.max.y + 1.6,
    center.z
  );

  const size = 3.2;
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 999;
  sprite.userData.shopId = shopId;
  sprite.userData.isShopMarker = true;
  sprite.name = `shop_marker_${shopId}`;

  return sprite;
}

function _makeEmojiTexture(emoji) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // 圆形背景（深色 + 发光边框）
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#22d3ee';
  ctx.stroke();
  // 外发光
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // emoji
  ctx.font = '68px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 68);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}
