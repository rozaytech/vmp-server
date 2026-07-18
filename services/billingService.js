import { v4 as uuidv4 } from 'uuid';
import { initDB } from '../db.js';
import { PLANS } from '../billing/plans.js';

// =========================================================
// CREATE SUBSCRIPTION (usado por outros servicos)
// =========================================================
export async function createSubscription({ client, email, plan, days, isTrial = false, autoRenew = false }) {
  const db = await initDB();
  const now = new Date();
  const expiry = new Date();

  const planConfig = PLANS[plan];
  const durationDays = days || (isTrial ? 7 : (planConfig?.days || 30));
  expiry.setDate(expiry.getDate() + durationDays);

  const id = uuidv4();
  const status = isTrial ? 'trial' : 'active';
  const paymentStatus = isTrial ? 'trial' : 'pending';

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
      status,
      now.toISOString(),
      expiry.toISOString(),
      paymentStatus,
      autoRenew ? 1 : 0,
      now.toISOString(),
    ]
  );

  return {
    success: true,
    subscription: {
      id,
      client,
      email,
      plan,
      status,
      startDate: now.toISOString(),
      endDate: expiry.toISOString(),
      paymentStatus,
      days: durationDays,
      price: planConfig?.price || 0,
    },
  };
}

// =========================================================
// GET SUBSCRIPTION (por client/name)
// =========================================================
export async function getSubscription(client) {
  const db = await initDB();

  const row = await db.get(
    `SELECT * FROM subscriptions WHERE client = ? ORDER BY created_at DESC LIMIT 1`,
    [client]
  );

  if (!row) {
    return {
      active: false,
      reason: 'no_subscription',
    };
  }

  const now = new Date();
  const endDate = new Date(row.expiry_date);
  const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

  if (row.status !== 'active' && row.status !== 'trial') {
    return {
      active: false,
      reason: 'subscription_inactive',
      subscription: row,
      daysLeft: daysLeft > 0 ? daysLeft : 0,
    };
  }

  if (now > endDate) {
    if (row.status === 'trial') {
      return {
        active: false,
        reason: 'trial_expired',
        subscription: row,
        daysLeft: 0,
      };
    }
    return {
      active: false,
      reason: 'subscription_expired',
      subscription: row,
      daysLeft: 0,
    };
  }

  return {
    active: true,
    subscription: row,
    daysLeft: daysLeft > 0 ? daysLeft : 0,
    plan: row.plan,
    features: PLANS[row.plan]?.features || [],
  };
}

// =========================================================
// GET SUBSCRIPTION BY EMAIL (novo — para /api/billing/status/:email)
// =========================================================
export async function getSubscriptionByEmail(email) {
  const db = await initDB();

  const row = await db.get(
    `SELECT * FROM subscriptions WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
    [email]
  );

  if (!row) {
    return {
      active: false,
      reason: 'no_subscription',
    };
  }

  const now = new Date();
  const endDate = new Date(row.expiry_date);
  const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

  if (row.status !== 'active' && row.status !== 'trial') {
    return {
      active: false,
      reason: 'subscription_inactive',
      subscription: row,
      daysLeft: daysLeft > 0 ? daysLeft : 0,
    };
  }

  if (now > endDate) {
    if (row.status === 'trial') {
      return {
        active: false,
        reason: 'trial_expired',
        subscription: row,
        daysLeft: 0,
      };
    }
    return {
      active: false,
      reason: 'subscription_expired',
      subscription: row,
      daysLeft: 0,
    };
  }

  return {
    active: true,
    subscription: row,
    daysLeft: daysLeft > 0 ? daysLeft : 0,
    plan: row.plan,
    features: PLANS[row.plan]?.features || [],
  };
}

// =========================================================
// SIMULATE PAYMENT
// =========================================================
export async function simulatePayment(subscriptionId, amount) {
  const db = await initDB();

  const sub = await db.get(
    `SELECT * FROM subscriptions WHERE id = ?`,
    [subscriptionId]
  );

  if (!sub) {
    return {
      success: false,
      error: 'subscription_not_found',
    };
  }

  const planConfig = PLANS[sub.plan];
  const paymentAmount = amount || planConfig?.price || 99.99;

  await db.run(
    `UPDATE subscriptions SET payment_status = 'paid' WHERE id = ?`,
    [subscriptionId]
  );

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
      'MZN',
      'manual',
      'success',
      'SIM-' + Date.now(),
      new Date().toISOString(),
    ]
  );

  return {
    success: true,
    paymentId,
    subscriptionId,
    amount: paymentAmount,
    currency: 'MZN',
    status: 'paid',
  };
}

// =========================================================
// CHECK FEATURE AVAILABILITY
// =========================================================
export function hasFeature(planCode, feature) {
  return PLANS[planCode]?.features?.includes(feature) || false;
}

// =========================================================
// GET PLAN INFO
// =========================================================
export function getPlanInfo(planCode) {
  return PLANS[planCode] || null;
}