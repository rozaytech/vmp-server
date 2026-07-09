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

  // NOVO: tabela de logs de email
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

  // MIGRATION: criar subscrições para licenças antigas
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

  const admin = await db.get(`
    SELECT *
    FROM admins
    WHERE username = 'admin'
  `);

  if (!admin) {
    await db.run(
      `
      INSERT INTO admins (
        username,
        password,
        role,
        created_at
      )
      VALUES (?, ?, ?, ?)
      `,
      [
        'admin',
        'admin123',
        'super_admin',
        new Date().toISOString(),
      ],
    );
  }

  return db;
}