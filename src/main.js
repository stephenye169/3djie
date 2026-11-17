import * as THREE from 'three';
import { createScene, DAY_LENGTH_S } from './scene/Scene.js';
import { CrowdPanel } from './ui/CrowdPanel.js';
import { soundFx } from './utils/audio.js';

// 昼夜光照系统：bootstrap 里解构赋值，start/animate 跨函数共享（不走参数链，避免签名膨胀）
let sceneLighting = null;

import { WorldLoader } from './scene/WorldLoader.js';
import { Player } from './scene/Player.js';
import { ThirdPersonCamera } from './scene/ThirdPersonCamera.js';
import { ShopInteraction } from './scene/ShopInteraction.js';
import { ProximityInteraction } from './scene/ProximityInteraction.js';
import { computeEntrancesFromLayout, TriggerRing } from './scene/ShopEntrance.js';
import { AttackTheater } from './scene/AttackTheater.js';
import { MapView } from './scene/MapView.js';
import { InteriorManager } from './scene/InteriorManager.js';
import { InteriorInteraction } from './scene/InteriorInteraction.js';
import { InteractHint } from './ui/InteractHint.js';
import { DialoguePanel } from './ui/DialoguePanel.js';
import { AssetHud } from './ui/AssetHud.js';
import { Danmaku } from './ui/Danmaku.js';
import { AttackAlert } from './ui/AttackAlert.js';
import { DesktopNotify } from './ui/DesktopNotify.js';
import { MoneyBurst } from './ui/MoneyBurst.js';
import { Onboarding } from './ui/Onboarding.js';
import { Secretary } from './ui/Secretary.js';
import { Top1Crown } from './ui/Top1Crown.js';
import { PlayerMenu } from './ui/PlayerMenu.js';
import { createTop1Aura } from './scene/Top1Fx.js';
import { AssetVisuals } from './scene/AssetVisuals.js';
import { CoinRain } from './scene/CoinRain.js';
import { TauntNpcs } from './scene/TauntNpcs.js';
import { TauntPanel } from './ui/TauntPanel.js';
import { DividendCard } from './ui/DividendCard.js';
import { QuestCard } from './ui/QuestCard.js';
import { PrestigePanel } from './ui/PrestigePanel.js';
import { lootMoney } from './ui/LootFx.js';
import { gameStore } from './state/game.js';
import { formatMoney } from '../shared/assets.js';
import { getShopById } from './data/shops.js';
import { getShopNpc } from './data/npcs.js';
import { wallet } from './state/wallet.js';
import { showToast } from './ui/toast.js';
import { WalletPanel } from './ui/WalletPanel.js';
import { api, setToken, getToken, createChatClient } from './api/client.js';

// 同浏览器多开联调：URL 带 ?fresh 时清掉本标签的登录态，强制以新客户端重新选角色
// （浏览器复制标签页会连同 sessionStorage 一起复制，这时加 ?fresh 即可换一个玩家）
{
  const url = new URL(location.href);
  if (url.searchParams.has('fresh')) {
    setToken(null);
    sessionStorage.removeItem('qingguo_session_pwd');
    url.searchParams.delete('fresh');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}

// ---- 加载 UI 元素 ----
const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-bar');
const loadingPercent = document.getElementById('loading-percent');
const loadingStatus = document.getElementById('loading-status');
const retryBtn = document.getElementById('retry-btn');
const errorToast = document.getElementById('error-toast');
const crosshair = document.getElementById('crosshair');

function setProgress(pct, status) {
  loadingBar.style.width = pct + '%';
  loadingPercent.textContent = Math.round(pct) + '%';
  if (status) loadingStatus.textContent = status;
}

function showError(msg) {
  errorToast.textContent = msg;
  errorToast.classList.remove('hidden');
  setTimeout(() => errorToast.classList.add('hidden'), 5000);
}

function hideLoading() {
  loadingScreen.classList.add('hidden');
}

/** 昵称池：开局随机取一个，可点骰子换一个（巷弄意象 / 地标典故 / 江南雅致 / 常州小吃 / 现代活泼） */
const NICKNAMES = [
  // —— 巷弄意象 ——
  '青果阿青', '巷口小满', '白墙拾光', '黛瓦听雨', '石阶慢行', '灯笼半日',
  '乌篷一盏', '运河观澜', '老槐知秋', '纸伞南风', '木窗清欢', '砖雕微澜',
  '檐下小鹿', '烟雨阿杏', '桥头阿福', '水巷守夜', '青石晚风', '旧巷初晴',
  '南市小舟', '曲巷阿棠', '天井落雪', '正素一叶', '雪洞归人', '半园闲客',
  // —— 地标典故 ——
  '八桂闻香', '可园听蝉', '松健读月', '贞和访碑', '礼和观星', '城隍看戏',
  '半园煮茶', '天井晒书', '进士折桂', '荆川论剑', '元任听音', '鸿仪寻园',
  // —— 江南雅致 ——
  '半窗明月', '一庭花影', '竹影扫阶', '荷风送香', '檐雨成帘', '小园春深',
  '曲径通幽', '石桥听水', '画船听雨', '枕河人家', '临水照花', '柳岸晓风',
  // —— 常州风味 ——
  '桂花糖芋苗', '加蟹小笼包', '银丝面一碗', '麻糕配豆浆', '虾饼趁热吃',
  '藕粉圆子', '小笼汤包', '青团子', '大麻糕', '萝卜干炒饭',
  // —— 现代活泼 ——
  '巷里一只猫', '阿柴逛巷', '一颗青果', '慢慢逛巷', '今天不赶路',
  '巷口发呆', '走哪算哪', '只逛不买', '拍照的路人', '迷路小猫',
  '早八游客', '周末探店', '巷子收集者', '不认识的邻居'
];

const LAST_NICK_KEY = 'qingguo_last_nick';
const DATE_SUFFIX_RE = /\d{4}$/;

/** 当前日期后缀，如「1111」（11月11日） */
function currentDateSuffix() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 去掉昵称末尾的日期，还原成词条本身，用于判重 */
function stripDateSuffix(name) {
  return (name || '').replace(DATE_SUFFIX_RE, '');
}

/** 随机取一个昵称，且保证与上次（或上一次抽到）不同 */
function randomNickname(exclude) {
  const last = stripDateSuffix(exclude || localStorage.getItem(LAST_NICK_KEY));
  const pool = NICKNAMES.filter((n) => n !== last);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 角色选择：选完角色后注册/登录后端，再开始游戏 */
function showCharacterSelect(onPick) {
  const panel = document.getElementById('char-select');
  const input = document.getElementById('char-name-input');
  panel.classList.remove('hidden');

  const dateTag = currentDateSuffix();
  input.value = randomNickname() + dateTag;
  input.focus();
  input.select();

  document.getElementById('char-reroll').onclick = () => {
    input.value = randomNickname(stripDateSuffix(input.value)) + dateTag;
    input.focus();
    input.select();
  };

  let done = false;
  const pick = async (card) => {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey);
    panel.classList.add('hidden');

    const variant = card.dataset.variant;
    const nick = input.value.trim() || card.dataset.name;
    localStorage.setItem(LAST_NICK_KEY, stripDateSuffix(nick));

    try {
      // 注册到后端：username 用"昵称+时间戳"保证唯一，密码是当前会话随机串
      const sessionPwd = sessionStorage.getItem('qingguo_session_pwd') ||
        (sessionStorage.setItem('qingguo_session_pwd', Math.random().toString(36).slice(2, 14) + 'xY') || sessionStorage.getItem('qingguo_session_pwd'));
      const username = `${nick.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '')}_${Date.now().toString(36)}`;

      let reg;
      try {
        reg = await api.register(username, sessionPwd, nick, variant);
      } catch (err) {
        // 用户名冲突——换一个再试
        if (err.status === 409) {
          reg = await api.register(username + '_' + Math.random().toString(36).slice(2, 6), sessionPwd, nick, variant);
        } else {
          throw err;
        }
      }

      setToken(reg.token);
      showToast(`欢迎「${reg.user.nickname}」`);
      onPick({ variant, nickname: reg.user.nickname, id: reg.user.id });
    } catch (err) {
      showToast('注册失败：' + (err.message || '请稍后再试'));
      panel.classList.remove('hidden');
      done = false;
      document.addEventListener('keydown', onKey);
    }
  };
  const onKey = (e) => {
    if (e.key === 'Enter') pick(panel.querySelector('.char-card[data-variant="male"]'));
  };
  document.addEventListener('keydown', onKey);

  panel.querySelectorAll('.char-card').forEach((card) => {
    card.addEventListener('click', () => pick(card));
  });
}

// ---- 启动 ----
async function bootstrap() {
  const { scene, camera, renderer, lighting } = createScene(document.body);
  sceneLighting = lighting; // 供 start() 内的 animate 使用（lighting 不经过 start 参数链）
  camera.layers.enable(1);
  window.__renderInfo = renderer.info; // 性能调试：控制台读 __renderInfo.render.calls / triangles

  // 阴影按需更新：全场景静态为主，500ms 刷新一次 shadow map（角色影子略有步进感，肉眼几乎不可察）
  renderer.shadowMap.autoUpdate = false;
  setInterval(() => { renderer.shadowMap.needsUpdate = true; }, 500);

  const loader = new WorldLoader();
  let world;
  try {
    world = await loader.load(scene, setProgress, showError);
  } catch (err) {
    console.error(err);
    loadingStatus.textContent = '加载失败：' + err.message;
    retryBtn.classList.remove('hidden');
    retryBtn.onclick = () => window.location.reload();
    return;
  }

  hideLoading();

  // 尝试自动登录（已有 token → /api/me 校验）
  const token = getToken();
  if (token) {
    try {
      const me = await api.me();
      await wallet.refresh(api);
      start(world, me, scene, camera, renderer);
      return;
    } catch (err) {
      // token 失效：清掉，走角色选择
      setToken(null);
      console.warn('[auth] token expired, showing char select');
    }
  }

  // 没 token 或 token 失效 → 角色选择 → 注册 → start
  showCharacterSelect((user) => {
    wallet.refresh(api).finally(() => {
      start(world, user, scene, camera, renderer);
    });
  });
}

/** 选好角色后的正式初始化 */
function start(world, user, scene, camera, renderer) {
  crosshair.classList.add('show');

  // 玩家（从后端 user 对象拿 variant 和 nickname）
  const player = new Player(world.colliders, world.groundY, world.bounds, {
    variant: user.variant, name: user.nickname
  });
  scene.add(player.mesh);

  // 第三人称摄像机
  const tpCamera = new ThirdPersonCamera(camera, renderer.domElement);

  // ---- 界面元素 ----
  const shopListEl = document.getElementById('shop-list');
  const exploreCountEl = document.getElementById('explore-count');
  const exploreTotalEl = document.getElementById('explore-total');
  const playerStateEl = document.getElementById('player-state');
  const walletBalanceEl = document.getElementById('wallet-balance');
  const visited = new Set();
  const shopItemById = new Map();

  // ---- 游戏数值：资产 HUD 与顶部余额都以服务端状态为准 ----
  new AssetHud();
  gameStore.subscribe((view) => {
    if (view) walletBalanceEl.textContent = `¥${formatMoney(view.balance)}`;
  });
  // ---- 情绪放大器（README §19）：护盘钞票雨 + 开局逆袭引导 ----
  const moneyBurst = new MoneyBurst();
  const onboarding = new Onboarding({ moneyBurst });

  // ---- 秘书 HUD（README §19 ④）：订阅结果事件，冒出来捧场（非紧急台词 5 分钟限流）----
  const secretary = new Secretary({ userId: user.id });
  gameStore.onEvent((kind, payload) => {
    secretary.say(kind, payload);
    // 收购成交：金币落袋音效 + 首富榜即时刷新（身价格局变了，不等 30s 轮询）
    if (kind === 'acquire') {
      soundFx.coin();
      refreshLeaderboard();
    }
    // 资产卡「众筹扩建」按钮：打开众筹面板并预选该店铺
    if (kind === 'crowd-open' && payload?.shopId) {
      crowdPanel.open(payload.shopId);
    }
  });

  // 街区众筹扩建面板
  const crowdPanel = new CrowdPanel();

  gameStore.load().then(() => {
    const off = gameStore.offline;
    if (off.earnings > 0) {
      const minutes = Math.max(1, Math.round(off.seconds / 60));
      showToast(`离线 ${minutes} 分钟，收租 ¥${formatMoney(off.earnings)}`);
    }
    // 未领取过「龙王归来体验卡」的新账号 → 开场三幕剧情（已领取则只剩右上角待领取胶囊）
    onboarding.maybeStart();
    // 首富排面：拿到 state 后才知道当前首富是谁
    applyTop1Visuals();
  });

  // 个人中心
  const walletPanel = new WalletPanel();
  document.getElementById('wallet-chip').addEventListener('click', () => walletPanel.open());

  // ---- 首富榜：顶栏轮播（现金 + 店铺身价，30s 刷新一次）----
  const leaderboardChip = document.getElementById('leaderboard-chip');
  const leaderboardText = document.getElementById('leaderboard-text');
  const LEADERBOARD_ICONS = ['🥇', '🥈', '🥉'];
  let leaderboardEntries = [];
  let leaderboardIndex = 0;

  function renderLeaderboard() {
    if (!leaderboardChip || !leaderboardText) return; // DOM 缺失时静默跳过，不炸主循环
    if (!leaderboardEntries.length) return;
    const entry = leaderboardEntries[leaderboardIndex % leaderboardEntries.length];
    const icon = LEADERBOARD_ICONS[entry.rank - 1] || `#${entry.rank}`;
    leaderboardText.textContent = `${icon} ${entry.nickname} · ¥${formatMoney(entry.totalValue)}`;
    leaderboardChip.title = `全服首富榜 · ${entry.nickname}（${entry.title}）现金 ¥${formatMoney(entry.balance)} + 店铺身价 ¥${formatMoney(entry.assetsValue)}`;
  }

  async function refreshLeaderboard() {
    if (!leaderboardChip || !leaderboardText) return;
    try {
      const data = await api.leaderboard();
      leaderboardEntries = data?.entries || [];
      leaderboardIndex = 0;
      leaderboardChip.classList.toggle('hidden', leaderboardEntries.length === 0);
      renderLeaderboard();
    } catch { /* 榜单加载失败不影响游戏 */ }
  }

  refreshLeaderboard();
  setInterval(refreshLeaderboard, 30_000);
  setInterval(() => {
    if (!leaderboardText) return;
    if (leaderboardEntries.length <= 1) return;
    leaderboardIndex = (leaderboardIndex + 1) % leaderboardEntries.length;
    leaderboardText.classList.add('swap');
    setTimeout(() => {
      renderLeaderboard();
      leaderboardText.classList.remove('swap');
    }, 180);
  }, 4_000);

  function markVisited(shop) {
    if (!shop) return;
    visited.add(shop.id);
    exploreCountEl.textContent = visited.size;
    shopItemById.get(shop.id)?.classList.add('visited');
  }

  // ---- 场景状态：街道 / 店内 ----
  const interiorManager = new InteriorManager(scene);
  const fadeEl = document.getElementById('scene-fade');
  const locationEl = document.getElementById('panel-location');
  const exitShopBtn = document.getElementById('exit-shop');
  const dialogue = new DialoguePanel();
  let mode = 'street';
  let transitioning = false;
  let streetState = null;
  let currentRoom = null;

  // 店内点击：柜台/货架 → 商品卡片；店员 → 对话
  const interiorInteraction = new InteriorInteraction(camera, renderer.domElement, {
    onShop: (shopId) => {
      const shop = getShopById(shopId);
      if (shop) interaction.open(shop);
    },
    onNpc: (shopId) => openNpc(shopId)
  });

  /** 与店员交谈 */
  function openNpc(shopId) {
    if (mode !== 'interior' || transitioning) return;
    interiorInteraction.setEnabled(false);
    dialogue.open(getShopNpc(shopId), () => {
      if (mode === 'interior' && !transitioning) interiorInteraction.setEnabled(true);
    });
  }

  // 店铺交互（点击）
  const interaction = new ShopInteraction(
    camera,
    renderer.domElement,
    world.shopMeshes,
    (shop) => { crosshair.classList.remove('show'); markVisited(shop); },
    () => { crosshair.classList.add('show'); }
  );

  // ---- 街头经济：金币雨 + 碰瓷 NPC + 家族分红 ----
  new DividendCard();
  new QuestCard();
  const tauntPanel = new TauntPanel();
  const prestigePanel = new PrestigePanel();

  // 走路米数累加（给 quest walk 任务用，每 10s 上报一次，距离 10m 以下不上报）
  const walkState = { last: null, meters: 0, nextReportAt: 0 };

  const coinRain = new CoinRain(scene, player, world.groundY, world.bounds, camera, renderer.domElement, {
    onCollect: async (type) => {
      const res = await gameStore.collect(type);
      if (!res.ok) {
        if (res.status !== 429) showToast(res.message || '拾取失败');
        return false;
      }
      lootMoney(res.reward, {
        crit: res.crit,
        label: type === 'box' ? '财阀金币箱' : (res.crit ? '暴击' : '金币到账'),
      });
      // 暴击才值得秘书报一句（普通金币太频繁）
      if (res.crit) gameStore.emitEvent('crit', { reward: res.reward });
      return true;
    },
  });

  const tauntNpcs = new TauntNpcs(scene, world.groundY, {
    onTrigger: (cfg) => {
      if (mode !== 'street' || transitioning) return;
      tauntPanel.open(cfg);
      tauntNpcs.hide(cfg.id); // 碰到即消失，不再杵在原地
    },
  });

  // ---- 左侧资产清单：18 个可收购资产，随游戏状态刷新 ----
  const shopCountEl = document.getElementById('shop-count');
  const assetVisuals = new AssetVisuals(scene, world.shopMeshes, world.groundY);
  let listSignature = '';
  gameStore.subscribe((view) => {
    if (!view) return;
    exploreTotalEl.textContent = view.totalAssets;
    if (shopCountEl) shopCountEl.textContent = `${view.assets.length} 家`;

    // 3D 归属表现：建筑拔高 + 店主霓虹灯牌
    assetVisuals.apply(view.assets, view.id);

    const signature = view.assets
      .map((a) => `${a.id}:${a.owned ? a.level : 0}`)
      .join('|');
    if (signature === listSignature) return;
    listSignature = signature;

    shopListEl.innerHTML = '';
    shopItemById.clear();
    view.assets.forEach((asset) => {
      const item = document.createElement('button');
      item.className = 'shop-list-item';
      if (asset.owned) item.classList.add('owned');
      item.innerHTML = `
        <span class="shop-list-emoji">${asset.emoji || '🏪'}</span>
        <span class="shop-list-info">
          <span class="shop-list-name">${asset.name}</span>
          <span class="shop-list-cat">${asset.owned ? `已持有 · Lv.${asset.level}` : `收购价 ${formatMoney(asset.price)}`}</span>
        </span>
        <span class="shop-list-dot"></span>
      `;
      item.addEventListener('click', () => interaction.open(asset.id));
      shopListEl.appendChild(item);
      shopItemById.set(asset.id, item);
    });
  });

  /** 黑屏过渡：淡出 → 执行切换 → 淡入（切换回调异常不阻塞 Promise，避免 transitioning 卡死） */
  function fadeSwap(mid) {
    return new Promise((resolve) => {
      fadeEl.classList.add('active');
      setTimeout(() => {
        try {
          mid();
        } catch (err) {
          console.error('[fadeSwap] 场景切换回调异常:', err);
        }
        setTimeout(() => {
          fadeEl.classList.remove('active');
          resolve();
        }, 90);
      }, 340);
    });
  }

  /** 进入店铺内部 */
  async function enterShop(shop) {
    if (mode !== 'street' || transitioning) return;
    transitioning = true;
    interaction.close();
    markVisited(shop);
    crosshair.classList.add('show');

    try {
      await fadeSwap(() => {
        streetState = {
          x: player.position.x,
          z: player.position.z,
          rotationY: player.mesh.rotation.y,
          yaw: tpCamera.yaw,
          pitch: tpCamera.pitch,
          colliders: player.colliders,
          bounds: player.bounds,
          groundY: player.groundY
        };

        const room = interiorManager.enter(shop.id, shop);
        currentRoom = room;

        player.setColliders(room.colliders);
        player.setBounds(room.bounds);
        player.setGroundY(room.groundY);
        player.teleport(room.spawn.x, room.spawn.z);
        player.mesh.rotation.y = Math.PI; // 面向店内（-z 方向）
        tpCamera.setInteriorMode(true); // 室内改用更近更低的镜头
        tpCamera.snap(player.position);

        interaction.enabled = false;
        interiorInteraction.setTargets(room.interactives);
        interiorInteraction.setEnabled(true);
        interactHint.hide();
        exitShopBtn.classList.remove('hidden');
        mode = 'interior';
        locationEl.textContent = `青果巷 · ${shop.name}（店内）`;
      });
    } finally {
      // 过渡中抛异常也不会把 transitioning 永久锁死
      transitioning = false;
    }

    showToast(`已进入「${shop.name}」· 点击店员或按 E 交谈`);
  }

  /** 返回街道 */
  async function exitShop() {
    if (mode !== 'interior' || transitioning) return;
    transitioning = true;

    try {
      await fadeSwap(() => {
        interiorManager.leave();
        currentRoom = null;

        if (streetState) {
          player.setColliders(streetState.colliders);
          player.setBounds(streetState.bounds);
          player.setGroundY(streetState.groundY);
          player.teleport(streetState.x, streetState.z);
          player.mesh.rotation.y = streetState.rotationY;
          tpCamera.setInteriorMode(false);
          tpCamera.yaw = streetState.yaw;
          tpCamera.pitch = streetState.pitch;
          tpCamera.snap(player.position);
        }

        interaction.enabled = true;
        interiorInteraction.setEnabled(false);
        interiorInteraction.setTargets([]);
        dialogue.close();
        exitShopBtn.classList.add('hidden');
        mode = 'street';
        locationEl.textContent = '青果巷 · 历史街区';
      });
    } finally {
      transitioning = false;
    }

    showToast('已返回青果巷');
  }

  // 离开店铺：按钮或 Esc（对话中 Esc 优先结束对话）
  exitShopBtn.addEventListener('click', () => exitShop());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 聊天面板优先关闭
    if (chatOpen) {
      closeChat();
      return;
    }
    // 资本轮回面板
    if (prestigePanel.isOpen()) {
      closePrestige();
      return;
    }
    // 退出确认层优先关闭
    if (tauntPanel.isOpen()) {
      tauntPanel.close();
      return;
    }
    if (!document.getElementById('exit-modal').classList.contains('hidden')) {
      closeExitModal();
      return;
    }
    if (mapView.active) {
      exitMapToPlayer();
      return;
    }
    if (dialogue.isOpen()) {
      dialogue.close();
      return;
    }
    if (interaction.isOpen()) {
      interaction.close();
      return;
    }
    if (mode === 'interior' && !transitioning) {
      exitShop();
    }
  });

  // 店内按 E 与店员交谈
  document.addEventListener('keydown', (e) => {
    const isE = e.code === 'KeyE' || (e.key || '').toLowerCase() === 'e';
    if (!isE) return;
    if (chatOpen) return;
    if (mode !== 'interior' || transitioning) return;
    if (interaction.isOpen() || dialogue.isOpen() || walletPanel.isOpen()) return;
    if (interiorManager.activeId) openNpc(interiorManager.activeId);
  });

  // 左侧街区资产列表由游戏状态驱动（见上方 gameStore.subscribe）

  // 顶部导航（演示占位）
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => showToast(`「${btn.textContent.trim()}」功能开发中`));
  });

  // 靠近店铺交互（E 键）
  const interactHint = new InteractHint();

  // 门口触发点 + 地面发光圆环（走进圈内停下后自动弹出窗口）
  // entrances 用 layout.js 数据版计算：建筑渐进加载时也能立刻得到全部触发点
  const entrances = computeEntrancesFromLayout(world.groundY);

  // 踢馆 3D 演出：防守方视角攻击者模型跑位挑衅 + 攻击方甩黑卡飞牌
  const attackTheater = new AttackTheater(scene, entrances);
  const rings = entrances.map((e) => new TriggerRing(scene, e));

  // ---- 地图模式（M 键）：斜俯视总览，点击店名飞过去 ----
  const mapView = new MapView(camera, scene, renderer.domElement);
  // 地图标注需要全部建筑包围盒：渐进加载完成后（几何合并收尾）重建；非渐进模式立即建
  if (world.progressive) {
    world.progressive.done.then(() => {
      mapView.setData(world.shopMeshes, entrances);
    });
  } else {
    mapView.setData(world.shopMeshes, entrances);
  }

  // ---- LOD 距离分片（README §20 性能项）：相机 30m 内显示细构件，更远只留体块 ----
  const LOD_DETAIL_M = 30;
  const _lodVec = new THREE.Vector3();
  let lodTimer = setInterval(() => {
    const camPos = camera.position;
    for (const mesh of world.lodMeshes) {
      const center = mesh.userData?.lodCenter || mesh.getWorldPosition(_lodVec);
      mesh.visible = center.distanceTo(camPos) <= LOD_DETAIL_M;
    }
  }, 250);

  function enterMap() {
    if (mode !== 'street' || transitioning || mapView.active) return;
    if (dialogue.isOpen() || walletPanel.isOpen() || prestigePanel.isOpen()) return;
    if (interaction.isOpen()) interaction.close();
    interaction.enabled = false;
    tpCamera.enabled = false;
    interactHint.hide();
    crosshair.classList.remove('show');
    mapView.enter(player.position);
    locationEl.textContent = '青果巷 · 地图总览';
    showToast('地图模式：拖拽平移 · 滚轮缩放 · 点击店名飞过去 · M/Esc 返回');
  }

  function restoreStreetCamera(snapTarget) {
    interaction.enabled = true;
    tpCamera.enabled = true;
    crosshair.classList.add('show');
    locationEl.textContent = '青果巷 · 历史街区';
    tpCamera.snap(snapTarget);
  }

  function exitMapToPlayer() {
    if (!mapView.active || mapView.anim) return;
    mapView.exitTo(tpCamera.pose(player.position), () => {
      restoreStreetCamera(player.position);
    });
  }

  mapView.onPick = (point) => {
    // 导航虚线：从玩家当前位置到目标门口（飞行航线可视化）
    mapView.showRoute(player.mesh.position.x, player.mesh.position.z, point.landX, point.landZ);
    mapView.flyTo(point, (p) => {
      player.teleport(p.landX, p.landZ);
      player.mesh.rotation.y = Math.PI; // 面向店铺
      tpCamera.yaw = 0;
      tpCamera.pitch = 0.16;
      restoreStreetCamera(player.position);
      showToast(`已到达「${p.shop.name}」`);
    });
  };

  // M 键进入/退出地图模式
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM') return;
    if (chatOpen) return;
    if (mapView.active) exitMapToPlayer();
    else enterMap();
  });

  const proximity = new ProximityInteraction(
    player,
    world.shopMeshes,
    interactHint,
    (shop) => {
      if (mode === 'street') interaction.open(shop);
    },
    entrances,
    5,
    (shop) => {
      // 触发圈内按 E：已收购才能进店，未收购先弹收购面板
      if (mode !== 'street') return;
      const asset = gameStore.asset(shop.id);
      if (asset && !asset.owned) {
        interaction.open(shop);
        return;
      }
      enterShop(shop);
    }
  );

  // ---- 系统公告（顶栏公告条，多条 8 秒轮播 + 进度指示） ----
  const noticeBar = document.getElementById('notice-bar');
  const noticeText = document.getElementById('notice-text');
  const noticeIndexEl = document.getElementById('notice-index');
  api.announcements().then((list) => {
    if (!list || list.length === 0) return;
    let noticeIndex = 0;
    const renderNotice = () => {
      const a = list[noticeIndex % list.length];
      noticeText.textContent = `【${a.title}】${a.content}`;
      noticeBar.classList.remove('hidden');
      if (noticeIndexEl) {
        noticeIndexEl.textContent = list.length > 1 ? `${(noticeIndex % list.length) + 1}/${list.length}` : '';
        noticeIndexEl.classList.toggle('hidden', list.length <= 1);
      }
    };
    renderNotice();
    if (list.length > 1) {
      setInterval(() => {
        noticeIndex = (noticeIndex + 1) % list.length;
        noticeText.classList.add('swap');
        setTimeout(() => {
          renderNotice();
          noticeText.classList.remove('swap');
        }, 180);
      }, 8000);
    }
  }).catch(() => { /* 公告拉不到不影响游戏 */ });
  document.getElementById('notice-close')?.addEventListener('click', () => {
    noticeBar.classList.add('hidden');
  });

  // ---- 私聊（WebSocket） ----
  const chat = createChatClient();
  const attackAlert = new AttackAlert({
    onDefended: ({ shopName, cost }) => {
      moneyBurst.burst({
        count: 110,
        caption: `护盘成功 · ¥${formatMoney(cost)} 砸下去，「${shopName}」保住了`,
      });
      // 紧急台词：不受 5 分钟限流
      gameStore.emitEvent('defend', { shopName, cost });
    },
  });
  attackAlert.bind(chat); // 在线议价：还价 WS 收发与 counter_pending 事件订阅
  // 后台护盘提醒：页面在后台时用系统通知兜底（Web Push 离线唤醒仍未实现）
  const desktopNotify = new DesktopNotify(
    document.getElementById('notify-chip'),
    document.getElementById('notify-label')
  );
  let onlinePlayers = [];
  let blockedIds = new Set();
  const convo = new Map();     // peerId -> [{from:{id,nickname}, text, ts, system?}]
  const peerNames = new Map(); // peerId -> nickname（离线后仍可显示）
  let currentPeer = null;
  let chatOpen = false;
  let dndEnabled = false;

  const chatBox = document.getElementById('chat-panel');
  const chatInput = document.getElementById('chat-input');
  const chatList = document.getElementById('chat-messages');
  const onlineList = document.getElementById('chat-online');
  const peerNameEl = document.getElementById('chat-peer-name');
  const onlineCountEl = document.getElementById('online-count');
  const dndButton = document.createElement('button');
  dndButton.id = 'chat-dnd';
  dndButton.className = 'chat-dnd';
  dndButton.type = 'button';
  dndButton.textContent = '不想说话';
  dndButton.title = '开启后屏蔽所有私聊';
  dndButton.setAttribute('aria-pressed', 'false');
  chatBox.querySelector('.chat-shortcut').before(dndButton);

  function updateOnlineCount(n) {
    if (onlineCountEl) onlineCountEl.textContent = String(n);
  }

  // ---- 私聊未读红点：面板关闭期间收到 dm 累加，Tab 聊天控件上显示 ----
  const unreadBadgeEl = document.getElementById('chat-unread');
  const unreadByPeer = new Map();

  function renderUnread() {
    if (!unreadBadgeEl) return;
    const total = [...unreadByPeer.values()].reduce((s, n) => s + n, 0);
    unreadBadgeEl.textContent = total > 99 ? '99+' : String(total);
    unreadBadgeEl.classList.toggle('hidden', total === 0);
  }

  function addUnread(peerId) {
    unreadByPeer.set(peerId, (unreadByPeer.get(peerId) || 0) + 1);
    renderUnread();
  }

  function clearUnread() {
    unreadByPeer.clear();
    renderUnread();
  }

  // ---- 多人房间分流（README 11.5）：顶栏「🏠 N 号房 · M/30」徽标 + 点击弹房间列表 ----
  const roomChip = document.getElementById('room-chip');
  const roomIdEl = document.getElementById('room-id');
  const roomCountEl = document.getElementById('room-count');
  const roomPop = document.getElementById('room-pop');
  const roomPopList = document.getElementById('room-pop-list');
  const roomPopTotal = document.getElementById('room-pop-total');
  const ROOM_ID_MAX = 10;
  let currentRoomNo = null;
  let roomPopOpen = false;

  function renderRoom(roomId, count) {
    roomChip?.classList.remove('hidden');
    if (roomIdEl) roomIdEl.textContent = String(roomId);
    if (roomCountEl) roomCountEl.textContent = String(count ?? 0);
  }

  function hideRoom() {
    roomChip?.classList.add('hidden');
    roomPopOpen = false;
    roomPop?.classList.add('hidden');
  }

  /** 拉取房间状态：1–10 号房全列（接口只返回有人的房间，空房补 0 人） */
  async function fetchRoomStats() {
    try {
      const res = await fetch('/api/chat/rooms');
      const data = await res.json();
      const byId = new Map((data?.rooms || []).map((r) => [r.id, r]));
      const capacity = data?.capacity || 30;
      const list = [];
      for (let id = 1; id <= ROOM_ID_MAX; id++) {
        list.push({ id, count: byId.get(id)?.count ?? 0, capacity });
      }
      return { list, total: list.reduce((s, r) => s + r.count, 0) };
    } catch {
      return { list: [], total: 0 };
    }
  }

  /** 渲染房间选择弹层：当前房标记、满房禁用，点行 reconnectTo */
  function renderRoomPop(list) {
    if (!roomPopList) return;
    roomPopList.innerHTML = '';
    for (const r of list) {
      const full = r.count >= r.capacity;
      const mine = r.id === currentRoomNo;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `room-pop-row${mine ? ' mine' : ''}${full ? ' full' : ''}`;
      row.disabled = full || mine;
      row.innerHTML = `
        <span class="room-pop-name">${r.id} 号房${mine ? ' · 当前' : ''}</span>
        <span class="room-pop-bar"><i style="width:${Math.min(100, Math.round((r.count / r.capacity) * 100))}%"></i></span>
        <span class="room-pop-count">${r.count}/${r.capacity}${full ? ' 满' : ''}</span>
      `;
      if (!mine && !full) {
        row.addEventListener('click', () => {
          roomPopOpen = false;
          roomPop?.classList.add('hidden');
          showToast(`正在切换到 ${r.id} 号房…`);
          chat.reconnectTo(r.id);
        });
      }
      roomPopList.appendChild(row);
    }
  }

  async function toggleRoomPop() {
    if (!roomPop) return;
    roomPopOpen = !roomPopOpen;
    if (!roomPopOpen) { roomPop.classList.add('hidden'); return; }
    const { list, total } = await fetchRoomStats();
    if (roomPopTotal) roomPopTotal.textContent = total ? `全服 ${total} 人在线` : '';
    renderRoomPop(list);
    roomPop.classList.remove('hidden');
  }

  roomChip?.addEventListener('click', toggleRoomPop);
  // 点击弹层外部关闭
  document.addEventListener('click', (e) => {
    if (!roomPopOpen) return;
    if (roomChip?.contains(e.target)) return;
    roomPopOpen = false;
    roomPop?.classList.add('hidden');
  });

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function applyDnd(enabled) {
    dndEnabled = !!enabled;
    dndButton.textContent = dndEnabled ? '恢复聊天' : '不想说话';
    dndButton.classList.toggle('active', dndEnabled);
    dndButton.setAttribute('aria-pressed', String(dndEnabled));

    const blocked = currentPeer && blockedIds.has(currentPeer);
    const name = peerNames.get(currentPeer) || '玩家';
    chatInput.disabled = dndEnabled;
    chatInput.placeholder = dndEnabled
      ? '不想说话模式已开启，所有聊天已屏蔽'
      : blocked
        ? '已禁止对方聊天，解除后可继续'
        : currentPeer
          ? `发给 ${name}…（Enter 发送）`
          : '点击身边玩家发起私聊…（Enter 发送，Shift+Enter 换行）';
    if (dndEnabled) {
      chatInput.value = '';
      chatInput.blur();
    }
  }

  dndButton.addEventListener('click', () => {
    const next = !dndEnabled;
    if (!chat.setDnd(next)) {
      showToast('聊天连接未就绪，请稍后再试');
      return;
    }
    applyDnd(next);
    sessionStorage.setItem('chat-dnd', next ? '1' : '0');
    showToast(next ? '已开启不想说话，所有聊天已屏蔽' : '已恢复聊天');
  });

  let lastOnlineSig = '';
  function renderOnline() {
    const others = onlinePlayers.filter((p) => p.id !== user.id);
    others.forEach((p) => peerNames.set(p.id, p.nickname));
    // 玩家列表每秒推送，内容没变就不重绘，避免闪烁/点击被打断
    const sig = others.map((p) => `${p.id}:${p.nickname}`).join('|')
      + '#' + [...blockedIds].sort().join(',') + '#' + (currentPeer || '');
    if (sig === lastOnlineSig) return;
    lastOnlineSig = sig;

    /** 单个玩家行（点击发起会话，不限距离与场景——店内也能开新会话） */
    const rowHtml = (p, active) => {
      const online = onlinePlayers.some((q) => q.id === p.id);
      const blocked = blockedIds.has(p.id);
      const nickname = peerNames.get(p.id) || p.nickname;
      return `<div class="online-item${active ? ' active' : ''}${blocked ? ' blocked' : ''}" data-peer="${p.id}" data-name="${escapeHtml(nickname)}">
        <span class="online-dot${online ? '' : ' offline'}"></span>
        <span class="online-name">${escapeHtml(nickname)}${online ? '' : '（已离开）'}${blocked ? '（已禁止聊天）' : ''}</span>
        <button class="online-profile" data-profile="${p.id}" data-nick="${escapeHtml(nickname)}" title="查看资料">👤</button>
        <button class="online-block" data-block="${p.id}">${blocked ? '解除禁止' : '禁止聊天'}</button>
      </div>`;
    };

    if (!currentPeer) {
      if (!others.length) {
        onlineList.innerHTML = '<div class="online-empty">街上暂时没有其他玩家</div>';
        return;
      }
      // 无当前会话：列出全部其他在线玩家，点击即可发起私聊（无需走近）
      onlineList.innerHTML = others.map((p) => rowHtml(p, false)).join('');
      return;
    }

    const name = peerNames.get(currentPeer) || '玩家';
    const restRows = others.filter((p) => p.id !== currentPeer).map((p) => rowHtml(p, false)).join('');
    onlineList.innerHTML = rowHtml({ id: currentPeer }, true)
      + (restRows || '<div class="online-empty">街上暂时没有其他玩家</div>');
  }

  /** 单条消息行模板（全量渲染与增量追加共用；广场消息昵称可点开资料卡） */
  function buildMsgRow(m, isGlobal = false) {
    if (m.system) return `<div class="chat-msg chat-system">${escapeHtml(m.text)}</div>`;
    const mine = !isGlobal && m.from?.id === user.id;
    const time = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const fromHtml = isGlobal
      ? `<span class="chat-from chat-from-clickable" data-profile="${m.from?.id || ''}" data-nick="${escapeHtml(m.from?.nickname || '')}">${escapeHtml(m.from?.nickname || '')}:</span>`
      : `<span class="chat-from">${escapeHtml(m.from?.nickname || '')}:</span>`;
    const textHtml = `<span class="chat-text${mine ? '' : ''}">${escapeHtml(m.text)}</span>`;
    return `<div class="chat-msg ${mine ? 'chat-mine' : 'chat-peer'}">
      <span class="chat-time">${time}</span>
      ${fromHtml}
      ${textHtml}
    </div>`;
  }

  // ---- 聊天双 tab：广场（全服）/ 私聊 ----
  let chatTab = 'global'; // 'global' | 'dm'
  let globalMessages = []; // 服务端 global_history 下发 + global_msg 增量

  function setChatTab(tab) {
    chatTab = tab;
    document.getElementById('chat-tab-global')?.classList.toggle('active', tab === 'global');
    document.getElementById('chat-tab-dm')?.classList.toggle('active', tab === 'dm');
    renderChatCurrent();
    chatInput.placeholder = tab === 'global'
      ? '对全服发言…（Enter 发送）'
      : (currentPeer ? `发给 ${peerNames.get(currentPeer) || '对方'}…（Enter 发送）` : '点击在线列表选择私聊对象，或切回广场聊天');
  }

  /** 按 tab 渲染对应消息区（全量） */
  function renderChatCurrent() {
    if (chatTab === 'global') {
      const rows = globalMessages.map((m) => buildMsgRow(m, true));
      chatList.innerHTML = rows.join('') || '<div class="chat-empty">广场还很安静，说点什么吧</div>';
      chatList.scrollTop = chatList.scrollHeight;
      return;
    }
    renderMessages(); // 私聊视图
  }

  /** 增量追加（广场/私聊共用）：贴底跟随，翻历史不打断 */
  function appendChatRow(html) {
    const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    chatList.insertAdjacentHTML('beforeend', html);
    if (atBottom) chatList.scrollTop = chatList.scrollHeight;
  }

  /** 全量渲染：切换会话 / 拉取历史 / 拉黑状态变化时调用（滚到底） */
  function renderMessages() {
    if (!currentPeer) {
      chatList.innerHTML = '<div class="chat-empty">走近其他玩家，点击对方开始私聊</div>';
      return;
    }
    const list = convo.get(currentPeer) || [];
    const blocked = blockedIds.has(currentPeer);
    const rows = list.map((m) => buildMsgRow(m));
    if (blocked) rows.push('<div class="chat-msg chat-system">你已禁止对方聊天，解除后才能继续</div>');
    chatList.innerHTML = rows.join('') || '<div class="chat-empty">还没有消息，打个招呼吧</div>';
    chatList.scrollTop = chatList.scrollHeight;
  }

  /**
   * 增量追加一条消息（不重绘全量）：
   * - 用户贴在底部附近（40px 内）→ 自动跟随滚动到最新
   * - 用户正在上方翻历史 → 视图不动，不打断阅读
   */
  function appendChatMessage(peerId, msg) {
    if (peerId !== currentPeer) return;
    const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    chatList.insertAdjacentHTML('beforeend', buildMsgRow(msg));
    if (atBottom) chatList.scrollTop = chatList.scrollHeight;
  }

  /** 只负责落库存（渲染由调用方按场景选择增量或全量） */
  function pushMessage(peerId, msg) {
    if (!convo.has(peerId)) convo.set(peerId, []);
    const list = convo.get(peerId);
    list.push(msg);
    while (list.length > 200) list.shift();
  }

  /** 玩家资料卡（GDD §5.3）：只读展示昵称/称号/身价/店铺列表，不含现金余额 */
  async function openProfile(userId, fallbackNick = '') {
    const panel = document.getElementById('profile-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    document.getElementById('profile-nick').textContent = fallbackNick || '加载中…';
    document.getElementById('profile-shops').innerHTML = '<div class="crowd-empty">加载中…</div>';

    const res = await api.playerProfile(userId).catch(() => null);
    if (!res || res.error) {
      panel.classList.add('hidden');
      showToast(res?.error || '资料加载失败');
      return;
    }

    document.getElementById('profile-avatar').textContent = res.user.variant === 'female' ? '👩‍💼' : '🕴';
    document.getElementById('profile-nick').textContent = res.user.nickname;
    document.getElementById('profile-title').textContent = res.user.title;
    document.getElementById('profile-value').textContent = formatMoney(res.totalShopValue);
    document.getElementById('profile-earned').textContent = formatMoney(res.totalEarned);
    document.getElementById('profile-income').textContent = `${formatMoney(res.incomePerSec)} / 秒`;
    document.getElementById('profile-rebirth').textContent = res.user.rebirthCount > 0 ? `第 ${res.user.rebirthCount} 轮` : '未轮回';

    const shopsEl = document.getElementById('profile-shops');
    shopsEl.innerHTML = res.shops.length
      ? res.shops.map((s) => `<div class="profile-shop-row">
          <span class="profile-shop-name">${s.emoji} ${s.name}</span>
          <small class="profile-shop-meta">Lv.${s.level} · ${formatMoney(s.incomePerSec)}/秒</small>
        </div>`).join('')
      : '<div class="crowd-empty">名下暂无店铺</div>';
  }

  document.getElementById('profile-close')?.addEventListener('click', () => {
    document.getElementById('profile-panel')?.classList.add('hidden');
  });

  /** 广场消息 / 在线列表点击：资料卡（data-profile）或私聊（data-peer）分派 */
  function handleProfileClick(e) {
    const profileBtn = e.target.closest('[data-profile]');
    if (profileBtn?.dataset.profile) {
      openProfile(profileBtn.dataset.profile, profileBtn.dataset.nick || '');
      return true;
    }
    return false;
  }

  chatList.addEventListener('click', (e) => { handleProfileClick(e); });

  function openChatWith(peerId) {    if (!peerId) return;
    if (dndEnabled) {
      showToast('不想说话模式已开启，恢复聊天后才能发起私聊');
      return;
    }
    currentPeer = peerId;
    const name = peerNames.get(peerId) || '玩家';
    peerNameEl.textContent = blockedIds.has(peerId) ? `与 ${name} 的私聊（已禁止聊天）` : `与 ${name} 的私聊`;
    chatInput.placeholder = blockedIds.has(peerId)
      ? '已禁止对方聊天，解除后可继续'
      : `发给 ${name}…（Enter 发送）`;
    if (!chatOpen) openChat();
    else {
      renderOnline();
      renderMessages();
      chatInput?.focus();
    }
    chat.dmHistory(peerId, 100);
  }

  onlineList.addEventListener('click', (e) => {
    const blockBtn = e.target.closest('[data-block]');
    if (blockBtn) {
      const id = blockBtn.dataset.block;
      if (blockedIds.has(id)) chat.unblock(id);
      else chat.block(id);
      return;
    }
    // 👤 资料卡按钮：查看该玩家公开资料（昵称/称号/身价/店铺列表）
    if (handleProfileClick(e)) return;
    // 点击玩家行发起会话：不限距离、店内/地图模式也可开新会话
    const peerRow = e.target.closest('[data-peer]');
    if (peerRow && peerRow.dataset.peer) {
      peerNames.set(peerRow.dataset.peer, peerRow.dataset.name || '玩家');
      openChatWith(peerRow.dataset.peer);
    }
  });

  // ---- 其他玩家的 3D 形象（服务端每秒推一次坐标，本地插值平滑）----
  const remotePlayers = new Map(); // id -> { id, player, name, title, tx, tz, tyaw, bubble, labelMode }

  // ---- 首富排面（README §19 ③）：专属头衔框 + 脚下金圈红毯 + 点击首富的膜拜菜单 ----
  const top1Crown = new Top1Crown();
  const top1Auras = new Map(); // 'me' 或远端玩家 id -> aura Group
  let top1UserId = null;

  const playerMenu = new PlayerMenu({
    onWorship: async (id) => {
      const res = await gameStore.worshipTop1(id);
      if (!res.ok) {
        showToast(res.message || '膜拜失败');
        return;
      }
      moneyBurst.burst({
        count: 60,
        caption: `🧧 膜拜首富 · 红包 +¥${formatMoney(res.reward)}`,
      });
      showToast(`红包到账 +¥${formatMoney(res.reward)}`);
      applyTop1Visuals();
    },
    onChat: (id, name) => {
      peerNames.set(id, name);
      openChatWith(id);
    },
  });

  /** 给某个人挂上/摘掉首富光环（挂到角色 mesh 上，跟随走动） */
  function syncTop1Aura(key, mesh, height, shouldHave) {
    const existing = top1Auras.get(key);
    if (!shouldHave) {
      if (existing) {
        mesh.remove(existing);
        disposeObject(existing);
        top1Auras.delete(key);
      }
      return;
    }
    if (existing) return;
    const aura = createTop1Aura({ footY: -height / 2 + 0.02 });
    mesh.add(aura);
    top1Auras.set(key, aura);
  }

  /** 根据服务端下发的当前首富重算：头衔框 + 自己/远端角色的金圈红毯 */
  function applyTop1Visuals() {
    const top = gameStore.top1;
    top1UserId = top?.userId || null;
    top1Crown.apply(top, user.id);
    syncTop1Aura('me', player.mesh, player.height, top1UserId === user.id);
    for (const entry of remotePlayers.values()) {
      syncTop1Aura(entry.id, entry.player.mesh, entry.player.height, entry.id === top1UserId);
    }
  }

  applyTop1Visuals();

  // ---- 标签裁剪阈值（README §16 分层策略，可调）----
  const LABEL_FULL_M = 10;   // 10m 内显示完整双行气泡
  const LABEL_MAX_M = 50;    // 50m 外完全隐藏头顶 Sprite
  const LABEL_MAX_FULL = 8;  // 同屏最多 8 个完整气泡（按距离取最近的）
  const _frustum = new THREE.Frustum();
  const _projMat = new THREE.Matrix4();
  const forceLabelIds = new Set(); // 强制保留完整标签的玩家 id（私聊对象 / 踢馆攻击者）

  /** 绘制远程玩家头顶气泡：mode='full' 双行（昵称+称号胶囊）；mode='name' 单行仅昵称 */
  function makeRemoteBubble({ name, title, mode = 'full' }) {
    const nameOnly = mode === 'name';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const W = 360;
    const H = nameOnly ? 56 : 110;
    canvas.width = W;
    canvas.height = H;

    const badgeY = Math.max(14, H - 46);
    // 深色圆角底
    ctx.fillStyle = 'rgba(12, 8, 4, 0.82)';
    ctx.beginPath();
    ctx.roundRect(6, 8, W - 12, H - 14, nameOnly ? 16 : 18);
    ctx.fill();
    ctx.strokeStyle = nameOnly ? 'rgba(245, 208, 120, 0.4)' : 'rgba(245, 208, 120, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 昵称
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#ffe6a3';
    ctx.fillText(name || '神秘富豪', W / 2, nameOnly ? H / 2 : 42);

    // 财富称号（胶囊，仅完整模式）
    if (!nameOnly && title) {
      ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
      const w = ctx.measureText(title).width + 30;
      ctx.fillStyle = 'rgba(255, 190, 60, 0.22)';
      ctx.beginPath();
      ctx.roundRect(W / 2 - w / 2, badgeY, w, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#ffd24a';
      ctx.fillText(title, W / 2, badgeY + 13);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
    );
    sprite.renderOrder = 20;
    const h = nameOnly ? 0.38 : 0.7; // 单行标签更小更轻
    sprite.scale.set((W / H) * h, h, 1);
    sprite.position.y = 1.55;
    return sprite;
  }

  function applyRemoteBubble(entry, mode = entry.labelMode || 'full', force = false) {
    // 移除 Player 类默认画的单行 nameTag（它在玩家头顶 height/2 + 0.42 ≈ 1.32）
    const oldNameTag = entry.player.mesh.children.find(
      (c) => c.isSprite && !c.userData?.remoteBubble && c !== entry.player.chatBubble
    );
    if (oldNameTag) entry.player.mesh.remove(oldNameTag);
    if (mode === 'hidden') {
      if (entry.bubble) entry.bubble.visible = false;
      if (force) entry.bubbleDirty = true;
      return;
    }
    if (!force && !entry.bubbleDirty && entry.bubble && entry.renderedMode === mode) {
      entry.bubble.visible = true;
      return;
    }
    if (entry.bubble) {
      entry.player.mesh.remove(entry.bubble);
      entry.bubble.material.map?.dispose();
      entry.bubble.material.dispose();
    }
    entry.bubble = makeRemoteBubble({ name: entry.name, title: entry.title, mode });
    entry.bubble.userData = { remoteBubble: true };
    entry.bubble.visible = true;
    entry.renderedMode = mode;
    entry.bubbleDirty = false;
    entry.player.mesh.add(entry.bubble);
  }

  function disposeObject(obj) {
    obj.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      } else if (child.isSprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
    });
  }

  function syncRemotePlayers(list) {
    const seen = new Set();
    for (const p of list) {
      if (!p || p.id === user.id) continue;
      seen.add(p.id);
      const entry = remotePlayers.get(p.id);
      if (entry) {
        entry.tx = p.x;
        entry.tz = p.z;
        entry.tyaw = p.yaw || 0;
        // 每秒 push 带 title/nickname，只有变化时重画（Canvas 操作费 GPU）
        const nameChanged = entry.name !== p.nickname;
        const titleChanged = entry.title !== p.title;
        if (nameChanged || titleChanged) {
          entry.name = p.nickname;
          entry.title = p.title;
          applyRemoteBubble(entry, entry.labelMode || 'full', true);
        }
      } else {
        const remote = new Player([], world.groundY, null, { variant: p.variant, name: p.nickname });
        remote.mesh.position.set(p.x, world.groundY + remote.height / 2, p.z);
        remote.mesh.rotation.y = p.yaw || 0;
        remote.mesh.userData.remoteId = p.id;
        scene.add(remote.mesh);
        const newEntry = {
          id: p.id,
          player: remote,
          name: p.nickname,
          title: p.title,
          tx: p.x, tz: p.z, tyaw: p.yaw || 0,
          labelMode: 'full',
        };
        applyRemoteBubble(newEntry, 'full');
        remotePlayers.set(p.id, newEntry);
      }
    }
    // 下线/离开的玩家移除模型并释放显存
    for (const [id, entry] of remotePlayers) {
      if (seen.has(id)) continue;
      if (entry.bubble) {
        entry.bubble.material.map?.dispose();
        entry.bubble.material.dispose();
      }
      scene.remove(entry.player.mesh);
      disposeObject(entry.player.mesh);
      top1Auras.delete(id);
      remotePlayers.delete(id);
    }
    // 新人上线／他人下线后重算一遍首富光环（幂等，只增删差异）
    applyTop1Visuals();
  }

  // ---- 标签裁剪辅助（README §16）----
  const _occlRay = new THREE.Raycaster();
  // shopMeshes 里混有店铺图标 Sprite，three.js 对 Sprite 求交会读 raycaster.camera.matrixWorld
  _occlRay.camera = camera;
  const _occlDir = new THREE.Vector3();
  const LABEL_RAY_HEIGHT = 1.55; // 与气泡 Sprite 的高度一致
  let occlTick = 0;

  /** 相机 → 玩家标签位置的射线是否被建筑挡住（终点提前 0.5m，防贴着门脸误判） */
  function _labelOccluded(playerPos, camPos) {
    _occlDir.copy(playerPos);
    _occlDir.y += LABEL_RAY_HEIGHT;
    _occlDir.sub(camPos);
    const dist = _occlDir.length();
    if (dist < 2) return false; // 贴脸不判遮挡
    _occlDir.divideScalar(dist);
    _occlRay.set(camPos, _occlDir);
    _occlRay.far = dist - 0.5;
    // 打隐形包围盒代理（每店 12 三角）而非几千三角的合并大 mesh——避免每轮射线 CPU 尖峰
    return _occlRay.intersectObjects(world.occluderProxies || world.shopMeshes, false).length > 0;
  }

  /**
   * 标签裁剪（README §16）：每帧按「距离分档 + 视锥剔除 + 最近 8 个上限」更新各玩家头顶气泡。
   * Canvas 只在档位变化时重绘（applyRemoteBubble 内部按 labelMode 判断），帧开销仅为距离与视锥计算。
   * 遮挡剔除（Raycaster）：约 300ms 一轮低频射线，玩家标签被建筑挡住时隐藏——结果缓存在 entry.occluded。
   */
  function updateRemoteLabels() {
    if (remotePlayers.size === 0) return;
    const camPos = camera.position;
    _projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projMat);

    // 遮挡判断降频跑（60fps 下每 18 帧 ≈ 300ms），射线目标只有建筑集合
    occlTick += 1;
    const runOcclusion = occlTick % 18 === 0;

    // 按距离升序，最近 LABEL_MAX_FULL 个才有资格显示完整双行
    const sorted = [];
    for (const entry of remotePlayers.values()) {
      sorted.push({ entry, dist: entry.player.mesh.position.distanceTo(camPos) });
    }
    sorted.sort((a, b) => a.dist - b.dist);

    for (let i = 0; i < sorted.length; i++) {
      const { entry, dist } = sorted[i];
      const inFrustum = _frustum.containsPoint(entry.player.mesh.position);
      const forced = forceLabelIds.has(entry.id) || entry.id === currentPeer;

      let mode;
      if (!inFrustum && !forced) mode = 'hidden';
      else if (dist > LABEL_MAX_M && !forced) mode = 'hidden';
      else if (dist < LABEL_FULL_M || forced || i < LABEL_MAX_FULL) mode = 'full';
      else mode = 'name';

      if (runOcclusion) {
        if (mode !== 'hidden') {
          entry.occluded = _labelOccluded(entry.player.mesh.position, camPos);
        } else {
          entry.occluded = false;
        }
      }

      if (entry.labelMode !== mode) {
        entry.labelMode = mode;
        applyRemoteBubble(entry, mode);
      }
      if (entry.bubble) entry.bubble.visible = mode !== 'hidden' && !entry.occluded;
    }
  }

  // ---- 点击身边的其他玩家发起私聊（必须在 4 米内）----
  const CHAT_CLICK_RANGE = 4.2;
  const chatPicker = new THREE.Raycaster();
  chatPicker.camera = camera; // 远端玩家气泡为 Sprite：Sprite.raycast 需要 raycaster.camera
  const chatPickPoint = new THREE.Vector2();

  renderer.domElement.addEventListener('click', (e) => {
    if (mode !== 'street' || transitioning || mapView.active) return;
    if (interaction.isOpen()) return;
    if (document.pointerLockElement === renderer.domElement) {
      chatPickPoint.set(0, 0); // 指针锁定时用准星位置
    } else {
      const rect = renderer.domElement.getBoundingClientRect();
      chatPickPoint.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      chatPickPoint.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
    chatPicker.setFromCamera(chatPickPoint, camera);
    const meshes = [...remotePlayers.values()].map((r) => r.player.mesh);
    if (!meshes.length) return;
    const hit = chatPicker.intersectObjects(meshes, true)[0];
    if (!hit) return;

    let obj = hit.object;
    while (obj && !obj.userData.remoteId) obj = obj.parent;
    if (!obj) return;
    // 命中玩家时拦下这次点击，避免同时触发店铺卡片
    e.stopPropagation();
    e.preventDefault();

    const remote = remotePlayers.get(obj.userData.remoteId);
    if (!remote) return;
    const dist = Math.hypot(
      remote.player.mesh.position.x - player.position.x,
      remote.player.mesh.position.z - player.position.z
    );
    if (dist > CHAT_CLICK_RANGE) {
      showToast('离得太远，走到对方身边再点击');
      return;
    }
    peerNames.set(obj.userData.remoteId, remote.name);

    // 点到的就是全服首富 → 弹「膜拜领红包 / 私聊」菜单，不走默认私聊
    if (obj.userData.remoteId === top1UserId) {
      playerMenu.open({
        id: obj.userData.remoteId,
        name: remote.name,
        top1: true,
        reward: gameStore.worship.reward,
        cooldownMs: gameStore.worship.cooldownMs,
        x: e.clientX,
        y: e.clientY,
      });
      return;
    }
    openChatWith(obj.userData.remoteId);
  }, true);

  // WS 重连成功：补拉一次 state，恢复断线窗口内错过的踢馆警报（AttackAlert 有 incomingAttack 恢复逻辑）
  chat.on('open', () => {
    gameStore.load().catch(() => { /* 网络抖动静默，下一轮重连再补 */ });
  });

  chat.on('welcome', (p) => {
    onlinePlayers = p.online || [];
    blockedIds = new Set(p.blocked || []);
    const wantedDnd = !!p.dnd || sessionStorage.getItem('chat-dnd') === '1';
    applyDnd(wantedDnd);
    if (wantedDnd !== !!p.dnd) chat.setDnd(wantedDnd);
    updateOnlineCount(onlinePlayers.length);
    currentRoomNo = p.room ?? currentRoomNo;
    renderRoom(currentRoomNo, onlinePlayers.length); // 房间号 + 本房人数
    syncRemotePlayers(onlinePlayers);
    renderOnline();
    renderChatCurrent();
  });
  chat.on('global_msg', (m) => {
    globalMessages.push(m);
    while (globalMessages.length > 100) globalMessages.shift();
    if (chatOpen && chatTab === 'global') appendChatRow(buildMsgRow(m, true));
  });
  chat.on('dnd', (p) => {
    applyDnd(!!p?.enabled);
    sessionStorage.setItem('chat-dnd', dndEnabled ? '1' : '0');
  });
  chat.on('players', (list) => {
    onlinePlayers = list || [];
    updateOnlineCount(onlinePlayers.length);
    syncRemotePlayers(onlinePlayers);
    renderOnline();
  });
  chat.on('dm', (msg) => {
    if (dndEnabled) return;
    const peerId = msg.from?.id === user.id ? msg.to : msg.from?.id;
    if (!peerId) return;
    if (msg.from?.id !== user.id && msg.from?.nickname) peerNames.set(peerId, msg.from.nickname);
    pushMessage(peerId, msg);
    // 当前会话且面板打开：增量追加（智能滚动，不打断翻历史）；否则只入库存
    if (chatOpen && peerId === currentPeer) appendChatMessage(peerId, msg);
    const speaker = msg.from?.id === user.id
      ? player
      : remotePlayers.get(msg.from?.id)?.player;
    speaker?.showChatBubble(msg.text);
    if (!chatOpen && msg.from?.id !== user.id) {
      addUnread(peerId); // 面板未打开：累加未读，Tab 控件显示红点
      showToast(`收到 ${msg.from.nickname} 的私聊（Tab 查看）`);
    }
  });
  chat.on('blocked', (p) => {
    const next = new Set(p.blocked || []);
    const wasBlocked = currentPeer ? blockedIds.has(currentPeer) : false;
    blockedIds = next;
    renderOnline();
    if (currentPeer) {
      const name = peerNames.get(currentPeer) || '玩家';
      const nowBlocked = blockedIds.has(currentPeer);
      if (nowBlocked && !wasBlocked && next.has(currentPeer)) showToast(`已禁止 ${name} 给你发消息`);
      else if (!nowBlocked && wasBlocked) showToast(`已解除对 ${name} 的禁止`);
      peerNameEl.textContent = nowBlocked
        ? `与 ${name} 的私聊（已禁止聊天）`
        : `与 ${name} 的私聊`;
      chatInput.placeholder = dndEnabled
        ? '不想说话模式已开启，所有聊天已屏蔽'
        : nowBlocked
          ? '已禁止对方聊天，解除后可继续'
          : `发给 ${name}…（Enter 发送）`;
      renderMessages();
    }
  });
  chat.on('dm_history', (p) => {
    if (p.with !== currentPeer) return;
    convo.set(p.with, (p.messages || []).slice(-200));
    renderMessages();
  });
  chat.on('error', (p) => {
    if (p?.code === 'room-full') {
      // 记忆房间满员：客户端会自动重连换房，这里只给轻提示
      showToast('所在房间已满，正在为你切换房间…');
      return;
    }
    if (p?.msg) showToast(p.msg);
  });
  // 资本踢馆：有人对我的店铺发起恶意收购 → 红光倒计时护盘 + 3D 演出（攻击者模型跑位挑衅）
  chat.on('shop_attack', (p) => {
    attackAlert.show(p);
    desktopNotify.notifyAttack(p);
    if (p?.attackerId) forceLabelIds.add(p.attackerId); // 踢我店的人：标签强制完整显示
    const attackerEntry = remotePlayers.get(p?.attackerId);
    attackTheater.beginDefenderShow(p, attackerEntry); // 不在视野内时内部自动降级
  });
  chat.on('shop_attack_result', (p) => {
    attackAlert.handleResult(p);
    if (p?.attackerId) forceLabelIds.delete(p.attackerId);
    attackTheater.end(); // 结束跑位演出，恢复服务端位置插值
    refreshLeaderboard(); // 踢馆成交改变身价格局，榜单立即刷新（不等 30s 轮询）
    // 我发起的收购成交：金币雨庆祝
    if (p?.outcome === 'captured' && p?.attackerId === user.id) {
      moneyBurst.burst({
        count: 90,
        caption: `💰 收购成功 · ¥${formatMoney(p.price || p.bid)} 入主「${p.shopName}」`,
      });
    }
  });
  // 我发起踢馆：黑卡甩向店门口的飞牌特效
  gameStore.onEvent((kind, payload) => {
    if (kind === 'attack' && payload?.shopId) {
      attackTheater.playCardThrow(payload.shopId, payload.bid, camera, world.shopMeshes);
    }
  });
  // 首富易主：金色弹幕由 Danmaku 处理，这里刷新头衔框 / 金圈红毯
  chat.on('top1', (p) => {
    if (!p?.userId) return;
    if (gameStore.state) gameStore.state.top1 = p;
    applyTop1Visuals();
    showToast(p.userId === user.id ? '👑 你已成为全服首富！' : `👑 ${p.nickname} 登顶全服首富`);
    if (p.userId === user.id) gameStore.emitEvent('top1', { wealth: p.wealth });
  });
  chat.on('auth-lost', () => {
    setToken(null);
    showToast('登录已过期，即将刷新');
    setTimeout(() => location.reload(), 1500);
  });
  chat.connect();
  // 全服收购战报弹幕
  const danmaku = new Danmaku();
  danmaku.bind(chat);
  danmaku.loadHistory();
  // 首次上报一次位置，避免服务端用默认坐标展示
  chat.sendPosition(player.position.x, player.position.z, player.mesh.rotation.y);

  // 输入框：Enter 发送（广场 / 私聊按 tab 分派），Shift+Enter 换行，Esc 关闭面板
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeChat();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;

      if (chatTab === 'global') {
        // 广场（全服频道）：拉黑不影响广场；dnd 服务端拦截
        if (!chat.sendGlobal(text)) {
          showToast('聊天连接未就绪，请稍后再试');
          return;
        }
        chatInput.value = '';
        return;
      }

      if (!currentPeer) {
        showToast('点击在线列表选择私聊对象，或切回广场聊天');
        return;
      }
      if (blockedIds.has(currentPeer)) {
        showToast('你已禁止对方聊天，请先解除');
        return;
      }
      if (!chat.dm(currentPeer, text)) {
        showToast('聊天连接未就绪，请稍后再试');
        return;
      }
      chatInput.value = '';
    }
  });

  // 聊天双 tab 切换
  document.getElementById('chat-tab-global')?.addEventListener('click', () => { if (chatOpen) setChatTab('global'); });
  document.getElementById('chat-tab-dm')?.addEventListener('click', () => { if (chatOpen) setChatTab('dm'); });

  // Tab 键开关聊天面板；打开期间锁定移动与指针锁
  const input = { forward: false, back: false, left: false, right: false, jump: false, sprint: false };
  let camWasEnabled = true;
  let daylightAcc = 0; // 昼夜更新限频累积器

  function openChat() {
    chatOpen = true;
    chatBox.classList.remove('hidden');
    // 清空移动状态，避免 Tab 前按住的键一直生效
    Object.keys(input).forEach((k) => { input[k] = false; });
    if (document.pointerLockElement) document.exitPointerLock();
    camWasEnabled = tpCamera.enabled;
    tpCamera.enabled = false; // 聊天期间点击画面不再抢指针锁
    clearUnread(); // 打开面板即视为已读
    setChatTab(chatTab); // 恢复上次所在 tab
    renderOnline();
    chatInput?.focus();
  }
  function closeChat() {
    chatOpen = false;
    chatBox.classList.add('hidden');
    chatInput?.blur();
    chatInput.value = '';
    if (!mapView.active) tpCamera.enabled = camWasEnabled;
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Tab') return;
    e.preventDefault();
    if (prestigeOpen) return; // 轮回面板打开时不叠加聊天
    if (chatOpen) closeChat();
    else openChat();
  });

  // T 键开关资本轮回面板（与聊天互斥）：打开期间锁定移动与指针锁
  let prestigeOpen = false;
  let camSavedForPrestige = true;

  function openPrestige() {
    if (exited || transitioning) return;
    prestigeOpen = true;
    prestigePanel.open();
    Object.keys(input).forEach((k) => { input[k] = false; });
    if (document.pointerLockElement) document.exitPointerLock();
    camSavedForPrestige = tpCamera.enabled;
    tpCamera.enabled = false;
  }
  function closePrestige() {
    prestigeOpen = false;
    prestigePanel.close();
    if (!mapView.active && !chatOpen) tpCamera.enabled = camSavedForPrestige;
  }

  prestigePanel.onRequestClose = () => closePrestige();

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT') return;
    e.preventDefault();
    if (chatOpen) return; // 聊天输入中不打开轮回面板
    if (prestigeOpen) closePrestige();
    else openPrestige();
  });

  // 主循环里每 2s 发一次位置
  let lastPosSentAt = 0;

  // 键盘输入
  const keyMap = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'jump',
    ShiftLeft: 'sprint', ShiftRight: 'sprint'
  };
  window.addEventListener('keydown', (e) => {
    if (chatOpen) return; // 聊天输入中不响应移动
    if (keyMap[e.code]) {
      e.preventDefault();
      input[keyMap[e.code]] = true;
      // 门口圈内自动弹出的资产卡 / 店员对话：按移动键即自动关闭（像走出对话一样自然），
      // 无需先按 Esc——下一帧 input 已就位，移动无缝恢复
      if (interaction.isOpen()) interaction.close();
      if (dialogue.isOpen()) dialogue.close();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.code]) { input[keyMap[e.code]] = false; e.preventDefault(); }
  });

  // ---- 退出游戏 ----
  const exitModal = document.getElementById('exit-modal');
  const exitScreen = document.getElementById('exit-screen');
  let exited = false;

  function openExitModal() {
    if (exited) return;
    if (document.pointerLockElement) document.exitPointerLock();
    if (interaction.isOpen()) interaction.close();
    dialogue.close();
    exitModal.classList.remove('hidden');
  }

  function closeExitModal() {
    exitModal.classList.add('hidden');
  }

  function confirmExit() {
    if (exited) return;
    exited = true;
    if (lodTimer) { clearInterval(lodTimer); lodTimer = null; }
    exitModal.classList.add('hidden');
    exitScreen.classList.remove('hidden');
    crosshair.classList.remove('show');
    interactHint.hide();
    exitShopBtn.classList.add('hidden');
    if (!chatBox.classList.contains('hidden')) closeChat();
    if (prestigePanel.isOpen()) closePrestige();
    hideRoom();
    chat.close();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  document.getElementById('exit-game').addEventListener('click', openExitModal);
  document.getElementById('exit-cancel').addEventListener('click', closeExitModal);
  document.getElementById('exit-confirm').addEventListener('click', confirmExit);
  document.getElementById('exit-reenter').addEventListener('click', () => window.location.reload());
  exitModal.addEventListener('click', (e) => {
    if (e.target === exitModal) closeExitModal();
  });

  // 主循环
  // 主循环
  const clock = new THREE.Clock();
  let lastStateText = '';
  let lastStateCode = '';
  function animate() {
    if (exited) return; // 已退出：停止循环，不再响应任何输入
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    // 昼夜循环：限频 100ms（视觉变化缓慢，逐帧重绘天空纹理纯浪费）
    daylightAcc += dt;
    if (daylightAcc >= 0.1) {
      daylightAcc = 0;
      sceneLighting?.applyDaylight(clock.elapsedTime / DAY_LENGTH_S);
    }

    // 阴影相机按 4m 网格吸附跟随玩家（避免每帧移动导致静态建筑阴影滑移，减少矩阵更新）
    const sun = sceneLighting?.sun;
    if (sun) {
      const sx = Math.round(player.mesh.position.x / 4) * 4;
      const sz = Math.round(player.mesh.position.z / 4) * 4;
      if (sun.target.position.x !== sx || sun.target.position.z !== sz) {
        sun.position.set(sx + 28, 42, sz + 18);
        sun.target.position.set(sx, player.mesh.position.y, sz);
        sun.target.updateMatrixWorld();
        renderer.shadowMap.needsUpdate = true;
      }
    }

    // 呼吸动画：保护期光环穹顶 / 地面光圈 / 倒计时 Sprite
    assetVisuals.update(dt);

    // 其他玩家位置/朝向插值（服务端 1Hz 推送，插值到每帧；演出接管期间跳过）
    const posK = Math.min(1, dt * 8);
    const yawK = Math.min(1, dt * 10);
    for (const { player: remote, tx, tz, tyaw } of remotePlayers.values()) {
      if (remote.theaterControlled) continue; // 演出接管中：位置由 AttackTheater 驱动
      const m = remote.mesh;
      m.position.x += (tx - m.position.x) * posK;
      m.position.z += (tz - m.position.z) * posK;
      const diff = Math.atan2(Math.sin(tyaw - m.rotation.y), Math.cos(tyaw - m.rotation.y));
      m.rotation.y += diff * yawK;
    }

    // 踢馆 3D 演出驱动（跑位/挑衅/黑卡飞行）
    attackTheater.update(dt, camera.position);

    // 首富光环：脚下金圈的呼吸脉冲与自转
    for (const aura of top1Auras.values()) aura.update?.(dt);

    // 标签裁剪：距离分档 + 视锥剔除 + 最近 8 个完整气泡上限（README §16）
    updateRemoteLabels();

    const cardOpen = interaction.isOpen();
    const talking = dialogue.isOpen();
    const uiOpen = cardOpen || talking || walletPanel.isOpen() || chatOpen || tauntPanel.isOpen();

    // 街头金币雨 / 碰瓷 NPC：被 UI 挡住时只播动画，不刷新也不拾取
    const streetLive = mode === 'street' && !mapView.active && !uiOpen;
    coinRain.setEnabled(streetLive);
    coinRain.update(dt, streetLive);
    tauntNpcs.update(dt, player.position, mode === 'street' && !uiOpen);

    if (transitioning) {
      // 场景切换中冻结输入
    } else if (mapView.active) {
      mapView.update(dt);
      mapView.setPlayerMarker(player.mesh.position); // 「我在哪」定位标记（随玩家实时位置）
    } else if (mode === 'interior') {
      if (!uiOpen) {
        player.update(dt, input, tpCamera.getYaw());
        if (walkState.last) {
          const dx = player.position.x - walkState.last.x;
          const dz = player.position.z - walkState.last.z;
          walkState.meters += Math.hypot(dx, dz);
        }
        walkState.last = { x: player.position.x, z: player.position.z };

        // 走进出口光圈 → 返回街道
        if (currentRoom) {
          const dx = player.position.x - currentRoom.exit.x;
          const dz = player.position.z - currentRoom.exit.z;
          if (Math.sqrt(dx * dx + dz * dz) <= currentRoom.exit.radius) {
            exitShop();
          }
        }
      } else {
        interactHint.hide();
      }
    } else if (!uiOpen) {
      player.update(dt, input, tpCamera.getYaw());
      proximity.update(input.forward || input.back || input.left || input.right);
      if (walkState.last) {
        const dx = player.position.x - walkState.last.x;
        const dz = player.position.z - walkState.last.z;
        walkState.meters += Math.hypot(dx, dz);
      }
      walkState.last = { x: player.position.x, z: player.position.z };
    } else {
      interactHint.hide();
    }

    // 走路任务定期上报（10m 以下或 10s 以下不报，后端会拒绝过大的瞬间值）
    if (walkState.meters > 10 && performance.now() >= walkState.nextReportAt) {
      const sent = Math.floor(walkState.meters);
      gameStore.walkedQuest(sent).then(async (res) => {
        // 上报成功后拉一次 state，让 quests 里的 walk 进度从 0 跳到实际值
        if (res.ok) {
          try { await gameStore.load(); } catch { /* 静默 */ }
        }
      });
      walkState.meters = 0;
      walkState.nextReportAt = performance.now() + 10_000;
    }

    // 触发圈呼吸动画；玩家站在圈内时高亮（仅街道）
    if (mode === 'street') {
      const activeShopId = proximity.currentShop?.shopId ?? null;
      const elapsed = clock.elapsedTime;
      for (const ring of rings) {
        ring.setActive(ring.shopId === activeShopId);
        ring.update(elapsed);
      }
    }
    // 底部人物状态（仅在变化时更新 DOM，避免每帧触发样式重算）
    const moving = input.forward || input.back || input.left || input.right;
    let nextStateText = '静止';
    let nextStateCode = 'idle';
    if (mapView.active) {
      nextStateText = '地图总览';
      nextStateCode = 'view';
    } else if (talking) {
      nextStateText = '交谈中';
      nextStateCode = 'view';
    } else if (uiOpen) {
      nextStateText = '查看中';
      nextStateCode = 'view';
    } else if (mode === 'interior' && !moving) {
      nextStateText = '店内探索';
      nextStateCode = 'idle';
    } else if (moving) {
      const running = input.sprint;
      nextStateText = running ? '奔跑中' : '行走中';
      nextStateCode = running ? 'run' : 'walk';
    }
    if (nextStateText !== lastStateText) {
      lastStateText = nextStateText;
      playerStateEl.textContent = nextStateText;
    }
    if (nextStateCode !== lastStateCode) {
      lastStateCode = nextStateCode;
      playerStateEl.dataset.state = nextStateCode;
    }

    // 位置同步：街道上每 2s 上报一次（店内是独立坐标系，不上报）
    if (mode === 'street' && !mapView.active) {
      const now = performance.now();
      if (now - lastPosSentAt >= 2000) {
        lastPosSentAt = now;
        chat.sendPosition(player.position.x, player.position.z, player.mesh.rotation.y);
      }
    }

    if (!mapView.active) tpCamera.update(player.position);
    renderer.render(scene, camera);
  }
  animate();
}

// 全局错误捕获
window.addEventListener('error', (e) => {
  showError('运行错误：' + e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  showError('异步错误：' + e.reason);
});

bootstrap().catch((err) => {
  console.error(err);
  loadingStatus.textContent = '初始化失败：' + err.message;
  retryBtn.classList.remove('hidden');
  retryBtn.onclick = () => window.location.reload();
});
