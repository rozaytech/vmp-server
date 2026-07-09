import { initDB } from "../db.js";

/**
 * 💰 SaaS CONTROL PLANE FINANCEIRO
 * - revenue
 * - churn
 * - active subscriptions
 * - MRR (Monthly Recurring Revenue)
 * - subscription health
 */

export async function getFinancialOverview() {
  const db = await initDB();

  // =========================
  // TOTAL SUBSCRIPTIONS
  // =========================
  const totalSubs = await db.get(`
    SELECT COUNT(*) as total
    FROM subscriptions
  `);

  // =========================
  // ACTIVE SUBSCRIPTIONS
  // =========================
  const activeSubs = await db.get(`
    SELECT COUNT(*) as total
    FROM subscriptions
    WHERE status = 'active'
  `);

  // =========================
  // REVOKED / CANCELED
  // =========================
  const revokedSubs = await db.get(`
    SELECT COUNT(*) as total
    FROM subscriptions
    WHERE status != 'active'
  `);

  // =========================
  // EXPIRATIONS
  // =========================
  const expiredSubs = await db.get(`
    SELECT COUNT(*) as total
    FROM subscriptions
    WHERE expiry_date < datetime('now')
  `);

  // =========================
  // MONTHLY RECURRING REVENUE (MRR SIMULATED)
  // =========================
  const revenue = await db.all(`
    SELECT plan
    FROM subscriptions
    WHERE status = 'active'
  `);

  const planPricing = {
    basic: 5,
    pro: 15,
    enterprise: 40
  };

  let mrr = 0;

  revenue.forEach((sub) => {
    mrr += planPricing[sub.plan] || 0;
  });

  // =========================
  // LAST 10 SUBSCRIPTIONS
  // =========================
  const lastSubs = await db.all(`
    SELECT *
    FROM subscriptions
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return {
    totalSubscriptions: totalSubs.total,
    activeSubscriptions: activeSubs.total,
    revokedSubscriptions: revokedSubs.total,
    expiredSubscriptions: expiredSubs.total,
    mrr,
    lastSubscriptions: lastSubs
  };
}

// =========================================================
// CHURN RATE (SIMPLIFIED)
// =========================================================
export async function getChurnRate() {
  const db = await initDB();

  const total = await db.get(`
    SELECT COUNT(*) as total FROM subscriptions
  `);

  const inactive = await db.get(`
    SELECT COUNT(*) as total
    FROM subscriptions
    WHERE status != 'active'
  `);

  const churn = total.total === 0
    ? 0
    : (inactive.total / total.total) * 100;

  return {
    churnRate: churn.toFixed(2) + "%"
  };
}