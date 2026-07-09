import express from "express";

import {
  getFinancialOverview,
  getChurnRate
} from "../services/controlPlaneService.js";

const router = express.Router();

// =========================================================
// FINANCIAL DASHBOARD OVERVIEW
// =========================================================
router.get("/overview", async (req, res) => {
  try {
    const data = await getFinancialOverview();

    return res.json({
      success: true,
      data
    });

  } catch (e) {
    return res.status(500).json({
      error: "server_error",
      details: e.message
    });
  }
});

// =========================================================
// CHURN ANALYTICS
// =========================================================
router.get("/churn", async (req, res) => {
  try {
    const data = await getChurnRate();

    return res.json({
      success: true,
      data
    });

  } catch (e) {
    return res.status(500).json({
      error: "server_error"
    });
  }
});

export default router;