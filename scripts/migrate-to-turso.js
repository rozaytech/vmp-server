import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const LOCAL_DB_PATH = process.env.LOCAL_DB_PATH || "./database.db";

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("❌ ERRO: TURSO_DATABASE_URL e TURSO_AUTH_TOKEN sao obrigatorios no .env");
  process.exit(1);
}

if (!fs.existsSync(LOCAL_DB_PATH)) {
  console.error(`❌ ERRO: Ficheiro local nao encontrado: ${LOCAL_DB_PATH}`);
  console.error("   Se nao tem dados para migrar, pode ignorar este passo.");
  process.exit(0);
}

const turso = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

// Tabelas a migrar (na ordem correta para respeitar FKs)
const TABLES = [
  "subscriptions",
  "licenses",
  "payments",
  "admins",
  "license_logs",
  "audit_logs",
  "billing_events",
  "activation_requests",
  "email_logs",
  "warehouses",
  "pos_users",
  "products",
  "sales",
  "sale_items",
  "sale_payments",
  "stock_movements",
  "cash_sessions",
  "cash_movements",
  "remote_access_tokens",
];

async function migrateTable(localDb, tableName) {
  console.log(`\n📦 Migrando tabela: ${tableName}`);

  try {
    // Verificar se tabela existe na DB local
    const tableInfo = await localDb.all(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );

    if (tableInfo.length === 0) {
      console.log(`   ⚠️  Tabela ${tableName} nao existe na DB local — ignorando`);
      return;
    }

    // Contar registos
    const countResult = await localDb.get(`SELECT COUNT(*) as c FROM ${tableName}`);
    const total = countResult.c;

    if (total === 0) {
      console.log(`   ℹ️  Tabela ${tableName} vazia — nada a migrar`);
      return;
    }

    console.log(`   📊 ${total} registos encontrados`);

    // Buscar todos os dados
    const rows = await localDb.all(`SELECT * FROM ${tableName}`);

    if (rows.length === 0) return;

    // Construir INSERT statement
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => "?").join(", ");
    const insertSql = `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`;

    // Inserir em batches de 50 para evitar timeouts
    const BATCH_SIZE = 50;
    let migrated = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const statements = batch.map((row) => ({
        sql: insertSql,
        args: columns.map((col) => row[col] ?? null),
      }));

      await turso.batch(statements);
      migrated += batch.length;
      process.stdout.write(`   ✅ ${migrated}/${total} migrados\r`);
    }

    console.log(`   ✅ ${migrated}/${total} registos migrados para Turso`);

  } catch (e) {
    console.error(`   ❌ ERRO ao migrar ${tableName}:`, e.message);
    // Continuar com as outras tabelas
  }
}

async function migrate() {
  console.log("🚀 MIGRACAO: SQLite Local → Turso Cloud");
  console.log(`   Origem:  ${path.resolve(LOCAL_DB_PATH)}`);
  console.log(`   Destino: ${TURSO_URL}`);
  console.log("");

  const localDb = await open({
    filename: LOCAL_DB_PATH,
    driver: sqlite3.Database,
  });

  console.log("✅ Conectado a base de dados local");

  // Desativar FK checks temporariamente no Turso
  try {
    await turso.execute("PRAGMA foreign_keys = OFF");
  } catch (_) {
    // Turso pode nao suportar este PRAGMA — ignorar
  }

  for (const table of TABLES) {
    await migrateTable(localDb, table);
  }

  // Reativar FK checks
  try {
    await turso.execute("PRAGMA foreign_keys = ON");
  } catch (_) {}

  console.log("\n🎉 MIGRACAO CONCLUIDA!");
  console.log("   Os seus dados estao agora persistentes no Turso.");
  console.log("   Pode fazer deploy no Render sem perder dados.");

  await localDb.close();
  process.exit(0);
}

migrate().catch((e) => {
  console.error("❌ ERRO FATAL:", e);
  process.exit(1);
});
