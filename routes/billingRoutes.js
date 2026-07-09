import express from "express";
import {
  createSubscription,
  getSubscription,
  simulatePayment
} from "../services/billingService.js";

const router = express.Router();

// =========================================================
// CREATE SUBSCRIPTION
// =========================================================
router.post("/create", async (req, res) => {
  try {
    const { client, email, plan } = req.body;

    if (!client || !plan) {
      return res.status(400).json({
        error: "missing_fields"
      });
    }

    const result = await createSubscription({
      client,
      email,
      plan
    });

    return res.json(result);

  } catch (e) {
    return res.status(500).json({
      error: "server_error",
      details: e.message
    });
  }
});

// =========================================================
// CHECK SUBSCRIPTION
// =========================================================
router.get("/status/:client", async (req, res) => {
  try {
    const result = await getSubscription(req.params.client);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({
      error: "server_error"
    });
  }
});

// =========================================================
// SIMULATE PAYMENT
// =========================================================
router.post("/pay", async (req, res) => {
  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({
        error: "missing_subscription_id"
      });
    }

    const result = await simulatePayment(subscriptionId);

    return res.json(result);

  } catch (e) {
    return res.status(500).json({
      error: "server_error"
    });
  }
});

export default router;