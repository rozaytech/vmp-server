import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { v4 as uuidv4 } from 'uuid';

export async function getDB() {
  return open({
    filename: './database.db',
    driver: sqlite3.Database,
  });
}

export async function initDB() {
  const db = await getDB();

  // =========================================================
  // TABELAS EXISTENTES (SaaS Licensing)
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

  const licenseColumns = await db.all(`PRAGMA table_info(licenses)`);
  const hasSubscriptionId = licenseColumns.some(col => col.name === 'subscription_id');
  if (!hasSubscriptionId) {
    await db.exec(`ALTER TABLE licenses ADD COLUMN subscription_id TEXT`);
    console.log('[MIGRATION] Adicionada coluna subscription_id à tabela licenses');
  }

  // NOVO: Adicionar coluna remote_pin às licenses (para acesso remoto)
  const hasRemotePin = licenseColumns.some(col => col.name === 'remote_pin');
  if (!hasRemotePin) {
    await db.exec(`ALTER TABLE licenses ADD COLUMN remote_pin TEXT`);
    console.log('[MIGRATION] Adicionada coluna remote_pin à tabela licenses');
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
  // NOVA TABELA: Tokens de Acesso Remoto
  // =========================================================
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
      is_revoked INTEGER DEFAULT 0,
      FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_remote_tokens_license ON remote_access_tokens(license_id);
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_remote_tokens_token ON remote_access_tokens(token);
  `);

  // =========================================================
  // NOVAS TABELAS POS / VMP SAAS
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
      updated_at TEXT NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
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
      cancellation_reason TEXT,
      FOREIGN KEY (user_id) REFERENCES pos_users(id)
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
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
      notes TEXT,
      FOREIGN KEY (user_id) REFERENCES pos_users(id)
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
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES cash_sessions(id)
    );
  `);

  // =========================================================
  // MIGRATIONS & SEED DATA
  // =========================================================

  // Seed: Warehouse padrão
  const warehouseCount = await db.get(`SELECT COUNT(*) as count FROM warehouses`);
  if (warehouseCount.count === 0) {
    await db.run(
      `INSERT INTO warehouses (name, location, created_at) VALUES (?, ?, ?)`,
      ['Armazém Principal', 'Sede', new Date().toISOString()]
    );
    console.log('[SEED] Warehouse padrão criada');
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

  // MIGRATION: Criar subscrições para licenças antigas
  const orphanedLicenses = await db.all(`
    SELECT l.* FROM licenses l
    LEFT JOIN subscriptions s ON l.subscription_id = s.id
    WHERE l.subscription_id IS NULL OR s.id IS NULL
  `);

  for (const lic of orphanedLicenses) {
    const subId = uuidv4();
    const now = new Date();
    const expiry = new Date(lic.expiry);

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

    console.log(`[MIGRATION] Criada subscrição ${subId} para licença antiga ${lic.id} (${lic.client})`);
  }

  // Admin do painel (mantido do original)
  const admin = await db.get(`SELECT * FROM admins WHERE username = 'admin'`);
  if (!admin) {
    await db.run(
      `INSERT INTO admins (username, password, role, created_at) VALUES (?, ?, ?, ?)`,
      ['admin', 'admin123', 'super_admin', new Date().toISOString()]
    );
  }

  return db;
}
