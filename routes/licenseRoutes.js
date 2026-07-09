import express from "express";
import { generateLicense, validateLicense } from "../services/licenseService.js";

const router = express.Router();

// =========================================================
// GENERATE LICENSE
// =========================================================
router.post("/generate", async (req, res) => {
  try {
    const { machineId, client, plan, days } = req.body;

    if (!machineId || !client || !plan) {
      return res.status(400).json({
        error: "missing_fields",
        message: "machineId, client e plan são obrigatórios",
      });
    }

    const result = await generateLicense(
      machineId,
      client,
      plan,
      days || 365
    );

    return res.json(result);

  } catch (e) {
    console.error("GENERATE LICENSE ERROR:", e);
    return res.status(500).json({
      error: "server_error",
      details: e.message,
    });
  }
});

// =========================================================
// VALIDATE LICENSE
// =========================================================
router.post("/validate", async (req, res) => {
  try {
    const { license, machineId } = req.body;

    if (!license || !machineId) {
      return res.status(400).json({
        error: "missing_fields",
      });
    }

    const result = await validateLicense(license, machineId);

    return res.json(result);

  } catch (e) {
    console.error("VALIDATE LICENSE ERROR:", e);
    return res.status(500).json({
      error: "server_error",
    });
  }
});

export default router;