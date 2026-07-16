import express from "express";
import {
  createSubscription,
  listSubscriptions,
  simulatePayment,
  listPayments,
  getBillingStats,
  getSubscriptionById,
} from "../controllers/billingController.js";

const router = express.Router();

// =========================================================
// CREATE SUBSCRIPTION
// =========================================================
router.post("/create", createSubscription);

// =========================================================
// LIST SUBSCRIPTIONS (com filtro ?status=)
// =========================================================
router.get("/subscriptions", listSubscriptions);

// =========================================================
// GET SUBSCRIPTION BY ID
// =========================================================
router.get("/subscription/:id", getSubscriptionById);

// =========================================================
// LIST PAYMENTS
// =========================================================
router.get("/payments", listPayments);

// =========================================================
// SIMULATE PAYMENT
// =========================================================
router.post("/pay", simulatePayment);

// =========================================================
// BILLING STATS
// =========================================================
router.get("/stats", getBillingStats);

export default router;