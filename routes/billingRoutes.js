import express from "express";
import {
  createSubscription,
  listSubscriptions,
  simulatePayment,
  listPayments,
  getBillingStats,
  getSubscriptionById,
} from "../controllers/billingController.js";
import { authMiddleware } from "../middleware/authMiddleware.js"; // ADIÇÃO: Proteção admin

const router = express.Router();

// ADIÇÃO: Função para permitir Admin e Super Admin com mensagem clara
function requireAdminOrSuper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const role = (req.user.role || '').toLowerCase().replace(/[\s_-]/g, '');
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'forbidden', message: 'Acesso negado. Apenas Administradores ou Super Admins podem gerir utilizadores.' });
  }
  next();
}

// =========================================================
// CREATE SUBSCRIPTION
// =========================================================
router.post("/create", authMiddleware, requireAdminOrSuper, createSubscription); // ADIÇÃO: Proteção

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
router.post("/pay", authMiddleware, requireAdminOrSuper, simulatePayment); // ADIÇÃO: Proteção

// =========================================================
// BILLING STATS
// =========================================================
router.get("/stats", getBillingStats);

export default router;