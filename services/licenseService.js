import { initDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { PLANS, getPlanFeatures } from "../billing/plans.js";

const SECRET_KEY = process.env.LICENSE_SECRET || "vmp-saas-secret-2026";

function hashLicense(data) {
  return crypto
    .createHmac("sha256", SECRET_KEY)
    .update(data)
    .digest("hex");
}

function generateLicenseKey(machineId, plan, expiry, subscriptionId) {
  const payload = `${machineId}:${plan}:${expiry}:${subscriptionId}:${Date.now()}`;
  const signature = hashLicense(payload);
  return Buffer.from(`${payload}:${signature}`).toString("base64");
}

export async function generateLicense(machineId, client, plan, customDays) {
  const db = await initDB();

  const planConfig = PLANS[plan];
  if (!planConfig) {
    throw new Error("invalid_plan");
  }

  const days = customDays || planConfig.days;
  const now = new Date();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);

  const subscriptionId = uuidv4();
  const licenseId = uuidv4();

  // Criar subscrição
  await db.run(
    `INSERT INTO subscriptions (
      id, client, email, plan, status, start_date, expiry_date,
      payment_status, auto_renew, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      subscriptionId,
      client,
      null,
      plan,
      "active",
      now.toISOString(),
      expiry.toISOString(),
      "pending",
      0,
      now.toISOString(),
    ]
  );

  // Criar licença vinculada à subscrição
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

  // Log
  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [licenseId, machineId, "generated", now.toISOString()]
  );

  return {
    licenseId,
    subscriptionId,
    licenseKey,
    plan,
    expiry: expiry.toISOString(),
    days,
    features: getPlanFeatures(plan),
  };
}

export async function validateLicense(licenseKey, machineId) {
  const db = await initDB();

  // Decodificar licença
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

  const [licMachineId, plan, expiryStr, subscriptionId] = parts;
  const signature = parts[parts.length - 1];

  // Verificar assinatura
  const payload = parts.slice(0, -1).join(":");
  const expectedSig = hashLicense(payload);
  if (signature !== expectedSig) {
    return { valid: false, error: "invalid_signature" };
  }

  // Verificar machine ID
  if (licMachineId !== machineId) {
    return { valid: false, error: "machine_mismatch" };
  }

  // Verificar expiração
  const expiry = new Date(expiryStr);
  const now = new Date();
  if (expiry < now) {
    return { valid: false, error: "expired", expiry: expiryStr };
  }

  // Verificar no banco se ainda está ativa
  const dbLicense = await db.get(
    `SELECT * FROM licenses WHERE subscription_id = ? AND status = 'active'`,
    [subscriptionId]
  );

  if (!dbLicense) {
    return { valid: false, error: "revoked" };
  }

  // Atualizar last_validation
  await db.run(
    `UPDATE licenses SET last_validation = ? WHERE id = ?`,
    [now.toISOString(), dbLicense.id]
  );

  // Buscar subscrição para feature flags
  const subscription = await db.get(
    `SELECT * FROM subscriptions WHERE id = ?`,
    [subscriptionId]
  );

  return {
    valid: true,
    plan,
    expiry: expiryStr,
    daysRemaining: Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)),
    features: getPlanFeatures(plan),
    subscriptionId,
    licenseId: dbLicense.id,
    client: dbLicense.client,
    paymentStatus: subscription?.payment_status || "unknown",
  };
}

/// TRANSFERIR LICENÇA: quebrou computador, passar para outro
export async function transferLicense(oldLicenseId, newMachineId, reason) {
  const db = await initDB();

  const oldLicense = await db.get(
    `SELECT * FROM licenses WHERE id = ? AND status = 'active'`,
    [oldLicenseId]
  );

  if (!oldLicense) {
    throw new Error("license_not_found_or_inactive");
  }

  // Calcular dias restantes
  const now = new Date();
  const oldExpiry = new Date(oldLicense.expiry);
  const daysRemaining = Math.ceil((oldExpiry - now) / (1000 * 60 * 60 * 24));

  if (daysRemaining <= 0) {
    throw new Error("license_expired");
  }

  // Revogar licença antiga
  await db.run(
    `UPDATE licenses SET status = 'revoked', last_validation = ? WHERE id = ?`,
    [now.toISOString(), oldLicenseId]
  );

  // Log da revogação
  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [oldLicenseId, oldLicense.machine_id, "revoked_for_transfer", now.toISOString()]
  );

  // Criar nova licença com dias restantes
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

  // Log da nova licença
  await db.run(
    `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
    [newLicenseId, newMachineId, "transferred", now.toISOString()]
  );

  // Audit log
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

/// LISTAR LICENÇAS com detalhes da subscrição
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

/// REVOGAR LICENÇA
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