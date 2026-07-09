import { v4 as uuidv4 } from 'uuid';
import { initDB } from '../db.js';

// =========================================================
// CREATE SUBSCRIPTION
// =========================================================
export async function createSubscription({ client, email, plan, days, isTrial = false }) {
  const db = await initDB();
  const now = new Date();
  const expiry = new Date();

  const durationDays = days || (isTrial ? 7 : 30);
  expiry.setDate(expiry.getDate() + durationDays);

  const id = uuidv4();
  const status = isTrial ? 'trial' : 'active';
  const paymentStatus = isTrial ? 'trial' : 'pending';

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
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    },
  };
}

// =========================================================
// GET SUBSCRIPTION
// =========================================================
export async function getSubscription(client) {
  const db = await initDB();

  const row = await db.get(
    `
    SELECT *
    FROM subscriptions
    WHERE client = ?
    ORDER BY created_at DESC
    LIMIT 1
    `,
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

  if (row.status !== 'active' && row.status !== 'trial') {
    return {
      active: false,
      reason: 'subscription_inactive',
      subscription: row,
    };
  }

  if (now > endDate) {
    if (row.status === 'trial') {
      return {
        active: false,
        reason: 'trial_expired',
        subscription: row,
      };
    }
    return {
      active: false,
      reason: 'subscription_expired',
      subscription: row,
    };
  }

  return {
    active: true,
    subscription: row,
  };
}

// =========================================================
// SIMULATE PAYMENT
// =========================================================
export async function simulatePayment(subscriptionId) {
  const db = await initDB();

  const sub = await db.get(
    `
    SELECT *
    FROM subscriptions
    WHERE id = ?
    `,
    [subscriptionId]
  );

  if (!sub) {
    return {
      success: false,
      error: 'subscription_not_found',
    };
  }

  await db.run(
    `
    UPDATE subscriptions
    SET payment_status = 'paid'
    WHERE id = ?
    `,
    [subscriptionId]
  );

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
      sub.client,
      99.99,
      'EUR',
      'manual',
      'completed',
      'SIM-' + Date.now(),
      new Date().toISOString(),
    ]
  );

  return {
    success: true,
    paymentId,
    subscriptionId,
    status: 'paid',
  };
}