import { initDB } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export async function createSubscription(req, res) {
  try {
    const {
      client,
      email,
      plan,
      autoRenew
    } = req.body;

    if (!client || !plan) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const db = await initDB();

    const now = new Date();
    const expiry = new Date();

    const planDaysMap = {
      basic: 30,
      pro: 365,
      enterprise: 3650
    };

    const days = planDaysMap[plan] || 365;

    expiry.setDate(expiry.getDate() + days);

    const id = uuidv4();

    await db.run(
      `
      INSERT INTO subscriptions (
        id,
        client,
        email,
        plan,
        status,
        start_date,
        expiry_date,
        payment_status,
        auto_renew,
        created_at
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
        now.toISOString()
      ]
    );

    return res.json({
      success: true,
      subscriptionId: id,
      expiry: expiry.toISOString()
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function listSubscriptions(req, res) {
  try {
    const db = await initDB();

    const rows = await db.all(`
      SELECT * FROM subscriptions
      ORDER BY created_at DESC
    `);

    return res.json({
      data: rows
    });

  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
}

export async function simulatePayment(req, res) {
  try {
    const {
      subscriptionId,
      amount,
      provider
    } = req.body;

    if (!subscriptionId || !amount) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const db = await initDB();
    const paymentId = uuidv4();

    await db.run(
      `
      INSERT INTO payments (
        id,
        subscription_id,
        client,
        amount,
        currency,
        provider,
        status,
        reference,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        paymentId,
        subscriptionId,
        "unknown",
        amount,
        "MZN",
        provider || "manual",
        "success",
        "SIM-" + Date.now(),
        new Date().toISOString()
      ]
    );

    await db.run(
      `
      UPDATE subscriptions
      SET payment_status = 'paid'
      WHERE id = ?
      `,
      [subscriptionId]
    );

    return res.json({
      success: true,
      paymentId
    });

  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
}

export async function getBillingStats(req, res) {
  try {
    const db = await initDB();

    const totalSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions`);
    const activeSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions WHERE status='active'`);
    const paidSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions WHERE payment_status='paid'`);

    const revenue = await db.get(`
      SELECT SUM(amount) as total FROM payments WHERE status='success'
    `);

    return res.json({
      data: {
        total: totalSubs.c,
        active: activeSubs.c,
        paid: paidSubs.c,
        revenue: revenue.total || 0
      }
    });

  } catch (e) {
    return res.status(500).json({ error: "server_error" });
  }
}