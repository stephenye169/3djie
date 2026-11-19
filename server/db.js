/**
 * 持久化层（默认 SQLite / 预留 MySQL 开关）
 *
 * 默认：sql.js WASM 版本，零编译，适合本地开发
 * 切换 MySQL（需要时）：
 *   1. npm install mysql2
 *   2. 设环境变量 USE_MYSQL=true，以及 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *   3. 运行 node server/migrate-to-mysql.js 迁移数据（可选）
 *   4. 取消下方 USE_MYSQL 分支的注释，实现 mysql2 版 run/query
 *
 * 统一 API 层（auth.js / chat.js / index.js 只依赖这些）：
 *   run(sql, params)       执行写操作
 *   query(sql, params)     查询，返回对象数组
 *   appendMessage / messagesBetween  JSONL 私聊历史（与数据库解耦，MySQL 模式下继续用）
 */
import initSqlJs from 'sql.js';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 切换条件：只认显式 true，不认空值或其他字符串（经验告诫：不要用环境变量存在性误触发）
const USE_MYSQL = process.env.USE_MYSQL === 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'qingguo.db');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.jsonl');

let _db = null;        // sql.js Database 或 mysql2 Connection
let _SQL = null;       // sql.js module（SQLite 模式）
let _initPromise = null; // initDb() 幂等：auth.js / index.js 会各调一次

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

let _saveTimer = null;
let _dirty = false;
let _writing = false;
let _hooksRegistered = false;

/** 立即同步落盘（初始化 / 进程退出时使用，写临时文件后原子替换） */
export function flushDbSync() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (!_db || !_SQL) return;
  _dirty = false;
  ensureDirs();
  const buf = Buffer.from(_db.export());
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, buf);
  try {
    fs.renameSync(tmpPath, DB_PATH);
  } catch {
    // Windows 目标文件被杀毒/编辑器短暂占用时兜底直写
    fs.writeFileSync(DB_PATH, buf);
    try { fs.unlinkSync(tmpPath); } catch { /* 忽略 */ }
  }
}

async function _flushAsync() {
  if (!_db || !_SQL) return;
  if (_writing) {
    _dirty = true;
    return;
  }
  _writing = true;
  _dirty = false;
  try {
    ensureDirs();
    const buf = Buffer.from(_db.export());
    const tmpPath = `${DB_PATH}.tmp`;
    await fs.promises.writeFile(tmpPath, buf);
    try {
      await fs.promises.rename(tmpPath, DB_PATH);
    } catch {
      await fs.promises.writeFile(DB_PATH, buf);
      try { await fs.promises.unlink(tmpPath); } catch { /* 忽略 */ }
    }
  } catch (err) {
    console.warn('[db] 异步落盘失败:', err.message);
    _dirty = true;
  } finally {
    _writing = false;
    if (_dirty) scheduleSave();
  }
}

/** 节流异步落盘：避免每次 run() 同步全库 export + writeFileSync 阻塞事件循环 */
function scheduleSave() {
  if (!_db || !_SQL) return;
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    _flushAsync();
  }, 400);
}

function registerShutdownHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;
  const onSignal = () => {
    try { flushDbSync(); } catch { /* 忽略 */ }
    process.exit(0);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('beforeExit', () => {
    try { flushDbSync(); } catch { /* 忽略 */ }
  });
}

// ============ 启动初始化 ============

export function initDb() {
  if (!_initPromise) _initPromise = _init();
  return _initPromise;
}

async function _init() {
  if (USE_MYSQL) {
    throw new Error(
      'USE_MYSQL=true 但 MySQL 实现未就绪。' +
      '请先在 db.js 底部的 "// ============ MySQL 分支（未来启用） ============" 区域实现 mysql2 连接，' +
      '或去掉 USE_MYSQL 环境变量使用默认 SQLite。'
    );
  }

  // ---- MySQL 分支（未来启用时取消注释并实现） ----
  /*
  const mysql = await import('mysql2/promise').then(m => m.default);
  _db = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'qingguo',
  });
  // MySQL 版本的 run/query 实现见下方
  */

  // ---- SQLite 默认分支 ----
  ensureDirs();
  const SQL = await initSqlJs();
  _SQL = SQL;

  let db;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }
  _db = db;

  // exec() 支持多条分号分隔的 SQL，prepare 只支持单条
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      username    TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      nickname    TEXT NOT NULL,
      variant     TEXT NOT NULL,
      balance     INTEGER NOT NULL DEFAULT 500,
      chat_banned INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      title           TEXT NOT NULL DEFAULT '街头路人甲',
      income_per_sec  REAL NOT NULL DEFAULT 0,
      last_tick       INTEGER NOT NULL DEFAULT 0,
      total_earned    REAL NOT NULL DEFAULT 0,
      rebirth_count   INTEGER NOT NULL DEFAULT 0,
      black_card_points INTEGER NOT NULL DEFAULT 0,
      talents_json    TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS shops (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL,
      emoji       TEXT,
      description TEXT,
      layout_z    REAL,
      side        INTEGER,
      active      INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS products (
      id          TEXT PRIMARY KEY,
      shop_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      price       INTEGER NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      kind        TEXT NOT NULL DEFAULT 'daily',
      buff        TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS orders (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      product_id  TEXT NOT NULL,
      qty         INTEGER NOT NULL,
      paid        INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id          TEXT PRIMARY KEY,
      blocker_id  TEXT NOT NULL,
      blocked_id  TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS player_shops (
      user_id     TEXT NOT NULL,
      shop_id     TEXT NOT NULL,
      level       INTEGER NOT NULL DEFAULT 1,
      acquired_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, shop_id)
    );
    CREATE TABLE IF NOT EXISTS battle_logs (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      nickname    TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop_attacks (
      id          TEXT PRIMARY KEY,
      shop_id     TEXT NOT NULL,
      attacker_id TEXT NOT NULL,
      defender_id TEXT NOT NULL,
      bid         REAL NOT NULL,
      defend_cost REAL NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS npc_claims (
      user_id    TEXT NOT NULL,
      npc_id     TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, npc_id)
    );
    CREATE TABLE IF NOT EXISTS shop_cooldowns (
      shop_id  TEXT PRIMARY KEY,
      cool_until INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quest_progress (
      user_id  TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      claimed  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, quest_id)
    );
    CREATE TABLE IF NOT EXISTS intro_grants (
      user_id    TEXT PRIMARY KEY,
      amount     INTEGER NOT NULL,
      granted_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worship_logs (
      user_id  TEXT PRIMARY KEY,
      last_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transaction_logs (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      amount     INTEGER NOT NULL,
      note       TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crowd_projects (
      id            TEXT PRIMARY KEY,
      shop_id       TEXT NOT NULL,
      owner_id      TEXT NOT NULL,
      target        REAL NOT NULL,
      raised        REAL NOT NULL DEFAULT 0,
      dividend_pool REAL NOT NULL DEFAULT 0,
      last_pool_at  INTEGER NOT NULL,
      deadline      INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    INTEGER NOT NULL,
      settled_at    INTEGER
    );
    CREATE TABLE IF NOT EXISTS crowd_shares (
      project_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      amount       REAL NOT NULL,
      claimed_pool REAL NOT NULL DEFAULT 0,
      invested_at  INTEGER NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      discount   REAL NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user_prod_ts ON orders(user_id, product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id, blocked_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id, blocker_id);
    CREATE INDEX IF NOT EXISTS idx_tx_user_ts ON transaction_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_battle_ts ON battle_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_crowd_shares_user ON crowd_shares(user_id);
    CREATE INDEX IF NOT EXISTS idx_coupons_user ON coupons(user_id, used_at, expires_at);
  `);

  registerShutdownHooks();
  _migrateV1();   // 老库补 chat_banned 字段（幂等，跑过一次后再跑也是 no-op）
  _grantStartupCapital(); // 必须在 _migrateV2 之前：靠 last_tick 列是否存在判断是否首发

  _migrateV2();   // 老库补游戏数值字段（幂等）

  _migrateV3();   // 老库补金币拾取 / 家族分红时间戳（幂等）

  _migrateV4();   // 店铺消费流水 / 订单转售字段（幂等）
  _seedShops();
  await _seedAdmin();
  _seedAnnouncements();
  flushDbSync();
  return db;
}

export function getDb() {
  if (!_db) throw new Error('DB not initialized. Call initDb() first.');
  return _db;
}

// ============ 运行时统一 API 层 ============
//
// 上层（auth.js / chat.js / index.js）只调用 run() / query() / findUserById() 等
// 这意味着：未来切 MySQL 时，只需替换 run() 和 query() 的内部实现，上层一行都不用改

/** 执行写操作（INSERT / UPDATE / DELETE） */
export function run(sql, params = []) {
  if (USE_MYSQL) {
    // MySQL 版本：await _db.execute(sql, params)，然后 return result
    throw new Error('USE_MYSQL=true 但 MySQL run() 未实现');
  }
  // SQLite 版本
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) { /* 消费结果 */ }
  stmt.free();
  scheduleSave();
}

/** 查询，返回对象数组 */
export function query(sql, params = []) {
  if (USE_MYSQL) {
    // MySQL 版本：const [rows] = await _db.execute(sql, params); return rows;
    throw new Error('USE_MYSQL=true 但 MySQL query() 未实现');
  }
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ============ 用户表快捷方法 ============

export function findUserByUsername(username) {
  const rows = query('SELECT * FROM users WHERE username = ?', [username]);
  return rows[0] || null;
}

export function findUserById(id) {
  const rows = query(
    `SELECT id, username, nickname, variant, balance, chat_banned, created_at,
            title, income_per_sec, rebirth_count, black_card_points, talents_json
     FROM users WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

export function listUsersForAdmin() {
  return query(
    'SELECT id, username, nickname, variant, balance, chat_banned, created_at FROM users ORDER BY created_at DESC'
  );
}

export function setChatBanned(userId, banned) {
  run('UPDATE users SET chat_banned = ? WHERE id = ?', [banned ? 1 : 0, userId]);
}

export function insertUser(user) {
  run(
    `INSERT INTO users (id, username, password, nickname, variant, balance, created_at, last_tick)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.username, user.password, user.nickname, user.variant, user.balance || 500, user.created_at, user.created_at]
  );
}

/** 给用户加余额，返回新余额 */
export function addBalance(userId, delta) {
  run('UPDATE users SET balance = balance + ? WHERE id = ?', [delta, userId]);
  const rows = query('SELECT balance FROM users WHERE id = ?', [userId]);
  return rows[0]?.balance ?? null;
}

/**
 * 原子扣减余额：WHERE 条件校验 balance >= amount，防止并发请求把余额扣成负数。
 * @returns {boolean} 是否扣款成功
 */
export function deductBalance(userId, amount) {
  if (USE_MYSQL) {
    throw new Error('USE_MYSQL=true 但 MySQL deductBalance() 未实现');
  }
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return false;
  if (n === 0) return true;
  const stmt = _db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?');
  stmt.bind([n, userId, n]);
  while (stmt.step()) { /* 消费结果 */ }
  stmt.free();
  const ok = _db.getRowsModified() > 0;
  if (ok) scheduleSave();
  return ok;
}

// ============ 黑名单（拉黑） ============

/** 我拉黑的人 */
export function listBlockedIds(userId) {
  return query('SELECT blocked_id FROM blocks WHERE blocker_id = ?', [userId]).map((r) => r.blocked_id);
}

/** 双方任一拉黑即视为不能聊天 */
export function isBlockedEither(a, b) {
  const rows = query(
    `SELECT id FROM blocks
     WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    [a, b, b, a]
  );
  return rows.length > 0;
}

export function addBlock(blockerId, blockedId) {
  if (blockerId === blockedId) return false;
  const exists = query(
    'SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?',
    [blockerId, blockedId]
  );
  if (exists.length > 0) return false;
  run(
    'INSERT INTO blocks (id, blocker_id, blocked_id, created_at) VALUES (?, ?, ?, ?)',
    [randomId(), blockerId, blockedId, Date.now()]
  );
  return true;
}

export function removeBlock(blockerId, blockedId) {
  run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId]);
}

// ============ 系统公告 ============

export function listAnnouncements(activeOnly = false) {
  const sql = activeOnly
    ? 'SELECT * FROM announcements WHERE active = 1 ORDER BY updated_at DESC'
    : 'SELECT * FROM announcements ORDER BY updated_at DESC';
  return query(sql);
}

export function getAnnouncement(id) {
  return query('SELECT * FROM announcements WHERE id = ?', [id])[0] || null;
}

export function insertAnnouncement({ title, content, active = 1 }) {
  const now = Date.now();
  const id = randomId();
  run(
    'INSERT INTO announcements (id, title, content, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, title, content, active ? 1 : 0, now, now]
  );
  return getAnnouncement(id);
}

export function updateAnnouncement(id, { title, content, active }) {
  const current = getAnnouncement(id);
  if (!current) return null;
  run(
    'UPDATE announcements SET title = ?, content = ?, active = ?, updated_at = ? WHERE id = ?',
    [
      title ?? current.title,
      content ?? current.content,
      active === undefined ? current.active : (active ? 1 : 0),
      Date.now(),
      id,
    ]
  );
  return getAnnouncement(id);
}

export function deleteAnnouncement(id) {
  run('DELETE FROM announcements WHERE id = ?', [id]);
}

// ============ 聊天消息 JSONL 落盘（与数据库解耦，MySQL 模式下继续用） ============

const DM_CACHE_MAX_PER_PAIR = 500;
let _dmCache = null; // Map<pairKey, Array<{ from, to, text, ts }>>
let _msgWriteChain = Promise.resolve();

function _dmPairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function _pushDmCache(entry) {
  if (!_dmCache || entry?.scope !== 'dm' || !entry?.from?.id || !entry?.to) return;
  const key = _dmPairKey(entry.from.id, entry.to);
  let list = _dmCache.get(key);
  if (!list) {
    list = [];
    _dmCache.set(key, list);
  }
  list.push({ from: entry.from, to: entry.to, text: entry.text, ts: entry.ts });
  if (list.length > DM_CACHE_MAX_PER_PAIR) list.shift();
}

function _ensureDmCache() {
  if (_dmCache) return _dmCache;
  _dmCache = new Map();
  if (!fs.existsSync(MESSAGES_PATH)) return _dmCache;
  const lines = fs.readFileSync(MESSAGES_PATH, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    _pushDmCache(m);
  }
  return _dmCache;
}

export function appendMessage(entry) {
  _pushDmCache(entry);
  _msgWriteChain = _msgWriteChain
    .then(() => {
      ensureDirs();
      return fs.promises.appendFile(MESSAGES_PATH, JSON.stringify(entry) + '\n', 'utf8');
    })
    .catch((err) => console.warn('[db] 私聊消息写入失败:', err.message));
}

/** 两人之间的私聊记录（懒加载内存缓存，避免每次拉历史阻塞读取整份 JSONL） */
export function messagesBetween(userA, userB, limit = 200) {
  const cache = _ensureDmCache();
  const list = cache.get(_dmPairKey(userA, userB));
  if (!list || !list.length) return [];
  return list.slice(-limit);
}

// ============ shops 种子数据 ============

function _seedShops() {
  const seed = [
    ['cafe',    '街角咖啡',  '咖啡饮品',  '☕',  '巷口老牌咖啡馆，现磨意式'],
    ['bakery',  '麦香面包房','面包甜品',  '🥐',  '每日凌晨烘焙的可颂与麻薯'],
    ['bookstore','时光书店', '零售书店',  '📚',  '古籍与新刊共处的小书店'],
    ['flower',  '花语花坊',  '鲜花零售',  '💐',  '巷尾最香的花坊'],
    ['tech',    '极客数码',  '数码配件',  '💻',  '耳机、键盘、鼠标一应俱全'],
    ['wonton',  '巷口馄饨铺','街边小吃',  '🍜',  '开了三十年的老馄饨铺'],
    ['teahouse','青果茶肆',  '茶馆茶饮',  '🍵',  '临河茶肆，一壶绿茶消磨半日'],
    ['dessert', '糖芋苗小铺','甜品糖水',  '🍡',  '常州糖芋苗与酒酿圆子'],
    ['milktea', '东牌坊奶茶铺','奶茶饮品',  '🧋',  '牌坊下第一家奶茶铺，黑糖珍珠现煮'],
    ['chenghuang','阳湖县城隍庙戏楼','戏曲演出','🎭','一百多年的老戏楼，周末连唱两场'],
    ['memory',  '青果巷文化记忆馆','文化展馆','🏛','以巷名界碑为镇馆之宝的小展馆'],
    ['songjiantang','松健堂', '书斋茶室','🌿','五进老宅改的书斋，收字画旧家具'],
    ['zhaoyuanren','赵元任故居','名人故居','🎼','语言学家赵元任旧居，琴房存有老钢琴'],
    ['yunhongyi','恽鸿仪故居 · 可园','园林','🏯','三亩宅园，廊子绕、假山旧'],
    ['baguitang','八桂堂总部','商业会馆','🏦','刘国钧旧宅，如今的街区总部'],
    ['banyuan', '半园庄园', '园林庄园','🌸','一半是园、一半让给街坊的宅园'],
    ['lihetang','礼和堂会所','会所文化','📖','周氏旧宅，三楼是周有光图书馆'],
    ['finance', '西入口金融中心','金融总部','🏙','整条街的资金流水都从这里过'],
  ];
  const layouts = {
    cafe: { layout_z: -321, side:  1 },
    bakery: { layout_z: -352, side:  1 },
    bookstore:{ layout_z: -214, side:  1 },
    flower: { layout_z: -318, side: -1 },
    tech: { layout_z: -440, side:  1 },
    wonton: { layout_z: -293, side:  1 },
    teahouse: { layout_z: -150, side: -1 },
    dessert: { layout_z: -262, side:  1 },
    milktea: { layout_z: -12, side:  1 },
    chenghuang: { layout_z: -45, side:  1 },
    memory: { layout_z: -72, side:  1 },
    songjiantang: { layout_z: -155, side:  1 },
    zhaoyuanren: { layout_z: -185, side:  1 },
    yunhongyi: { layout_z: -338, side:  1 },
    baguitang: { layout_z: -386, side:  1 },
    banyuan: { layout_z: -413, side:  1 },
    lihetang: { layout_z: -440, side: -1 },
    finance: { layout_z: -10, side: -1 },
  };
  // 按 id 补缺：老库已有店铺不会被重复插入，新增店铺也能追加上
  const existing = new Set(query('SELECT id FROM shops').map((r) => r.id));
  for (const [id, name, cat, emoji, desc] of seed) {
    if (existing.has(id)) continue;
    const l = layouts[id];
    run(
      'INSERT INTO shops (id, name, category, emoji, description, layout_z, side) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, cat, emoji, desc, l.layout_z, l.side]
    );
  }

  // 商品种子：三类商品体系（daily 日常临时增益 / boost 功能长效增益 / permit 收购资格材料）。
  // buff 编码 'type:ms:mult'；老库已有商品按名称映射补 kind/buff/price（量级拉齐），新商品（permit 等）追加插入。
  // 价格量级对齐主货币：daily ≈ 一次金币拾取（3~8 万），boost ≈ 5~10 次拾取（10~40 万），
  // permit ≈ 早期玩家半小时收入（20~80 万），tier2 双证 110 万 ≈ 收购价 2000 万的 5.5%
  const productSeed = [
    // milktea 东牌坊奶茶铺（tier1 日常）
    ['milktea', '黑糖珍珠鲜奶', 30000, 1, 'daily', 'speed:60000:1.35'],
    ['milktea', '桂花乌龙', 24000, 2, 'daily', 'crit:120000:0.12'],
    ['milktea', '芋泥啵啵', 32000, 3, 'daily', 'magnet:120000:1.6'],
    // wonton 巷口馄饨铺
    ['wonton', '鲜肉小馄饨', 24000, 1, 'daily', 'magnet:120000:1.6'],
    ['wonton', '大排面', 44000, 2, 'daily', 'speed:60000:1.35'],
    // cafe 街角咖啡
    ['cafe', '美式咖啡', 36000, 1, 'daily', 'speed:60000:1.35'],
    ['cafe', '拿铁', 44000, 2, 'daily', 'crit:120000:0.12'],
    ['cafe', '提拉米苏', 64000, 3, 'daily', 'magnet:120000:1.6'],
    // teahouse 青果茶肆
    ['teahouse', '雨前绿茶', 96000, 1, 'boost', 'income:600000:1.25'],
    ['teahouse', '茶点拼盘', 56000, 2, 'daily', 'magnet:120000:1.6'],
    // bakery 麦香面包房
    ['bakery', '可颂', 16000, 1, 'daily', 'crit:120000:0.12'],
    ['bakery', '麻薯一盒', 30000, 2, 'daily', 'magnet:120000:1.6'],
    // dessert 糖芋苗小铺
    ['dessert', '桂花糖芋苗', 30000, 1, 'daily', 'crit:120000:0.12'],
    ['dessert', '藕粉圆子', 36000, 2, 'daily', 'magnet:120000:1.6'],
    // flower 花语花坊
    ['flower', '向日葵一束', 70000, 1, 'daily', 'speed:60000:1.35'],
    ['flower', '花环礼盒', 136000, 2, 'boost', 'coinUp:600000:1.30'],
    // bookstore 时光书店（tier2：信誉章产地）
    ['bookstore', '街区信誉章', 300000, 1, 'permit', ''],
    ['bookstore', '经营之道', 176000, 2, 'boost', 'income:600000:1.25'],
    ['bookstore', '青果巷志', 96000, 3, 'daily', 'magnet:120000:1.6'],
    // tech 极客数码（tier2 功能商品）
    ['tech', '信号增强器', 198000, 1, 'boost', 'magnet:600000:1.6'],
    ['tech', '云算力卡', 318000, 2, 'boost', 'coinUp:600000:1.30'],
    ['tech', '耳机', 398000, 3, 'daily', 'speed:60000:1.35'],
    // chenghuang 城隍庙戏楼（tier2）
    ['chenghuang', '茶水瓜子', 40000, 1, 'daily', 'crit:120000:0.12'],
    ['chenghuang', '戏楼后排票', 160000, 2, 'boost', 'income:600000:1.25'],
    ['chenghuang', '戏楼前排票', 360000, 3, 'boost', 'coinUp:600000:1.30'],
    // memory 文化记忆馆（tier2：装修图纸产地）
    ['memory', '装修图纸', 200000, 1, 'permit', ''],
    ['memory', '记忆馆门票', 40000, 2, 'daily', 'magnet:120000:1.6'],
    ['memory', '明信片一套', 50000, 3, 'daily', 'crit:120000:0.12'],
    // songjiantang 松健堂（tier3）
    ['songjiantang', '松健堂香囊', 90000, 1, 'daily', 'speed:60000:1.35'],
    ['songjiantang', '手抄字帖', 136000, 2, 'boost', 'income:600000:1.25'],
    ['songjiantang', '旧书一册', 240000, 3, 'boost', 'coinUp:600000:1.30'],
    // zhaoyuanren 赵元任故居（tier3：稀有材料产地）
    ['zhaoyuanren', '《教我如何不想她》曲谱', 80000, 1, 'daily', 'crit:120000:0.12'],
    ['zhaoyuanren', '黑胶唱片', 600000, 2, 'permit', ''],
    ['zhaoyuanren', '故居门票', 50000, 3, 'daily', 'magnet:120000:1.6'],
    // yunhongyi 可园（tier3）
    ['yunhongyi', '园中茶席', 176000, 1, 'boost', 'income:600000:1.25'],
    ['yunhongyi', '太湖石摆件', 640000, 2, 'boost', 'coinUp:600000:1.30'],
    ['yunhongyi', '可园门票', 60000, 3, 'daily', 'magnet:120000:1.6'],
    // baguitang 八桂堂（tier4）
    ['baguitang', '八桂堂会席', 2400000, 1, 'boost', 'income:600000:1.25'],
    ['baguitang', '家宴定制', 1760000, 2, 'boost', 'coinUp:600000:1.30'],
    // banyuan 半园（tier4）
    ['banyuan', '半园茶会', 336000, 1, 'boost', 'income:600000:1.25'],
    ['banyuan', '桂花酿', 196000, 2, 'daily', 'speed:60000:1.35'],
    // lihetang 礼和堂会所（tier4：税务合规书产地）
    ['lihetang', '税务合规书', 500000, 1, 'permit', ''],
    ['lihetang', '图书借阅卡', 400000, 2, 'daily', 'magnet:120000:1.6'],
    ['lihetang', '雪茄吧单次', 760000, 3, 'daily', 'crit:120000:0.12'],
    // finance 金融中心（tier4：商业许可证产地）
    ['finance', '商业许可证', 800000, 1, 'permit', ''],
    ['finance', '财富管理咨询', 4000000, 2, 'boost', 'income:600000:1.25'],
    ['finance', '保险箱年租', 2400000, 3, 'daily', 'magnet:120000:1.6'],
  ];
  for (const [shopId, name, price, sortOrder, kind, buff] of productSeed) {
    const existing = query(
      'SELECT id FROM products WHERE shop_id = ? AND name = ?',
      [shopId, name]
    )[0];
    if (existing) {
      // 老库已有同名商品：补 kind/buff/price（价格量级幂等校准）
      run('UPDATE products SET kind = ?, buff = ?, price = ? WHERE id = ?', [kind, buff, price, existing.id]);
      continue;
    }
    run(
      'INSERT INTO products (id, shop_id, name, price, sort_order, kind, buff) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [randomId(), shopId, name, price, sortOrder, kind, buff]
    );
  }

  // 更早期版本残留商品（名称不在上表）：按店铺量级校准价格，堵住「低价旧货 + 转售」套利口子
  const legacyPriceFix = [
    ['lihetang', '会所日票', 400000],
    ['banyuan', '园林写真', 800000],
    ['memory', '青果巷导览手册', 50000],
    ['finance', '街铺贷月供', 2400000],
  ];
  for (const [shopId, name, price] of legacyPriceFix) {
    const row = query(
      'SELECT id FROM products WHERE shop_id = ? AND name = ? AND price < ?',
      [shopId, name, price]
    )[0];
    if (row) run('UPDATE products SET price = ? WHERE id = ?', [price, row.id]);
  }
}

/** 老库迁移：users 表在 v1 前没有 chat_banned 字段，这里幂等补上 */
function _migrateV1() {
  try {
    _db.exec('ALTER TABLE users ADD COLUMN chat_banned INTEGER NOT NULL DEFAULT 0');
  } catch (_e) {
    // SQLite: column already exists 会抛错，忽略
  }
}

/** 老库迁移：补游戏数值字段（逐列 ALTER，已存在则跳过） */
function _migrateV2() {
  const columns = [
    "title TEXT NOT NULL DEFAULT '街头路人甲'",
    'income_per_sec REAL NOT NULL DEFAULT 0',
    'last_tick INTEGER NOT NULL DEFAULT 0',
    'total_earned REAL NOT NULL DEFAULT 0',
    'rebirth_count INTEGER NOT NULL DEFAULT 0',
    'black_card_points INTEGER NOT NULL DEFAULT 0',
    "talents_json TEXT NOT NULL DEFAULT '{}'",
  ];
  for (const col of columns) {
    try {
      _db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    } catch (_e) {
      // 列已存在，忽略
    }
  }
  // 老用户 last_tick 为 0 时用创建时间兜底，避免首次登录结算出巨额离线收益
  try {
    _db.exec('UPDATE users SET last_tick = created_at WHERE last_tick = 0 OR last_tick IS NULL');
  } catch (_e) { /* 忽略 */ }
}

/** 老库迁移：补金币拾取 / 家族分红时间戳（逐列 ALTER，已存在则跳过） */
function _migrateV3() {
  const columns = [
    'last_coin_at INTEGER NOT NULL DEFAULT 0',
    'last_box_at INTEGER NOT NULL DEFAULT 0',
    'last_dividend_at INTEGER NOT NULL DEFAULT 0',
  ];
  for (const col of columns) {
    try {
      _db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    } catch (_e) {
      // 列已存在，忽略
    }
  }
  try {
    _db.exec('UPDATE users SET last_dividend_at = created_at WHERE last_dividend_at = 0 OR last_dividend_at IS NULL');
  } catch (_e) { /* 忽略 */ }
}

/** 老库迁移：店铺消费流水 / 订单转售 / 商品分类与 buff 字段（逐列 ALTER，已存在则跳过） */
function _migrateV4() {
  const alters = [
    'ALTER TABLE shops ADD COLUMN flow_total INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE orders ADD COLUMN resold INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'daily'",
    "ALTER TABLE products ADD COLUMN buff TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN buffs_json TEXT NOT NULL DEFAULT '{}'",
  ];
  for (const sql of alters) {
    try {
      _db.exec(sql);
    } catch (_e) {
      // 列已存在，忽略
    }
  }
}

/**
 * 一次性发放开局首桶金（50 万，刚好够买第一家奶茶铺）
 * 用「新增 last_tick 列是否成功」作为迁移标记，保证只执行一次，
 * 否则玩家花光钱后重启服务又会被补满。
 */
function _grantStartupCapital() {  try {
    _db.exec('ALTER TABLE users ADD COLUMN last_tick INTEGER NOT NULL DEFAULT 0');
  } catch (_e) {
    return; // 列已存在 → 说明已经迁移过，不再发钱
  }
  try {
    _db.exec('UPDATE users SET last_tick = created_at');
    _db.exec('UPDATE users SET balance = 500000 WHERE balance < 500000');
    console.log('[db] 已为老玩家发放开局首桶金 ¥500,000');
  } catch (_e) { /* 忽略 */ }
}

export function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 种子管理员账号：默认 admin / admin123，可用 ADMIN_USERNAME / ADMIN_PASSWORD 覆盖 */
async function _seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  if (findUserByUsername(username)) return;
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  insertUser({
    id: randomId(),
    username,
    password: await bcrypt.hash(password, 10),
    nickname: '系统管理员',
    variant: 'male',
    balance: 500,
    created_at: Date.now(),
  });
  console.log(`[db] 已创建管理员账号 ${username}（默认密码 ${password}，请尽快修改）`);
}

/** 种子一条欢迎公告，避免首次进入顶栏空白 */
function _seedAnnouncements() {
  const count = query('SELECT COUNT(*) AS c FROM announcements')[0]?.c ?? 0;
  if (count > 0) return;
  insertAnnouncement({
    title: '欢迎来到青果巷',
    content: '街区已开放多人私聊：按 Tab 打开聊天，点击在线玩家即可私聊。文明游览，禁止刷屏。',
    active: 1,
  });
}

// ============ MySQL 分支（未来启用时替换 run() / query() 内部实现） ============
//
// 示例（真正启用时把 run/query 的 SQLite 分支改成：
//
//   export async function run(sql, params = []) {
//     const [result] = await _db.execute(sql, params);
//     return result;
//   }
//   export async function query(sql, params = []) {
//     const [rows] = await _db.execute(sql, params);
//     return rows;
//   }
//
// 注意：mysql2 execute() 是 async 的，上层 auth.js/chat.js/index.js 里
// 调用 run()/query() 的地方要加 await（一次性改完，搜索替换即可）。
// JSONL 的 appendMessage / messagesBetween 继续原样用。