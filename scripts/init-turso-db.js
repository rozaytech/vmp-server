import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("❌ ERRO: TURSO_DATABASE_URL e TURSO_AUTH_TOKEN sao obrigatorios");
  console.error("   Crie o ficheiro .env com as credenciais do Turso");
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

const SCHEMA = `
-- =========================================================
-- TABELAS DE LICENCIAMENTO
-- =========================================================

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  client TEXT NOT NULL,
  plan TEXT NOT NULL,
  subscription_id TEXT,
  expiry TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_validation TEXT,
  remote_pin TEXT
);

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

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS license_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT,
  event TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  sent_at TEXT,
  created_at TEXT NOT NULL
);

-- =========================================================
-- TABELAS POS / VMP SAAS
-- =========================================================

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

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
  client_product_id INTEGER,
  license_id TEXT
);

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
  user_name TEXT,
  client_sale_id INTEGER,
  license_id TEXT
);

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

CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  change_amount REAL DEFAULT 0,
  reference TEXT,
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

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

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_licenses_machine ON licenses(machine_id);
CREATE INDEX IF NOT EXISTS idx_licenses_subscription ON licenses(subscription_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_client ON subscriptions(client);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_remote_tokens_license ON remote_access_tokens(license_id);
CREATE INDEX IF NOT EXISTS idx_remote_tokens_token ON remote_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_sales_client_sale ON sales(client_sale_id, license_id);
CREATE INDEX IF NOT EXISTS idx_products_client ON products(client_product_id, license_id);
CREATE INDEX IF NOT EXISTS idx_activation_requests_machine ON activation_requests(machine_id);
`;

async function initDatabase() {
  console.log("🚀 Inicializando base de dados Turso...");
  console.log(`   URL: ${TURSO_URL}`);

  try {
    await client.executeMultiple(SCHEMA);
    console.log("✅ Tabelas criadas com sucesso!");

    // Verificar se warehouse padrao existe
    const result = await client.execute(
      "SELECT COUNT(*) as count FROM warehouses"
    );
    const count = result.rows[0][0];

    if (count === 0) {
      const now = new Date().toISOString();
      await client.execute({
        sql: "INSERT INTO warehouses (name, location, created_at) VALUES (?, ?, ?)",
        args: ["Armazem Principal", "Sede", now],
      });
      console.log("✅ Warehouse padrao criada");
    }

    // Verificar se admin do painel existe
    const adminResult = await client.execute(
      "SELECT COUNT(*) as count FROM admins WHERE username = 'admin'"
    );
    const adminCount = adminResult.rows[0][0];

    if (adminCount === 0) {
      const now = new Date().toISOString();
      await client.execute({
        sql: "INSERT INTO admins (username, password, role, created_at) VALUES (?, ?, ?, ?)",
        args: ["admin", "admin123", "super_admin", now],
      });
      console.log("✅ Admin padrao criado (username: admin, password: admin123)");
    }

    console.log("\n🎉 Base de dados Turso pronta para uso!");
    console.log("   Execute agora: npm run db:migrate");
    console.log("   (para migrar dados da database.db local, se existir)");

  } catch (e) {
    console.error("❌ ERRO ao inicializar Turso:", e.message);
    process.exit(1);
  }
}

initDatabase();
