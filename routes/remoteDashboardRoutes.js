import express from "express";
import { initDB } from "../db.js";

const router = express.Router();

// =========================================================
// REMOTE DASHBOARD — Dono monitora negocio pelo celular/PC
// GET /api/remote/dashboard/:licenseId
// =========================================================
router.get("/dashboard/:licenseId", async (req, res) => {
  try {
    const db = await initDB();
    const { licenseId } = req.params;

    // Verificar licenca
    const license = await db.get(
      `SELECT l.*, s.client as sub_client, s.plan as sub_plan, s.expiry_date as sub_expiry
       FROM licenses l
       LEFT JOIN subscriptions s ON l.subscription_id = s.id
       WHERE l.id = ? AND l.status = 'active'`,
      [licenseId]
    );

    if (!license) {
      return res.status(404).json({
        success: false,
        error: "license_not_found_or_inactive",
      });
    }

    // Verificar se nao expirou
    const now = new Date();
    const expiry = new Date(license.expiry || license.sub_expiry);
    if (now > expiry) {
      return res.status(403).json({
        success: false,
        error: "license_expired",
        expiry: expiry.toISOString(),
      });
    }

    // Verificar se plano tem remote_dashboard
    const plan = license.sub_plan || license.plan;
    const PLANS = {
      basic: { features: [] },
      pro: { features: [] },
      enterprise: { features: ["remote_dashboard"] },
    };

    if (!PLANS[plan]?.features?.includes("remote_dashboard")) {
      return res.status(403).json({
        success: false,
        error: "feature_not_available",
        message: "Remote dashboard disponivel apenas no plano Enterprise",
        requiredPlan: "enterprise",
      });
    }

    // Stats de vendas hoje
    const todaySales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE date(created_at) = date('now') AND status = 'completed'
    `);

    // Stats do mes
    const monthSales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') 
      AND status = 'completed'
    `);

    // Produtos mais vendidos (7 dias)
    const topProducts = await db.all(`
      SELECT p.name, SUM(si.quantity) as qty, SUM(si.total_price) as revenue
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' AND date(s.created_at) >= date('now', '-7 days')
      GROUP BY si.product_id
      ORDER BY qty DESC
      LIMIT 5
    `);

    // Stock baixo
    const lowStock = await db.all(`
      SELECT name, stock, min_stock
      FROM products
      WHERE stock <= min_stock AND is_active = 1
      ORDER BY stock ASC
      LIMIT 10
    `);

    // Sessoes de caixa abertas
    const openSessions = await db.all(`
      SELECT cs.*, pu.name as user_name
      FROM cash_sessions cs
      JOIN pos_users pu ON cs.user_id = pu.id
      WHERE cs.status = 'open'
    `);

    res.json({
      success: true,
      business: {
        name: license.client || license.sub_client || "Negocio",
        plan: plan,
        expiry: expiry.toISOString(),
        daysRemaining: Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)),
      },
      today: {
        sales: todaySales.count || 0,
        revenue: todaySales.total || 0,
      },
      month: {
        sales: monthSales.count || 0,
        revenue: monthSales.total || 0,
      },
      topProducts: topProducts || [],
      alerts: {
        lowStock: lowStock || [],
        openSessions: openSessions || [],
      },
      lastUpdated: new Date().toISOString(),
    });

  } catch (e) {
    console.error("REMOTE DASHBOARD ERROR:", e);
    res.status(500).json({
      success: false,
      error: "server_error",
      details: e.message,
    });
  }
});

export default router;