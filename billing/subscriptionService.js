import { initDB } from "../db.js";
import { PLANS } from "./plans.js";
import crypto from "crypto";

export async function createSubscription({ client, plan }) {
  const db = await initDB();

  const selectedPlan = PLANS[plan];
  if (!selectedPlan) throw new Error("invalid_plan");

  const id = crypto.randomUUID();

  const now = new Date();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + selectedPlan.days);

  // CORRECAO: Adicionados start_date, payment_status e created_at (obrigatorios no schema Turso)
  await db.run(
    `INSERT INTO subscriptions 
     (id, client, plan, status, start_date, expiry_date, payment_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, client, plan, "active", now.toISOString(), expiry.toISOString(), "pending", now.toISOString()]
  );

  return { id, expiry };
}

export async function getSubscription(client) {
  const db = await initDB();

  return await db.get(
    `SELECT * FROM subscriptions WHERE client = ? AND status = 'active'`,
    [client]
  );
}

export async function isSubscriptionValid(client) {
  const sub = await getSubscription(client);

  if (!sub) return false;

  if (new Date(sub.expiry) < new Date()) {
    return false;
  }

  return true;
}