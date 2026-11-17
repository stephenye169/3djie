/**
 * SQLite → MySQL 数据迁移脚本（未来真要换 MySQL 时使用）
 *
 * 使用方式：
 *   npm install mysql2                      # 先装 mysql2
 *   USE_MYSQL=true MYSQL_HOST=127.0.0.1 \
 *   MYSQL_USER=root MYSQL_PASSWORD=xxx \
 *   MYSQL_DATABASE=qingguo \
 *   node server/migrate-to-mysql.js
 *
 * 表结构已按 ANSI SQL 编写，直接兼容 MySQL，无需改动。
 * 迁移脚本做：源 SQLite .db → 逐表抽取 → INSERT INTO MySQL（含 upsert 冲突忽略）
 * 迁移结束后，改 db.js 的 USE_MYSQL 开关为 true（或设环境变量）即可切换运行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'qingguo.db');

const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'qingguo';

const TABLES = ['users', 'shops', 'products', 'orders'];

// SQLite → MySQL 的方言差异处理
function adaptSQLiteRow(row) {
  // sql.js 的 getAsObject 可能把 INTEGER 读成 number，TEXT 保持 string
  // 无需额外转换，ANSI 类型在 MySQL 中直接兼容
  return row;
}

async function loadSQLite() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ SQLite 数据库不存在: ${DB_PATH}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(DB_PATH);
  return new SQL.Database(new Uint8Array(buf));
}

function extractRows(db, table) {
  const stmt = db.prepare(`SELECT * FROM ${table}`);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

async function migrate() {
  // 动态 import mysql2（用户可能还没装）
  let mysql;
  try { mysql = (await import('mysql2/promise')).default; }
  catch {
    console.error('❌ mysql2 未安装，先执行：npm install mysql2');
    process.exit(1);
  }

  const sqlite = await loadSQLite();
  const all = {};
  for (const t of TABLES) all[t] = extractRows(sqlite, t);

  console.log(`📋 从 SQLite 抽取：${TABLES.map(t => `${t}=${all[t].length}`).join(', ')}`);

  // 连接 MySQL（先不指定 database，便于自动建库）
  const conn = await mysql.createConnection({
    host: MYSQL_HOST, port: MYSQL_PORT,
    user: MYSQL_USER, password: MYSQL_PASSWORD,
    multipleStatements: true,
  });

  await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` DEFAULT CHARSET utf8mb4`);
  await conn.execute(`USE \`${MYSQL_DATABASE}\``);

  // 建表（与 db.js initDb 的 CREATE TABLE 完全一致，MySQL 兼容）
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id          VARCHAR(40) PRIMARY KEY,
      username    VARCHAR(40) UNIQUE NOT NULL,
      password    VARCHAR(255) NOT NULL,
      nickname    VARCHAR(40) NOT NULL,
      variant     VARCHAR(8)  NOT NULL,
      balance     INT NOT NULL DEFAULT 500,
      created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shops (
      id          VARCHAR(40) PRIMARY KEY,
      name        VARCHAR(40) NOT NULL,
      category    VARCHAR(40) NOT NULL,
      emoji       VARCHAR(8),
      description TEXT,
      layout_z    DOUBLE,
      side        TINYINT,
      active      TINYINT NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS products (
      id          VARCHAR(40) PRIMARY KEY,
      shop_id     VARCHAR(40) NOT NULL,
      name        VARCHAR(40) NOT NULL,
      price       INT NOT NULL,
      sort_order  INT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id          VARCHAR(40) PRIMARY KEY,
      user_id     VARCHAR(40) NOT NULL,
      product_id  VARCHAR(40) NOT NULL,
      qty         INT NOT NULL,
      paid        INT NOT NULL,
      created_at  BIGINT NOT NULL
    );
  `);

  // 逐表插入（ON DUPLICATE KEY UPDATE = UPSERT，冲突时保留 MySQL 已有的）
  for (const table of TABLES) {
    const rows = all[table];
    if (rows.length === 0) { console.log(`   ${table}: 空表跳过`); continue; }
    const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(',');
    const placeholders = Object.keys(rows[0]).map(() => '?').join(',');
    const updatePart = Object.keys(rows[0]).map(c => `\`${c}\`=VALUES(\`${c}\`)`).join(',');
    const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updatePart}`;
    let inserted = 0, updated = 0;
    for (const row of rows) {
      const adapt = adaptSQLiteRow(row);
      const [result] = await conn.execute(sql, Object.values(adapt));
      if (result && result.affectedRows > 0) {
        // affectedRows=2 表示 upsert 更新了
        if (result.affectedRows === 2) updated++;
        else inserted++;
      }
    }
    console.log(`   ${table}: 新增 ${inserted}, 更新 ${updated}`);
  }

  await conn.end();
  sqlite.close();
  console.log('\n✅ 迁移完成。把 db.js 的 USE_MYSQL 环境变量设为 true 即可切换。');
  console.log('   例如：set USE_MYSQL=true && npm run server  （Windows PowerShell）');
}

migrate().catch((err) => {
  console.error('❌ 迁移失败:', err.message);
  process.exit(1);
});
