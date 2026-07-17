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
});

export default app;
