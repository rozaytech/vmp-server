import { initDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { PLANS } from "../billing/plans.js";

// =========================================================
// CREATE SUBSCRIPTION (com dias editaveis e preco do plano)
// =========================================================
export async function createSubscription(req, res) {
  try {
    const { client, email, plan, days, autoRenew } = req.body;

    if (!client || !plan) {
      return res.status(400).json({ error: "missing_fields", message: "client e plan sao obrigatorios" });
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      return res.status(400).json({ error: "invalid_plan", message: `Plano '${plan}' nao existe` });
    }

    const db = await initDB();
    const now = new Date();
    const expiry = new Date();

    // Usar dias customizados ou padrao do plano
    const durationDays = days || planConfig.days;
    expiry.setDate(expiry.getDate() + durationDays);

    const id = uuidv4();

    await db.run(
      `
      INSERT INTO subscriptions (
        id, client, email, plan, status, start_date, expiry_date,
        payment_status, auto_renew, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        client,
        email || null,
        plan,
        "active",
        now.toISOString(),
        expiry.toISOString(),
        "pending",
        autoRenew ? 1 : 0,
        now.toISOString(),
      ]
    );

    return res.json({
      success: true,
      subscriptionId: id,
      plan,
      expiry: expiry.toISOString(),
      days: durationDays,
      price: planConfig.price,
      currency: "MZN",
    });

  } catch (e) {
    console.error("CREATE SUBSCRIPTION ERROR:", e);
    return res.status(500).json({ error: "server_error", details: e.message });
  }
}

// =========================================================
// LIST SUBSCRIPTIONS (com filtros)
// =========================================================
export async function listSubscriptions(req, res) {
  try {
    const db = await initDB();
    const { status } = req.query;

    let whereClause = "1=1";
    const args = [];

    if (status && status !== "all") {
      whereClause += " AND status = ?";
      args.push(status);
    }

    const rows = await db.all(
      `SELECT * FROM subscriptions WHERE ${whereClause} ORDER BY created_at DESC`,
      args
    );

    // Adicionar dias restantes
    const now = new Date();
    const enriched = rows.map((sub) => {
      const expiry = new Date(sub.expiry_date);
      const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      return {
        ...sub,
        days_remaining: daysLeft > 0 ? daysLeft : 0,
        is_expired: daysLeft <= 0,
      };
    });

    return res.json({
      success: true,
      subscriptions: enriched,
      count: enriched.length,
    });

  } catch (e) {
    console.error("LIST SUBSCRIPTIONS ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

// =========================================================
// SIMULATE PAYMENT (com valor do plano)
// =========================================================
export async function simulatePayment(req, res) {
  try {
    const { subscriptionId, amount, provider } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: "missing_subscription_id" });
    }

    const db = await initDB();

    // Buscar subscricao para saber o cliente e plano
    const sub = await db.get(
      `SELECT * FROM subscriptions WHERE id = ?`,
      [subscriptionId]
    );

    if (!sub) {
      return res.status(404).json({ error: "subscription_not_found" });
    }

    const planConfig = PLANS[sub.plan];
    const paymentAmount = amount || planConfig?.price || 0;

    const paymentId = uuidv4();

    await db.run(
      `
      INSERT INTO payments (
        id, subscription_id, client, amount, currency,
        provider, status, reference, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        paymentId,
        subscriptionId,
        sub.client,
        paymentAmount,
        "MZN",
        provider || "manual",
        "success",
        "SIM-" + Date.now(),
        new Date().toISOString(),
      ]
    );

    await db.run(
      `UPDATE subscriptions SET payment_status = 'paid' WHERE id = ?`,
      [subscriptionId]
    );

    return res.json({
      success: true,
      paymentId,
      amount: paymentAmount,
      currency: "MZN",
      subscriptionId,
    });

  } catch (e) {
    console.error("SIMULATE PAYMENT ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

// =========================================================
// LIST PAYMENTS
// =========================================================
export async function listPayments(req, res) {
  try {
    const db = await initDB();

    const payments = await db.all(
      `SELECT * FROM payments ORDER BY created_at DESC LIMIT 100`
    );

    return res.json({
      success: true,
      data: payments,
      count: payments.length,
    });

  } catch (e) {
    console.error("LIST PAYMENTS ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

// =========================================================
// GET BILLING STATS
// =========================================================
export async function getBillingStats(req, res) {
  try {
    const db = await initDB();

    const totalSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions`);
    const activeSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions WHERE status='active'`);
    const trialSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions WHERE status='trial'`);
    const paidSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions WHERE payment_status='paid'`);

    const revenue = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status='success'`
    );

    // Receita por plano
    const revenueByPlan = await db.all(`
      SELECT s.plan, COALESCE(SUM(p.amount), 0) as total
      FROM payments p
      JOIN subscriptions s ON p.subscription_id = s.id
      WHERE p.status = 'success'
      GROUP BY s.plan
    `);

    return res.json({
      success: true,
      data: {
        total: totalSubs.c || 0,
        active: activeSubs.c || 0,
        trial: trialSubs.c || 0,
        paid: paidSubs.c || 0,
        revenue: revenue.total || 0,
        revenueByPlan: revenueByPlan || [],
      },
    });

  } catch (e) {
    console.error("BILLING STATS ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

// =========================================================
// GET SUBSCRIPTION BY ID
// =========================================================
export async function getSubscriptionById(req, res) {
  try {
    const db = await initDB();
    const { id } = req.params;

    const sub = await db.get(
      `SELECT * FROM subscriptions WHERE id = ?`,
      [id]
    );

    if (!sub) {
      return res.status(404).json({ error: "not_found" });
    }

    const now = new Date();
    const expiry = new Date(sub.expiry_date);
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    return res.json({
      success: true,
      data: {
        ...sub,
        days_remaining: daysLeft > 0 ? daysLeft : 0,
        is_expired: daysLeft <= 0,
      },
    });

  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
}