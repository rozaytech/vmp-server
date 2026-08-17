import { initDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { PLANS, getPlanFeatures } from "../billing/plans.js";

const SECRET_KEY = process.env.LICENSE_SECRET || "vmp-saas-secret-2026";

function hashLicense(data) {
  return crypto.createHmac("sha256", SECRET_KEY).update(data).digest("hex");
}

// =========================================================
// EXPORTADO: gerar license key
// =========================================================
export function generateLicenseKey(machineId, plan, expiry, subscriptionId) {
  const payload = `${machineId}:${plan}:${expiry}:${subscriptionId}:${Date.now()}`;
  const signature = hashLicense(payload);
  return Buffer.from(`${payload}:${signature}`).toString("base64");
}

// =========================================================
// DIAS CORRETOS POR PLANO
// =========================================================
export function getPlanDurationDays(plan, isTrial = false) {
  if (isTrial) return 7;
  switch (plan) {
    case "basic": return 30;
    case "pro": return 30;
    case "enterprise": return 365;
    default: return 30;
  }
}

// =========================================================
// EXPORTADO: criar entrada de licenca
// =========================================================
export async function createLicenseEntry({ machineId, client, plan, expiry, subscriptionId, isTrial = false }) {
  const db = await initDB();
  const licenseId = uuidv4();
  const licenseKey = generateLicenseKey(machineId, plan, expiry, subscriptionId);
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO licenses (
      id, machine_id, client, plan, subscription_id, expiry, status, created_at, last_validation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [licenseId, machineId, client, plan, subscriptionId, expiry, "active", now, null]
  );

  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [licenseId, machineId, isTrial ? "trial_generated" : "generated", now]
  );

  return { licenseId, licenseKey };
}

// =========================================================
// GERAR LICENCA COMPLETA (subscricao + licenca)
// =========================================================
export async function generateLicense(machineId, client, plan, customDays, isTrial = false) {
  const db = await initDB();

  if (!machineId || !client || !plan) {
    throw new Error("missing_fields");
  }

  const planConfig = PLANS[plan];
  if (!planConfig) {
    throw new Error("invalid_plan");
  }

  // Bloquear trial duplicado para o mesmo machineId
  if (isTrial) {
    const existingTrial = await db.get(
      `SELECT l.* FROM licenses l
       JOIN subscriptions s ON l.subscription_id = s.id
       WHERE l.machine_id = ? AND s.status = 'trial' AND l.expiry > datetime('now')
       ORDER BY l.created_at DESC LIMIT 1`,
      [machineId]
    );
    if (existingTrial) {
      throw new Error("trial_already_exists_for_this_machine");
    }
  }

  const days = customDays || getPlanDurationDays(plan, isTrial);
  const now = new Date();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);

  const subscriptionId = uuidv4();
  const licenseId = uuidv4();
  const email = client.includes('@') ? client : null;

  // Criar subscricao
  await db.run(
    `INSERT INTO subscriptions (
      id, client, email, plan, status, start_date, expiry_date,
      payment_status, auto_renew, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      subscriptionId,
      client,
      email || client,
      plan,
      isTrial ? 'trial' : 'active',
      now.toISOString(),
      expiry.toISOString(),
      isTrial ? 'trial' : 'pending',
      0,
      now.toISOString(),
    ]
  );

  // Criar licenca
  const licenseKey = generateLicenseKey(machineId, plan, expiry.toISOString(), subscriptionId);

  await db.run(
    `INSERT INTO licenses (
      id, machine_id, client, plan, subscription_id, expiry, status, created_at, last_validation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      licenseId,
      machineId,
      client,
      plan,
      subscriptionId,
      expiry.toISOString(),
      "active",
      now.toISOString(),
      null,
    ]
  );

  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [licenseId, machineId, isTrial ? "trial_generated" : "generated", now.toISOString()]
  );

  return {
    licenseId,
    subscriptionId,
    licenseKey,
    plan,
    expiry: expiry.toISOString(),
    days,
    features: getPlanFeatures(plan),
    subscription: {
      id: subscriptionId,
      client,
      email: email || client,
      plan,
      status: isTrial ? 'trial' : 'active',
      startDate: now.toISOString(),
      endDate: expiry.toISOString(),
      paymentStatus: isTrial ? 'trial' : 'pending',
      days,
      price: planConfig?.price || 0,
    },
  };
}

// =========================================================
// VALIDAR LICENCA
// CORRECAO CRITICA: consulta a DB PRIMEIRO antes de
// verificar expiracao do payload base64. Se a licenca foi
// renovada no painel, usa os dados da DB e retorna uma
// nova license key para o Flutter sincronizar.
// =========================================================
export async function validateLicense(licenseKey, machineId) {
  const db = await initDB();
  const now = new Date();

  // --- PASSO 1: Decodificar e validar formato/assinatura ---
  let decoded;
  try {
    decoded = Buffer.from(licenseKey, "base64").toString("utf-8");
  } catch {
    return { valid: false, error: "invalid_format" };
  }

  const parts = decoded.split(":");
  if (parts.length < 5) {
    return { valid: false, error: "invalid_format" };
  }

  const [licMachineId, planFromPayload, expiryStr, subscriptionId] = parts;
  const signature = parts[parts.length - 1];

  const payload = parts.slice(0, -1).join(":");
  const expectedSig = hashLicense(payload);
  if (signature !== expectedSig) {
    return { valid: false, error: "invalid_signature" };
  }

  if (licMachineId !== machineId) {
    return { valid: false, error: "machine_mismatch" };
  }

  // --- PASSO 2: Consultar a DB por subscription_id ---
  let dbLicense = await db.get(
    `SELECT l.*, s.status as sub_status, s.expiry_date as sub_expiry
     FROM licenses l
     LEFT JOIN subscriptions s ON l.subscription_id = s.id
     WHERE l.subscription_id = ? AND l.status = 'active'
     ORDER BY l.created_at DESC LIMIT 1`,
    [subscriptionId]
  );

  // --- PASSO 3: Fallback por machine_id ativa ---
  if (!dbLicense) {
    dbLicense = await db.get(
      `SELECT l.*, s.status as sub_status, s.expiry_date as sub_expiry
       FROM licenses l
       LEFT JOIN subscriptions s ON l.subscription_id = s.id
       WHERE l.machine_id = ? AND l.status = 'active'
       ORDER BY l.created_at DESC LIMIT 1`,
      [machineId]
    );
  }

  // --- PASSO 4: Se nao encontrou na DB, verificar payload ---
  if (!dbLicense) {
    // Verificar se o payload local ainda e valido
    const payloadExpiry = new Date(expiryStr);
    if (payloadExpiry < now) {
      return { valid: false, error: "expired", expiry: expiryStr };
    }
    return { valid: false, error: "revoked" };
  }

  // --- PASSO 5: Usar dados da DB (fonte da verdade) ---
  const dbExpiry = new Date(dbLicense.expiry);
  const dbPlan = dbLicense.plan || planFromPayload;

  // Se a DB diz que expirou, bloqueia
  if (dbExpiry < now) {
    return {
      valid: false,
      error: "expired",
      expiry: dbLicense.expiry,
      plan: dbPlan,
    };
  }

  // Se a subscricao foi cancelada/revogada
  if (dbLicense.sub_status === 'cancelled' || dbLicense.sub_status === 'revoked') {
    return { valid: false, error: "revoked" };
  }

  // --- PASSO 6: Gerar NOVA license key com dados atualizados ---
  // Isso garante que o Flutter salve a nova key com expiry correto
  const newLicenseKey = generateLicenseKey(
    machineId,
    dbPlan,
    dbLicense.expiry,
    dbLicense.subscription_id || subscriptionId
  );

  // Atualizar last_validation
  await db.run(
    `UPDATE licenses SET last_validation = ? WHERE id = ?`,
    [now.toISOString(), dbLicense.id]
  );

  const daysRemaining = Math.ceil((dbExpiry - now) / (1000 * 60 * 60 * 24));

  return {
    valid: true,
    license: newLicenseKey,         // NOVA key para o Flutter sincronizar
    licenseKey: newLicenseKey,      // backward compatibility
    plan: dbPlan,
    expiry: dbLicense.expiry,
    daysRemaining: Math.max(0, daysRemaining),
    features: getPlanFeatures(dbPlan),
    subscriptionId: dbLicense.subscription_id || subscriptionId,
    licenseId: dbLicense.id,
    client: dbLicense.client,
    paymentStatus: dbLicense.sub_status || "unknown",
  };
}

// =========================================================
// NOVO: Buscar licenca ativa por machine_id
// Usado pelo botao "Verificar Estado Online" no Flutter
// =========================================================
export async function getLicenseByMachineId(machineId) {
  const db = await initDB();

  const dbLicense = await db.get(
    `SELECT l.*, s.status as sub_status, s.expiry_date as sub_expiry
     FROM licenses l
     LEFT JOIN subscriptions s ON l.subscription_id = s.id
     WHERE l.machine_id = ? AND l.status = 'active'
     ORDER BY l.created_at DESC LIMIT 1`,
    [machineId]
  );

  if (!dbLicense) {
    return null;
  }

  const now = new Date();
  const dbExpiry = new Date(dbLicense.expiry);
  const isExpired = dbExpiry < now;

  // Se expirou na DB, nao retorna licenca valida
  if (isExpired) {
    return {
      license: null,
      licenseKey: null,
      status: 'expired',
      plan: dbLicense.plan,
      expiry: dbLicense.expiry,
      daysRemaining: 0,
    };
  }

  // Gerar nova license key com dados atualizados
  const newLicenseKey = generateLicenseKey(
    machineId,
    dbLicense.plan,
    dbLicense.expiry,
    dbLicense.subscription_id
  );

  const daysRemaining = Math.ceil((dbExpiry - now) / (1000 * 60 * 60 * 24));

  return {
    license: newLicenseKey,
    licenseKey: newLicenseKey,
    status: dbLicense.sub_status || 'active',
    plan: dbLicense.plan,
    expiry: dbLicense.expiry,
    daysRemaining: Math.max(0, daysRemaining),
    client: dbLicense.client,
    subscriptionId: dbLicense.subscription_id,
    licenseId: dbLicense.id,
    features: getPlanFeatures(dbLicense.plan),
  };
}

// =========================================================
// NOVO: Buscar status da licenca por machine_id
// Endpoint leve para verificacao rapida
// =========================================================
export async function getLicenseStatusByMachineId(machineId) {
  const db = await initDB();

  const dbLicense = await db.get(
    `SELECT l.*, s.status as sub_status
     FROM licenses l
     LEFT JOIN subscriptions s ON l.subscription_id = s.id
     WHERE l.machine_id = ?
     ORDER BY l.created_at DESC LIMIT 1`,
    [machineId]
  );

  if (!dbLicense) {
    return { exists: false };
  }

  const now = new Date();
  const dbExpiry = new Date(dbLicense.expiry);
  const isExpired = dbExpiry < now;
  const daysRemaining = Math.ceil((dbExpiry - now) / (1000 * 60 * 60 * 24));

  return {
    exists: true,
    status: isExpired ? 'expired' : (dbLicense.status || 'active'),
    plan: dbLicense.plan,
    expiry: dbLicense.expiry,
    daysRemaining: Math.max(0, daysRemaining),
    client: dbLicense.client,
    subscriptionId: dbLicense.subscription_id,
    licenseId: dbLicense.id,
  };
}

// =========================================================
// TRANSFERIR LICENCA
// =========================================================
export async function transferLicense(oldLicenseId, newMachineId, reason) {
  const db = await initDB();

  const oldLicense = await db.get(
    `SELECT * FROM licenses WHERE id = ? AND status = 'active'`,
    [oldLicenseId]
  );

  if (!oldLicense) {
    throw new Error("license_not_found_or_inactive");
  }

  const now = new Date();
  const oldExpiry = new Date(oldLicense.expiry);
  const daysRemaining = Math.ceil((oldExpiry - now) / (1000 * 60 * 60 * 24));

  if (daysRemaining <= 0) {
    throw new Error("license_expired");
  }

  await db.run(
    `UPDATE licenses SET status = 'revoked', last_validation = ? WHERE id = ?`,
    [now.toISOString(), oldLicenseId]
  );

  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [oldLicenseId, oldLicense.machine_id, "revoked_for_transfer", now.toISOString()]
  );

  const newLicenseId = uuidv4();
  const newExpiry = new Date();
  newExpiry.setDate(newExpiry.getDate() + daysRemaining);

  const newLicenseKey = generateLicenseKey(
    newMachineId,
    oldLicense.plan,
    newExpiry.toISOString(),
    oldLicense.subscription_id
  );

  await db.run(
    `INSERT INTO licenses (
      id, machine_id, client, plan, subscription_id, expiry, status, created_at, last_validation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newLicenseId,
      newMachineId,
      oldLicense.client,
      oldLicense.plan,
      oldLicense.subscription_id,
      newExpiry.toISOString(),
      "active",
      now.toISOString(),
      null,
    ]
  );

  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [newLicenseId, newMachineId, "transferred", now.toISOString()]
  );

  await db.run(
    `INSERT INTO audit_logs (actor, action, target, created_at) VALUES (?, ?, ?, ?)`,
    ["system", "license_transfer", `${oldLicenseId} -> ${newLicenseId}`, now.toISOString()]
  );

  return {
    success: true,
    oldLicenseId,
    newLicenseId,
    newLicenseKey,
    daysTransferred: daysRemaining,
    newExpiry: newExpiry.toISOString(),
    plan: oldLicense.plan,
  };
}

// =========================================================
// LISTAR LICENCAS
// =========================================================
export async function listLicenses(filters = {}) {
  const db = await initDB();

  let whereClause = "1=1";
  const args = [];

  if (filters.status) {
    whereClause += " AND l.status = ?";
    args.push(filters.status);
  }
  if (filters.plan) {
    whereClause += " AND l.plan = ?";
    args.push(filters.plan);
  }
  if (filters.client) {
    whereClause += " AND l.client LIKE ?";
    args.push(`%${filters.client}%`);
  }

  const licenses = await db.all(
    `
    SELECT 
      l.*,
      s.payment_status,
      s.start_date,
      s.auto_renew,
      CASE 
        WHEN l.expiry < datetime('now') THEN 'expired'
        ELSE l.status
      END as computed_status
    FROM licenses l
    LEFT JOIN subscriptions s ON l.subscription_id = s.id
    WHERE ${whereClause}
    ORDER BY l.created_at DESC
    `,
    args
  );

  return licenses;
}

// =========================================================
// REVOGAR LICENCA
// =========================================================
export async function revokeLicense(licenseId, reason) {
  const db = await initDB();
  const now = new Date().toISOString();

  await db.run(
    `UPDATE licenses SET status = 'revoked', last_validation = ? WHERE id = ?`,
    [now, licenseId]
  );

  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [licenseId, "admin", `revoked: ${reason || "manual"}`, now]
  );

  return { success: true, licenseId, revokedAt: now };
}

// =========================================================
// REATIVAR LICENCA
// =========================================================
export async function reactivateLicense(licenseId, newDays = null, newMachineId = null) {
  const db = await initDB();
  const now = new Date();

  const license = await db.get(
    `SELECT l.*, s.status as sub_status, s.expiry_date as sub_expiry 
     FROM licenses l
     LEFT JOIN subscriptions s ON l.subscription_id = s.id
     WHERE l.id = ?`,
    [licenseId]
  );

  if (!license) {
    throw new Error("license_not_found");
  }

  const days = newDays || getPlanDurationDays(license.plan, false);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);

  const machineId = newMachineId || license.machine_id;

  await db.run(
    `UPDATE licenses SET status = 'active', expiry = ?, machine_id = ?, last_validation = ? WHERE id = ?`,
    [expiry.toISOString(), machineId, now.toISOString(), licenseId]
  );

  if (license.subscription_id) {
    await db.run(
      `UPDATE subscriptions SET status = 'active', expiry_date = ? WHERE id = ?`,
      [expiry.toISOString(), license.subscription_id]
    );
  }

  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [licenseId, machineId, "reactivated", now.toISOString()]
  );

  return {
    success: true,
    licenseId,
    newExpiry: expiry.toISOString(),
    days,
    machineId,
  };
}

// =========================================================
// EDITAR LICENCA
// =========================================================
export async function updateLicense(licenseId, { plan, expiry, status, client, machineId }) {
  const db = await initDB();

  const license = await db.get(`SELECT * FROM licenses WHERE id = ?`, [licenseId]);
  if (!license) {
    throw new Error("license_not_found");
  }

  const updates = [];
  const values = [];

  if (plan !== undefined) { updates.push("plan = ?"); values.push(plan); }
  if (expiry !== undefined) { updates.push("expiry = ?"); values.push(expiry); }
  if (status !== undefined) { updates.push("status = ?"); values.push(status); }
  if (client !== undefined) { updates.push("client = ?"); values.push(client); }
  if (machineId !== undefined) { updates.push("machine_id = ?"); values.push(machineId); }

  if (updates.length === 0) {
    throw new Error("no_fields_to_update");
  }

  values.push(licenseId);
  await db.run(`UPDATE licenses SET ${updates.join(", ")} WHERE id = ?`, values);

  // Sincronizar subscricao
  if (plan !== undefined || expiry !== undefined || status !== undefined) {
    const subUpdates = [];
    const subValues = [];
    if (plan !== undefined) { subUpdates.push("plan = ?"); subValues.push(plan); }
    if (expiry !== undefined) { subUpdates.push("expiry_date = ?"); subValues.push(expiry); }
    if (status !== undefined) {
      const subStatus = status === 'active' ? 'active' : (status === 'revoked' ? 'cancelled' : status);
      subUpdates.push("status = ?"); subValues.push(subStatus);
    }
    if (subUpdates.length > 0 && license.subscription_id) {
      subValues.push(license.subscription_id);
      await db.run(`UPDATE subscriptions SET ${subUpdates.join(", ")} WHERE id = ?`, subValues);
    }
  }

  return { success: true, licenseId };
}