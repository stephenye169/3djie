# 青果巷 · 3D 虚拟商业街 — 技术架构文档

本文档记录 `3djie`（Street_Empire）的前端 3D 场景架构、性能优化、后端服务与协议设计，以及多房间分流与防作弊方案。

---

## 目录

1. [核心解耦原则与真实布局](#1-核心解耦原则与真实布局)
2. [3D 场景与交互系统](#2-3d-场景与交互系统)
3. [性能剖析与 30 人同房优化](#3-性能剖析与-30-人同房优化)
4. [后端架构与通信协议](#4-后端架构与通信协议)
5. [多房间分流 × 全服统一世界](#5-多房间分流--全服统一世界)
6. [并发安全与权威后端防作弊](#6-并发安全与权威后端防作弊)
7. [接入真实 GLB 模型](#7-接入真实-glb-模型)
8. [已知技术限制](#8-已知技术限制)

---

## 1. 核心解耦原则与真实布局

### 1.1 建筑模型与商铺数据分离

- 场景建筑只负责**几何与坐标**，通过 `mesh.userData.shopId` 声明归属。
- 名称、简介、营业时间、商品与价格全部位于 `src/data/shops.js`。
- 室内配色位于 `src/data/interiors.js`，店员与对话话题位于 `src/data/npcs.js`。
- 新增一家可进店店铺只需：模型声明 `shop_<id>`（或 `userData.shopId`）并在 `shops.js` 增加同 `id` 配置。

### 1.2 真实布局数据化（`src/data/layout.js`）

`layout.js` 用坐标描述青果巷的东→西空间序列，`ProceduralStreet.js` 仅负责按数据生成几何体，**点位与建模解耦**。

- **坐标系**：`z = 0` 为东入口牌坊，往西 `z` 递减（`z = -494` 为西入口）；`+x` 为巷北，`-x` 为巷南。
- **街道边界（`STREET`）**：巷宽 9m，行走范围 `x ∈ [-3.9, 3.9]`、`z ∈ [-491, 11]`；南市河位于巷南 `x = -25 ~ -44`。
- **支巷（`LANES`）**：正素巷（`z = -88`）、天井巷（`z = -300`）、雪洞巷（`z = -365`），均向北延伸约 30–34m。
- **建筑（`BUILDINGS`，约 55 栋）**：两侧用 `res-*` 民居连续填满，其中包含 **18 家可收购商业资产**（全部已支持按 `E` 推门进入店内浏览商品与对话，未收购前点柜台同样可触发收购面板）。

| z 位置 | 地标 | 说明 |
| --- | --- | --- |
| 0 | 牌坊 | 东入口，高 7.2m |
| -45 | 城隍庙戏楼 | 面宽 18m / 进深 25m / 檐高 8m |
| -72 | 文化记忆馆 | 面宽 20m / 进深 35m |
| -88 | **正素巷** | 北侧支巷 |
| -155 / -185 | 松健堂 / 赵元任故居 | 进深 45–50m |
| -300 / -318 | **天井巷** / 进士坊 | 北侧支巷 / 石坊（`kind: 'stone'`） |
| -338 | 恽鸿仪故居 · 可园 | 面宽 18m / 进深 55m |
| -365 / -386 | **雪洞巷** / 八桂堂 · 刘国钧故居 | 北侧支巷 / 进深 50m |
| -412 / -418 | 半园 / 贞和堂 · 唐荆川故居 | 半园退让 42m |
| -440 | 礼和堂 · 周有光故居 | 南侧，面宽 18m / 进深 30m |
| -492 | 西入口 | 西门，宽 12m |

**程序化立面规则**：按 3.4m 开间排布门窗（门居中、两层加二层窗）；进深超过 8m 的深宅屋顶按「进」分段起脊；白墙与黛瓦各有 3–4 档色差，相邻建筑错色。

---

## 2. 3D 场景与交互系统

### 2.1 同场景传送的室内方案（`InteriorManager.js`）

进店不重建 `Scene`，而是在街道之外独立坐标区（`x = 600 + n × 40`）生成 14m × 14m 室内房间：

- **懒构建 + 缓存**：首次进店才生成房间几何体，再次进入直接复用。
- **状态隔离**：进店时替换 `Player` 的 `colliders / bounds / groundY`，离店还原；同一时刻仅显示当前房间。
- **过渡与视效**：`#scene-fade` 遮罩淡出→切换→淡入；相机调用 `snap()` 立即对齐，防止横跨 600m 飞镜；天花板正面朝下，外部俯视自动背面剔除，不遮挡第三人称镜头。
- **多人坐标一致**：房间序号按 `ASSETS` 固定顺序计算（而非「第几个建造」），各客户端算出的房间世界原点相同；配合 `position` 消息里的 `scene / shopId`，同店玩家可在同一室内场景互相看见。

### 2.2 店铺三层交互与两级拾取兜底

1. **地面触发圈（`ShopEntrance.js`，半径 1.5m）**：走入并**停下脚步**自动弹出信息卡（奔跑路过不打断移动）；圈内按 `E` 才可进店。
2. **头顶浮动图标（`ShopMarker.js`）**：`CanvasTexture` Sprite，`depthTest: false` 避免被建筑遮挡。
3. **两级射线拾取（`ShopInteraction._pickShop()`）**：第三人称略俯视时准星常落地面，故先沿鼠标/屏幕中心发射射线，未命中则沿相机**水平朝前**方向补射一次，命中任意子构件后沿 `parent` 链向上查找 `userData.shopId`。

### 2.3 相机模式参数

| 参数 | 街道 | 室内 | 地图总览（`MapView.js`） |
| --- | --- | --- | --- |
| 跟随距离 | 6.5 | 3.2 | —（自由斜俯视相机） |
| 高度 | 1.6 | 0.3 | 35 ~ 170（滚轮缩放） |
| pitch 范围 | -0.4 ~ 1.2（默认 0.16） | -0.3 ~ 0.18 | 固定斜俯视 |

- **地图总览特性**：复用同一 `scene` 与 `camera`，进入时 0.9s 补间拉升高度，雾密度从 `0.007` 降至 `0.0016`、`camera.far` 拉至 `1200`；支持左键拖拽平移、滚轮缩放、屋顶店名标签、玩家实时定位（`setPlayerMarker`）与路线预览（`showRoute`），**点击标签或建筑可消耗 ¥10 万（经 `POST /api/game/teleport` 服务端扣款）1.1s 飞到店铺门口上空并传送落地**。进入期间禁用 `tpCamera` 与 `interaction`。

### 2.4 移动、碰撞与角色系统

- **碰撞与边界**：角色以 AABB（`THREE.Box3`，半径 0.5 / 身高 1.8）做 X/Z 分轴检测撞墙回退；`groundY` 重力贴地；`bounds` 限制走出街区。
- **程序化双角色（`Player.js`）**：用 `CapsuleGeometry` / `SphereGeometry` / `CylinderGeometry` 拼出男生「阿青」（蓝衬衫深色长裤）与女生「小果」（马尾 + 红色连衣裙）；四肢挂在髋/肩部 pivot `Group` 上，行走按正弦摆动（奔跑相位 9→13 rad/s）；模型 `rig` 下移半高，使 `Group` 原点与碰撞体中心解耦。
- **昼夜与音效**：`Scene.js` 内置 6 分钟一个周期的昼夜关键帧（白天→黄昏→夜晚→黎明，每 100ms 限频更新天空渐变）；`src/utils/audio.js` 提供纯 Web Audio 合成音效（警报/滴答/成功/失败/金币落袋）。
- **踢馆 3D 剧场（`AttackTheater.js`）**：防守方视角下攻击者模型跑向店门口循环挑衅；攻击方视角下甩出黑卡抛物线与金币雨。

---

## 3. 性能剖析与 30 人同房优化

### 3.1 渲染优化手段

| 优化项 | 实现位置 | 核心机制 |
| --- | --- | --- |
| **标签裁剪（Label Culling）** | `main.js` `updateRemoteLabels()` | `<10m` 完整双行气泡、`10–50m` 单行昵称、`>50m` 隐藏；`THREE.Frustum` 视锥剔除；每帧最多显示 8 个完整气泡；私聊对象与踢馆攻击者强制保留 |
| **遮挡剔除（代理盒）** | `main.js` `_labelOccluded()` | 每 300ms 用独立 `_occlRay` 向每店 12 三角隐形包围盒代理发射线（`far = 距离 - 0.5m`）。**注意**：射线若可能命中 Sprite 必须显式赋值 `_occlRay.camera = camera`，否则会抛出 `matrixWorld` 空指针 |
| **简化几何 + 同步全街合并** | `ProceduralStreet.js` | 门窗/店招采用极简轻量体块（整条街约 3–4k 三角面）与不透明材质并留出 Z 轴干净缝隙防 Z-fighting 闪烁；进场前一次性同步构建并按「`shopId` / `common` × 材质」合并及 `freezeStatic()` 冻结静态矩阵（已不再使用旧版细构件 LOD 切换与分批弹出） |
| **角色几何合并** | `Player.js` | 用 `BufferGeometryUtils.mergeGeometries` 按材质合并同角色部件并减半曲面 segment，单角色 draw call 大幅下降 |
| **CanvasTexture 对象池** | `src/utils/canvasPool.js` | 池上限 32，复用名牌与保护期倒计时画布，原地重绘避免每秒 `new CanvasTexture` |
| **阴影与设备分档** | `Scene.js` + `main.js` | 阴影贴图 2048→1024，阴影相机跟随玩家且每 500ms 更新一次 `shadowMap.needsUpdate`；移动端自动关闭 AA、阴影并将 `pixelRatio` 限至 1.5 |
| **纹理 Atlas（不做）** | — | 主体材质已全局复用，场景贴图极少，合图对 draw call 收益趋近于 0 |

### 3.2 压测与帧率实测记录（2026-11-17）

测试环境：单进程 Node.js + Windows 本地 + 独立 SQLite 文件（`DB_PATH=data/stress.db`）。

```bash
# 后端 10 房间 × 30 人压测
DB_PATH=data/stress.db PORT=3011 node server/index.js
node scripts/stress.mjs --url http://localhost:3011 --db data/stress.db --users 300 --rooms 10 --seconds 60 --action-ms 4000

# 浏览器 30 人同房帧率实测（聚团测试）
node scripts/stress.mjs --url http://localhost:3003 --users 29 --rooms 1 --seconds 180 --cluster
npm run fps
```

| 场景 | 在线/连接 | `players` 广播 | HTTP 延迟 & 错误 | 写库吞吐 |
| --- | --- | --- | --- | --- |
| **A. 生产节奏**（4s/动作） | 300/300，握手 p95 672ms | p50 1.00s / p95 1.01s，下行 1.6 MB/s，0 断线 | 83 rps，业务 p95 < 61ms，0% 错误 | 65 次/s（约 425 MB / 30s） |
| **B. 极限点击**（0.6s/动作） | 300/300 | p50 1.14s / p95 1.48s | 217 rps，端到端 p50 劣化至 **8.0–8.6s** | **182 次/s**（打满单进程上限） |

- **后端瓶颈结论**：早先压测（2026-11-17）瓶颈在于每次 `run()` 同步导出全库写盘（上限 ≈ 180–190 写/秒）；现 `server/db.js` 已改为 `scheduleSave()` **400ms 节流异步原子落盘**以消除逐次阻塞事件循环，但超高并发写入仍需切换 `better-sqlite3`（WAL 增量写）或对高频写操作做批处理。
- **前端帧率结论**：`scripts/profile-test.mjs` 定位业务 JS 仅占 CPU 0.8%，瓶颈在 WebGL draw call；经 `Player.js` 几何合并后，30 人同房平均帧率由 36.3 FPS 升至 ~51 FPS；此后 `ProceduralStreet.js` 已完成极简化与全街按材质合并，30 人同房实测表现可基于最新版代码复测。

---

## 4. 后端架构与通信协议

### 4.1 数据持久化与 MySQL 迁移路径

- **默认存储**：`sql.js`（SQLite WASM，零编译依赖），文件位于 `data/qingguo.db`；私聊记录单独以 **O(1) JSONL 追加写**存放在 `data/messages.jsonl`，崩溃不损历史。
- **无损迁移 MySQL 预留**：
  1. 建表类型与常规查询采用标准 SQL（无 `AUTOINCREMENT`），仅 `capital.js` / `treasure.js` / `crowd.js` / `quests.js` 少量 upsert 使用了 `INSERT OR REPLACE` 或 `ON CONFLICT(...) DO UPDATE`（迁 MySQL 时统一替换为 `ON DUPLICATE KEY UPDATE`）。
  2. 所有业务模块统一通过 `server/db.js` 导出的 `run(sql, params)` / `query(sql, params)` 访库。
  3. 已预置 `node server/migrate-to-mysql.js` 迁移脚本，后续在 `db.js` 实现 `mysql2` 分支并通过显式环境变量 `USE_MYSQL=true` 切换即可（当前 MySQL 分支尚未实现）。

### 4.2 WebSocket 协议（`/chat?room=N`）

JSON 消息格式：`{ "type": "...", "payload": { ... } }`

| type | 方向 | payload | 说明 |
| --- | --- | --- | --- |
| `hello` | C→S | `{ token }` | 鉴权握手与入房（满 30 人返回 `room-full` 并关闭） |
| `position` | C→S | `{ x, z, yaw, scene?, shopId?, moving?, sprinting? }` | 位置 + 场景归属 + 动作状态上报（同步给同房间玩家；`scene='interior'` 时 `shopId` 需在资产白名单内） |
| `global_chat` | C→S | `{ text }` | **全服广场发言**（3s 限频，`dnd` 模式下禁言） |
| `global_msg` | S→C | `{ id, from, text, ts }` | **全服广场广播**（全服在线连接接收） |
| `dm` | C→S / S→C | `{ to, text }` / `{ from, to, text, ts }` | 一对一私聊（仅回显收发双方） |
| `dm_history` | C→S / S→C | `{ with, limit }` / `{ with, messages }` | 拉取双人私聊历史 |
| `block` / `unblock` | C→S | `{ to }` | 拉黑 / 解除拉黑 |
| `dnd` | C→S / S→C | `{ enabled }` | 「不想说话」勿扰开关（同时禁用私聊与广场发言） |
| `counter_offer` | C→S | `{ attackId, price }` | 踢馆防守方发起一次性还价 |
| `counter_reply` | C→S | `{ attackId, accept }` | 踢馆攻击方同意或拒绝还价 |
| `welcome` | S→C | `{ self, room, online, globalHistory, blocked, dnd }` | 握手成功回执（含房间号与最近 30 条广场历史） |
| `players` | S→C | `[{ id, nickname, variant, title, x, z, yaw, scene, shopId, moving, sprinting }]` | 1Hz 推送**本房间**玩家位置、场景归属、动作状态与称号 |
| `blocked` | S→C | `{ blocked: [id] }` | 拉黑列表变更回执 |
| `shop_attack` | S→C | `{ attackId, shopId, shopName, attackerId, attackerNick, bid, defendCost, counterMin, counterMax, expiresAt }` | **被踢馆警报**（仅发原店主，跨房可达） |
| `counter_pending` / `counter_ack` / `counter_rejected` / `counter_reply_ack` | S→C | — | 议价状态同步回执 |
| `shop_attack_result` | S→C | `{ attackId, outcome, message, settledPrice, ... }` | 踢馆结算通知（攻防双方） |
| `battle` | S→C | `{ id, nickname, content, ts }` | **全服战报**（跨所有房间广播） |
| `top1` | S→C | `{ userId, nickname, title, wealth }` | **首富易主**（跨所有房间广播） |
| `error` | S→C | `{ msg, code }` | 如 `blocked`、`room-full`、`counter-error`、`global-error` |

> **私聊与广场发起方式**：私聊消息仅回显给收发双方。除可在街道上走近对方（4 米内）点击其 3D 角色快捷发起私聊外，**也可直接在 Tab 聊天面板的在线列表中点选任意在线玩家发起私聊**（不限距离与室内外场景）。

### 4.3 HTTP REST 路由表

需鉴权接口携带请求头 `Authorization: Bearer <token>`。

| 模块 | 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- | --- |
| **基础** | GET | `/api/health` | 公开 | `{ ok, time, players }` |
| | POST | `/api/auth/register` / `login` | 公开 | 注册 / 登录（bcryptjs + JWT） |
| | GET | `/api/me` | 登录 | 当前用户信息 |
| | GET | `/api/chat/rooms` | 公开 | 1–10 号房在线人数与容量 |
| **商铺** | GET | `/api/shops` / `/:id/products` | 公开 | 18 家可进店商铺与商品清单 |
| | GET/POST | `/api/orders/my` / `/api/orders` | 登录 | 查询我的历史订单 / 扣款下单 |
| **游戏核心** | GET | `/api/game/state` | 登录 | 全量游戏状态唯一数据源（资产/分红/踢馆/首富/任务/轮回） |
| | GET | `/api/game/profile/:userId` | 登录 | 指定玩家公开资料卡（不含现金余额） |
| | POST | `/api/game/acquire` / `upgrade` | 登录 | 收购无主店 / 豪华装修（最高 5 级） |
| | POST | `/api/game/attack` / `defend` / `surrender` | 登录 | 发起踢馆 / 强力护盘 / 认栽 |
| | GET | `/api/game/battles` / `leaderboard` | 公开/登录 | 最近 40 条战报 / 首富榜 Top 10 |
| **经济与成长** | POST | `/api/game/intro/grant` | 登录 | 新人逆袭引导一次性空投 ¥5000 万（幂等） |
| | POST | `/api/game/worship` | 登录 | 膜拜全服首富领红包 `{ userId }` |
| | POST | `/api/game/collect` / `bully` / `dividend` | 登录 | 拾取金币/宝箱、碰瓷 NPC、领离线分红 |
| | POST | `/api/game/teleport` | 登录 | 地图模式点击传送（每次扣除 ¥10 万） |
| | GET/POST | `/api/game/quests` / `claim` / `walked` | 登录 | 查询任务、领奖、上报步行距离 |
| | POST | `/api/game/prestige` / `talents` | 登录 | 资本轮回 / 升级永久天赋 |
| **众筹** | GET/POST | `/api/crowd/list` / `create` / `invest` / `claim` | 登录 | 众筹项目列表、发起、入股、领分红 |
| **公告与后台** | GET | `/api/announcements` | 公开 | 启用中的系统公告 |
| | CRUD | `/api/admin/announcements` | 管理员 | 公告增删改 |
| | GET/POST | `/api/admin/users` / `ban-chat` / `unban-chat` | 管理员 | 用户列表与禁言管理 |

### 4.4 管理员后台（`/admin.html`）

- 默认种子账号：`admin` / `admin123`（首次启动自动创建，**上线前务必通过 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_USERS` 覆盖**）。
- 管理员 Token 存在 `localStorage.qingguo_admin_token`，与玩家 `sessionStorage` 隔离。

---

## 5. 多房间分流 × 全服统一世界

为避免单房间玩家过多（>60 人）引发前端 Sprite 渲染与广播雪崩，系统采用 **「场景分房渲染，世界全局唯一」** 架构：

```
          ┌──────────────────────────────────────────────┐
          │            全局唯一世界状态层（SQLite）        │
          │  shops归属 / 5分钟冷却 / pending踢馆 / 战报    │
          └──────────┬────────────────────────┬──────────┘
                     │                        │
         ┌───────────▼──────────┐  ┌──────────▼───────────┐
         │ 房间 3 (≤30 人)      │  │ 房间 5 (≤30 人)       │
         │ /chat?room=3         │  │ /chat?room=5          │
         │ 1Hz 仅推本房 players  │  │ 1Hz 仅推本房 players   │
         │ 全局接收 battle/top1  │  │ 全局接收 battle/top1   │
         └──────────────────────┘  └──────────────────────┘
```

### 四层不变量

1. **店铺不复制**：18 家可收购资产全服唯一，不因房间号翻倍，保证稀缺度与 PvP 价值。
2. **归属全服一致**：`/api/game/state` 不包含房间字段，所有房间看到的店主、等级与保护期完全同步。
3. **踢馆全局互斥**：不同房间玩家争夺同一家店时，先到先得，后者收到「正在被争夺中」。
4. **事件跨房广播**：`shop_attack` 跨房直达原店主；`battle` 与 `top1` 全服广播，全服共享吃瓜体验。

### 扩容演进顺序（房间 vs 世界分片）

- **当前已实现（房间 Room）**：1–10 号房，每房 ≤ 30 人，只拆分位置广播，前端记忆 `localStorage.qingguo_room` 并提供顶栏切房弹窗。
- **未来大规模并发（世界分片 Sharding）**：若全服同时在线远超 300 人，才需要按「每 30–50 人一套独立数据库/18 家店」做分片（跨分片互不干扰），而不是把同一世界内的房间店铺复制多份。

---

## 6. 并发安全与权威后端防作弊

### 6.1 踢馆与收购并发安全

- 当前单进程以内存 `pending: Map<shopId, attackId>` 作为快路径拦截，并配合 SQLite 单写串行特性保证原子性。
- 未来若使用 PM2 cluster 或多实例水平扩展，必须把互斥锁迁移至 Redis 分布式锁，并在 MySQL 事务中配合行锁（`FOR UPDATE SKIP LOCKED`）防止双花或重复建单。

### 6.2 权威后端防作弊（Server-Authoritative）

**前端只负责表现，一切金额、概率、冷却均由服务端计算。**

| 绝不信任前端 | 后端校验点 |
| --- | --- |
| 金币/宝箱奖励金额 | `treasure.collect()` 服务端随机生成，忽略客户端传参 |
| 每秒收租结算 | `economy.settle()` 按服务端时间戳惰性结算 |
| 收购/装修扣款 | SQL 带条件扣款 `WHERE id = ? AND balance >= price`，忽略请求体价格 |
| 踢馆出价与护盘费 | 按 `shared/assets.js` 公式在服务端计算 |
| 冷却与保护期剩余时间 | 落库 `shop_cooldowns` 与 `users.last_coin_at` / `last_box_at` 验证 |

- **可信任的有限输入**：玩家移动坐标 `{ x, z, yaw }`（仅用于视觉同步）、步行距离上报 `{ meters }`（单次截断 `Math.min(delta, 300)` 且任务完成即封顶）。

---

## 7. 接入真实 GLB 模型

### A. 按建筑逐栋替换（推荐）

1. 将模型放入 `public/models/`（如 `cafe.glb`）。
2. 在 `src/data/layout.js` 对应条目增加 `model: 'cafe.glb'`；或按 `<id>.glb` 命名后访问 `?models=/models` 自动批量匹配。
3. 模型立面需朝 `-x`（北侧）/ `+x`（南侧），默认等比缩放到 `d × w × (h + 1.2)` 并居中贴地（加 `modelFit: 'none'` 可关闭自动适配）。
4. 后台异步替换网格与碰撞体，保留原有店招、触发圈与可收购绑定；若 404/解析失败自动保留程序化建筑。
   > ⚠️ **合批时机提醒**：由于当前程序化街道默认会调用 `mergeStreetGeometries()` 合并静态网格，开启逐栋 GLB 替换时需保证模型替换在合并前完成或跳过对应栋合批。

### B. 整场景替换（`?glb=`）

访问 `http://localhost:5177/?glb=/models/street.glb`（支持 Draco 压缩）。模型命名含 `ground/floor/road` 自动识别地面，含 `wall/building/shop` 自动生成碰撞体，含 `shop_<id>` 或 `userData.shopId` 自动绑定店铺。失败时自动回退至程序化街道。

---

## 8. 已知技术限制

- **无美术资产与触屏适配**：仓库未附带 `.glb` 与贴图；操作依赖桌面键盘与 Pointer Lock。
- **远端玩家同步范围**：已支持同店室内同场景（`scene/shopId` + 确定性房间原点）与走路/奔跑摆臂（`moving/sprinting`）；仍为 2s 一次位置上报 + 1Hz 广播，未同步跳跃、表情和上半身动作，瞬时动作（如踢馆演出）仍以本地表现为主。
- **单机 SQLite 写锁**：`sql.js` 现为 400ms 节流异步全量快照落盘，仍勿多进程并发写同一 `.db` 文件（压测需用 `DB_PATH` 隔离）；早先同步落盘基准上限 ~180–190 次/s。
- **多人同屏帧率待复测**：角色合批后 30 人同房约 ~51 FPS；现 `ProceduralStreet.js` 已简化建筑体块并全街按材质合并，可基于当前版本复测 30 人同房帧率表现。
- **前端拾取与局部状态**：金币雨掉落位置由前端触发（奖励仍由后端生成防篡改）；秘书人设与静音配置仅存在浏览器 `localStorage`。