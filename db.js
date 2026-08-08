import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

let client = null;

// =========================================================
// Criar cliente Turso
// =========================================================
export async function getDB() {
  if (client) return client;

  if (!TURSO_URL) {
    throw new Error("TURSO_DATABASE_URL nao definida. Verifique o ficheiro .env");
  }

  client = createClient({
    url: TURSO_URL,
    authToken: TURSO_TOKEN,
  });

  return client;
}

// =========================================================
// Wrapper compativel com a API sqlite anterior
// =========================================================
export async function initDB() {
  const turso = await getDB();

  // Wrapper para manter compatibilidade com codigo existente
  const db = {
    // INSERT / UPDATE / DELETE
    async run(sql, params = []) {
      const result = await turso.execute({ sql, args: params });
      return {
        lastID: result.lastInsertRowid ?? null,
        changes: result.rowsAffected ?? 0,
      };
    },

    // SELECT uma linha
    async get(sql, params = []) {
      const result = await turso.execute({ sql, args: params });
      if (!result.rows || result.rows.length === 0) return undefined;
      const row = result.rows[0];
      const obj = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    },

    // SELECT multiplas linhas
    async all(sql, params = []) {
      const result = await turso.execute({ sql, args: params });
      if (!result.rows) return [];
      return result.rows.map((row) => {
        const obj = {};
        result.columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });
    },

    // Schema (CREATE TABLE, etc.)
    async exec(sql) {
      await turso.executeMultiple(sql);
    },
  };

  // =========================================================
  // SCHEMA CREATION (igual ao db.js antigo, mas para Turso)
  // =========================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      client TEXT NOT NULL,
      plan TEXT NOT NULL,
      subscription_id TEXT,
      expiry TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_validation TEXT
    );
  `);

  // Migration: subscription_id
  const licenseCols = await db.all(`PRAGMA table_info(licenses)`);
  const hasSubId = licenseCols.some(col => col.name === 'subscription_id');
  if (!hasSubId) {
    await db.exec(`ALTER TABLE licenses ADD COLUMN subscription_id TEXT`);
    console.log('[MIGRATION] Adicionada coluna subscription_id a tabela licenses');
  }

  // Migration: remote_pin
  const hasRemotePin = licenseCols.some(col => col.name === 'remote_pin');
  if (!hasRemotePin) {
    await db.exec(`ALTER TABLE licenses ADD COLUMN remote_pin TEXT`);
    console.log('[MIGRATION] Adicionada coluna remote_pin a tabela licenses');
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      client TEXT NOT NULL,
      email TEXT,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      payment_provider TEXT,
      payment_reference TEXT,
      auto_renew INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      client TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      reference TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS license_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id TEXT,
      event TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS activation_requests (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      client_email TEXT NOT NULL,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      license_id TEXT,
      payment_reference TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      sent_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // =========================================================
  // TABELAS POS / VMP SAAS
  // =========================================================
  await db.exec(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barcode TEXT UNIQUE,
      price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER DEFAULT 0,
      max_stock INTEGER DEFAULT 0,
      category TEXT,
      unit TEXT DEFAULT 'UN',
      warehouse_id INTEGER,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS pos_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      pin TEXT,
      barcode TEXT,
      role TEXT NOT NULL DEFAULT 'operator',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      customer_name TEXT,
      customer_nuit TEXT,
      notes TEXT,
      payment_method TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      audit_hash TEXT,
      is_synced INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cancelled_at TEXT,
      cancelled_by INTEGER,
      cancellation_reason TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL,
      discount REAL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      change_amount REAL DEFAULT 0,
      reference TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL DEFAULT 0,
      reason TEXT,
      sale_id INTEGER,
      warehouse_id INTEGER,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      opening_amount REAL NOT NULL,
      closing_amount REAL,
      physical_count REAL,
      difference REAL,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      notes TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS remote_access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      device_info TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      is_revoked INTEGER DEFAULT 0
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_remote_tokens_license ON remote_access_tokens(license_id);
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_remote_tokens_token ON remote_access_tokens(token);
  `);

  // =========================================================
  // MIGRATIONS: Sync support (v2.3.3)
  // =========================================================
  const salesColumns = await db.all(`PRAGMA table_info(sales)`);
  if (!salesColumns.some(c => c.name === 'user_name')) {
    await db.exec(`ALTER TABLE sales ADD COLUMN user_name TEXT`);
    console.log('[MIGRATION] Adicionada coluna user_name a sales');
  }
  if (!salesColumns.some(c => c.name === 'client_sale_id')) {
    await db.exec(`ALTER TABLE sales ADD COLUMN client_sale_id INTEGER`);
    console.log('[MIGRATION] Adicionada coluna client_sale_id a sales');
  }
  if (!salesColumns.some(c => c.name === 'license_id')) {
    await db.exec(`ALTER TABLE sales ADD COLUMN license_id TEXT`);
    console.log('[MIGRATION] Adicionada coluna license_id a sales');
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_client_sale ON sales(client_sale_id, license_id)`);

  const productsColumns = await db.all(`PRAGMA table_info(products)`);
  if (!productsColumns.some(c => c.name === 'client_product_id')) {
    await db.exec(`ALTER TABLE products ADD COLUMN client_product_id INTEGER`);
    console.log('[MIGRATION] Adicionada coluna client_product_id a products');
  }
  if (!productsColumns.some(c => c.name === 'license_id')) {
    await db.exec(`ALTER TABLE products ADD COLUMN license_id TEXT`);
    console.log('[MIGRATION] Adicionada coluna license_id a products');
  }
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_products_client ON products(client_product_id, license_id)`);

  // =========================================================
  // MIGRATIONS & SEED DATA
  // =========================================================

  // Seed: Warehouse padrao
  const warehouseCount = await db.get(`SELECT COUNT(*) as count FROM warehouses`);
  if (warehouseCount.count === 0) {
    await db.run(
      `INSERT INTO warehouses (name, location, created_at) VALUES (?, ?, ?)`,
      ['Armazem Principal', 'Sede', new Date().toISOString()]
    );
    console.log('[SEED] Warehouse padrao criada');
  }

  // Seed: POS User admin
  const posUser = await db.get(`SELECT * FROM pos_users WHERE role = 'admin' LIMIT 1`);
  if (!posUser) {
    await db.run(
      `INSERT INTO pos_users (name, pin, role, is_active, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['Administrador', '1234', 'admin', 1, new Date().toISOString()]
    );
    console.log('[SEED] POS User admin criado (PIN: 1234)');
  }

  // MIGRATION: Criar subscricoes para licencas antigas
  const orphanedLicenses = await db.all(`
    SELECT l.* FROM licenses l
    LEFT JOIN subscriptions s ON l.subscription_id = s.id
    WHERE l.subscription_id IS NULL OR s.id IS NULL
  `);

  for (const lic of orphanedLicenses) {
    const subId = uuidv4();
    const now = new Date();

    await db.run(
      `INSERT INTO subscriptions (
        id, client, plan, status, start_date, expiry_date,
        payment_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        subId,
        lic.client,
        lic.plan,
        'active',
        lic.created_at,
        lic.expiry,
        'paid',
        now.toISOString(),
      ]
    );

    await db.run(
      `UPDATE licenses SET subscription_id = ? WHERE id = ?`,
      [subId, lic.id]
    );

    console.log(`[MIGRATION] Criada subscricao ${subId} para licenca antiga ${lic.id} (${lic.client})`);
  }

  // Admin do painel
  const admin = await db.get(`SELECT * FROM admins WHERE username = 'admin'`);
  if (!admin) {
    await db.run(
      `INSERT INTO admins (username, password, role, created_at) VALUES (?, ?, ?, ?)`,
      ['admin', 'admin123', 'super_admin', new Date().toISOString()]
    );
    console.log('[SEED] Admin do painel criado (username: admin, password: admin123)');
  }

  // =========================================================
  // INDEXES adicionais para performance
  // =========================================================
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_licenses_machine ON licenses(machine_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_licenses_subscription ON licenses(subscription_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON subscriptions(client)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_activation_requests_machine ON activation_requests(machine_id)`);

  console.log('[TURSO] Base de dados inicializada e pronta');

  return db;
}

export default { getDB, initDB };
