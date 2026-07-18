import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import licenseRoutes from './routes/licenseRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import remoteRoutes from './routes/remoteRoutes.js'; // NOVO: Dashboard remoto

// Rotas POS
import productRoutes from './routes/productRoutes.js';
import saleRoutes from './routes/saleRoutes.js';

// =========================================================
// IMPORTS ADICIONAIS (NOVOS)
// =========================================================
import { getSubscriptionByEmail } from "./services/billingService.js";

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.get('/', (req, res) => {
  res.json({
    status: 'VMP SaaS Control Plane Online',
    version: '2.3.2',
    mode: 'enterprise-saas',
    services: {
      auth: true,
      licensing: true,
      billing: true,
      finance: true,
      stats: true,
      public: true,
      pos_products: true,
      pos_sales: true,
      remote_dashboard: true,
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vmp-license-server',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '2.3.2',
  });
});

// =========================================================
// ROTAS API
// =========================================================

app.use('/api/auth', authRoutes);
app.use('/api/licenses', licenseRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/remote', remoteRoutes); // NOVO: Dashboard remoto com auth
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);

// =========================================================
// BILLING STATUS POR EMAIL (NOVO — corrige 404 /api/billing/status/:email)
// =========================================================
app.get("/api/billing/status/:email", async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        error: "missing_email",
        message: "Email e obrigatorio",
      });
    }

    const result = await getSubscriptionByEmail(email);
    return res.json(result);

  } catch (e) {
    console.error("BILLING STATUS ERROR:", e);
    return res.status(500).json({
      error: "server_error",
      details: e.message,
    });
  }
});

// =========================================================
// ADMIN ACTIVATION REQUESTS (NOVO — corrige aprovacao no painel)
// =========================================================

// GET /api/admin/activation-requests
app.get("/api/admin/activation-requests", async (req, res) => {
  try {
    const { status } = req.query;
    const { initDB } = await import('./db.js');
    const db = await initDB();

    let whereClause = "1=1";
    const args = [];

    if (status && status !== 'all') {
      whereClause += " AND status = ?";
      args.push(status);
    }

    const requests = await db.all(
      `SELECT * FROM activation_requests WHERE ${whereClause} ORDER BY created_at DESC`,
      args
    );

    return res.json({
      success: true,
      requests,
      count: requests.length,
    });

  } catch (e) {
    console.error("LIST ACTIVATION REQUESTS ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// POST /api/admin/activation-requests/:id/approve
app.post("/api/admin/activation-requests/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { adminEmail } = req.body;

    const { initDB } = await import('./db.js');
    const db = await initDB();

    // Buscar pedido
    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [id]
    );

    if (!request) {
      return res.status(404).json({ error: "request_not_found" });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        error: "already_processed",
        message: `Pedido ja esta ${request.status}`,
      });
    }

    // Gerar licenca
    const { generateLicense } = await import('./services/licenseService.js');
    const result = await generateLicense(
      request.machine_id,
      request.client_email,
      request.plan,
      null
    );

    // Atualizar pedido
    const now = new Date().toISOString();
    await db.run(
      `UPDATE activation_requests SET status = ?, license_id = ?, approved_at = ?, approved_by = ? WHERE id = ?`,
      ['approved', result.licenseId, now, adminEmail || 'admin', id]
    );

    // Log
    await db.run(
      `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
      [result.licenseId, request.machine_id, "approved_remote", now]
    );

    // Enviar email com a licenca (se SendGrid configurado)
    try {
      const { sendEmail, licenseApprovedTemplate } = await import('./services/emailService_sendgrid.js');
      const template = licenseApprovedTemplate(request.client_email, result.licenseKey, result.plan, result.expiry);
      await sendEmail({ to: request.client_email, ...template });
    } catch (emailErr) {
      console.log("EMAIL SEND SKIPPED:", emailErr.message);
    }

    return res.json({
      success: true,
      message: "Licenca aprovada e gerada com sucesso",
      license: {
        licenseId: result.licenseId,
        licenseKey: result.licenseKey,
        plan: result.plan,
        expiry: result.expiry,
      },
    });

  } catch (e) {
    console.error("APPROVE REQUEST ERROR:", e);
    return res.status(500).json({
      error: "server_error",
      details: e.message,
    });
  }
});

// POST /api/admin/activation-requests/:id/reject
app.post("/api/admin/activation-requests/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { initDB } = await import('./db.js');
    const db = await initDB();

    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [id]
    );

    if (!request) {
      return res.status(404).json({ error: "request_not_found" });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        error: "already_processed",
        message: `Pedido ja esta ${request.status}`,
      });
    }

    const now = new Date().toISOString();
    await db.run(
      `UPDATE activation_requests SET status = ?, rejected_at = ?, rejection_reason = ? WHERE id = ?`,
      ['rejected', now, reason || 'Sem motivo', id]
    );

    return res.json({
      success: true,
      message: "Pedido rejeitado",
    });

  } catch (e) {
    console.error("REJECT REQUEST ERROR:", e);
    return res.status(500).json({
      error: "server_error",
    });
  }
});

// =========================================================
// FINANCE OVERVIEW
// =========================================================
app.get('/api/finance/overview', async (req, res) => {
  try {
    const { initDB } = await import('./db.js');
    const db = await initDB();

    const todayRevenue = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM sales 
      WHERE date(created_at, '+2 hours') = date('now', '+2 hours') AND status = 'completed'
    `);

    const monthRevenue = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM sales 
      WHERE strftime('%Y-%m', created_at, '+2 hours') = strftime('%Y-%m', 'now', '+2 hours') 
      AND status = 'completed'
    `);

    const totalRevenue = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM sales 
      WHERE status = 'completed'
    `);

    const activeSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions WHERE status='active'`);
    const trialSubs = await db.get(`SELECT COUNT(*) as c FROM subscriptions WHERE status='trial'`);

    res.json({
      revenue: {
        today: todayRevenue.total || 0,
        month: monthRevenue.total || 0,
        total: totalRevenue.total || 0,
      },
      subscriptions: {
        active: activeSubs.c || 0,
        trial: trialSubs.c || 0,
        total: (activeSubs.c || 0) + (trialSubs.c || 0),
      },
      churnRate: 0,
      mrr: 0,
      arr: 0,
    });

  } catch (e) {
    console.error('FINANCE OVERVIEW ERROR:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// =========================================================
// PUBLIC PLANS
// =========================================================
app.get('/api/public/plans', (req, res) => {
  res.json({
    success: true,
    plans: {
      basic: {
        name: 'Basic',
        price: 3500,
        days: 30,
        maxUsers: 2,
        maxProducts: 500,
        features: ['pos', 'inventory', 'cash_register', 'basic_reports', 'z_report'],
      },
      pro: {
        name: 'Pro',
        price: 7000,
        days: 30,
        maxUsers: 5,
        maxProducts: 5000,
        features: ['pos', 'inventory', 'cash_register', 'advanced_reports', 'z_report', 'promotions', 'customers', 'multi_warehouse', 'analytics'],
      },
      enterprise: {
        name: 'Enterprise',
        price: 150000,
        days: 365,
        maxUsers: 999,
        maxProducts: 99999,
        features: ['pos', 'inventory', 'cash_register', 'advanced_reports', 'z_report', 'promotions', 'customers', 'multi_warehouse', 'analytics', 'accounting', 'profit_margin', 'remote_dashboard', 'priority_support', 'api_access'],
      },
    }
  });
});

// =========================================================
// PUBLIC VERSION
// =========================================================
app.get('/api/public/version', (req, res) => {
  res.json({
    version: '2.3.2',
    downloadUrl: 'https://vmp-landing.vercel.app/download',
    releaseNotes: 'Dashboard remoto com autenticação, correções de timezone, melhorias de segurança',
    forceUpdate: false,
  });
});

// =========================================================
// ERROR HANDLERS
// =========================================================
app.use((req, res) => {
  res.status(404).json({ error: 'route_not_found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error('SERVER_ERROR:', err);
  res.status(500).json({ error: 'internal_server_error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VMP SaaS Control Plane v2.3.2 running on port ${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - Auth:           /api/auth`);
  console.log(`  - Licenses:       /api/licenses`);
  console.log(`  - Billing:        /api/billing`);
  console.log(`  - Admin:          /api/admin`);
  console.log(`  - Stats:          /api/stats`);
  console.log(`  - Public:         /api/public`);
  console.log(`  - Remote:         /api/remote/*  (NOVO: auth + dashboard)`);
  console.log(`  - POS Products:   /api/products`);
  console.log(`  - POS Sales:      /api/sales`);
  console.log(`  - Billing Status: /api/billing/status/:email  (NOVO)`);
  console.log(`  - Admin Requests: /api/admin/activation-requests  (NOVO)`);
});

export default app;