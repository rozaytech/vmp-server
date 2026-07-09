import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { initDB } from '../db.js';
import { createSubscription, getSubscription } from './billingService.js';

const SECRET = "VMP_SAAS_SECRET_2026";

// =========================================================
// GENERATE LICENSE
// =========================================================
export async function generateLicense(machineId, client, plan, days = 365, isTrial = false) {
  const db = await initDB();

  const subResult = await createSubscription({ client, email: null, plan, days, isTrial });
  const subscription = subResult.subscription;

  const now = new Date();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + (days || (isTrial ? 7 : 365)));

  const payload = {
    id: uuidv4(),
    machineId,
    client,
    plan,
    subscriptionId: subscription.id,
    status: "active",
    issuedAt: now.toISOString(),
    expiry: expiry.toISOString(),
  };

  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');

  await db.run(
    `
    INSERT INTO licenses (
      id,
      machine_id,
      client,
      plan,
      subscription_id,
      expiry,
      status,
      created_at,
      last_validation
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.id,
      machineId,
      client,
      plan,
      subscription.id,
      payload.expiry,
      payload.status,
      now.toISOString(),
      now.toISOString(),
    ]
  );

  await db.run(
    `
    INSERT INTO billing_events (
      subscription_id,
      event,
      payload,
      created_at
    )
    VALUES (?, ?, ?, ?)
    `,
    [
      subscription.id,
      isTrial ? 'trial_started' : 'license_generated',
      JSON.stringify({
        client,
        plan,
        machineId,
        licenseId: payload.id,
        subscriptionId: subscription.id,
      }),
      now.toISOString(),
    ]
  );

  await db.run(
    `
    INSERT INTO license_logs (
      license_id,
      machine_id,
      action,
      created_at
    )
    VALUES (?, ?, ?, ?)
    `,
    [
      payload.id,
      machineId,
      isTrial ? 'trial_started' : 'license_generated',
      now.toISOString(),
    ]
  );

  return {
    success: true,
    subscription,
    license: Buffer.from(
      JSON.stringify({
        payload,
        signature,
      })
    ).toString('base64'),
  };
}

// =========================================================
// VALIDATE LICENSE
// =========================================================
export async function validateLicense(license, machineId) {
  const db = await initDB();

  try {
    const decoded = JSON.parse(
      Buffer.from(license, 'base64').toString()
    );

    const payload = decoded.payload;
    const signature = decoded.signature;

    const check = crypto
      .createHmac('sha256', SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (check !== signature) {
      return {
        valid: false,
        reason: 'invalid_signature',
      };
    }

    if (payload.machineId !== machineId) {
      return {
        valid: false,
        reason: 'machine_mismatch',
      };
    }

    if (new Date(payload.expiry) < new Date()) {
      return {
        valid: false,
        reason: 'expired',
      };
    }

    const row = await db.get(
      `
      SELECT *
      FROM licenses
      WHERE id = ?
      `,
      [payload.id]
    );

    if (!row) {
      return {
        valid: false,
        reason: 'license_not_found',
      };
    }

    if (row.status !== 'active') {
      return {
        valid: false,
        reason: 'revoked',
      };
    }

    if (row.subscription_id) {
      const subRow = await db.get(
        `
        SELECT *
        FROM subscriptions
        WHERE id = ?
        `,
        [row.subscription_id]
      );

      if (!subRow) {
        return {
          valid: false,
          reason: 'subscription_not_found',
        };
      }

      if (subRow.status !== 'active' && subRow.status !== 'trial') {
        return {
          valid: false,
          reason: 'subscription_inactive',
        };
      }

      const now = new Date();
      const subEnd = new Date(subRow.expiry_date);
      if (now > subEnd) {
        if (subRow.status === 'trial') {
          return {
            valid: false,
            reason: 'trial_expired',
          };
        }
        return {
          valid: false,
          reason: 'subscription_expired',
        };
      }
    }

    await db.run(
      `
      UPDATE licenses
      SET last_validation = ?
      WHERE id = ?
      `,
      [
        new Date().toISOString(),
        payload.id,
      ]
    );

    await db.run(
      `
      INSERT INTO billing_events (
        subscription_id,
        event,
        payload,
        created_at
      )
      VALUES (?, ?, ?, ?)
      `,
      [
        row.subscription_id,
        'license_validated',
        JSON.stringify({
          licenseId: payload.id,
          machineId,
        }),
        new Date().toISOString(),
      ]
    );

    await db.run(
      `
      INSERT INTO license_logs (
        license_id,
        machine_id,
        action,
        created_at
      )
      VALUES (?, ?, ?, ?)
      `,
      [
        payload.id,
        machineId,
        'license_validated',
        new Date().toISOString(),
      ]
    );

    return {
      valid: true,
      payload,
    };
  } catch (e) {
    console.error('VALIDATE LICENSE ERROR:', e);
    return {
      valid: false,
      reason: 'corrupted_license',
    };
  }
}