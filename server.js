import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import licenseRoutes from './routes/licenseRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import publicRoutes from './routes/publicRoutes.js';

// NOVO: Rotas POS
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
    version: '2.3.1',
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
    version: '2.3.1',
  });
});

// =========================================================
// ROTAS API
// =========================================================

// Auth
app.use('/api/auth', authRoutes);

// Licenciamento (novo com transferencia, revogacao, listagem)
app.use('/api/licenses', licenseRoutes);

// Admin
app.use('/api/admin', adminRoutes);

// Billing (atualizado com payments, stats, subscricoes)
app.use('/api/billing', billingRoutes);

// Stats
app.use('/api/stats', statsRoutes);

// Public
app.use('/api/public', publicRoutes);

// POS
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);

// =========================================================
// REMOTE DASHBOARD - Dono monitora negocio pelo celular/PC
// =========================================================
app.get('/api/remote/dashboard/:licenseId', async (req, res) => {
  try {
    const { initDB } = await import('./db.js');
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
        error: 'license_not_found_or_inactive'
      });
    }

    // Verificar se nao expirou
    const now = new Date();
    const expiry = new Date(license.expiry || license.sub_expiry);
    if (now > expiry) {
      return res.status(403).json({
        success: false,
        error: 'license_expired',
        expiry: expiry.toISOString()
      });
    }

    // Verificar se plano tem remote_dashboard (enterprise)
    const plan = license.sub_plan || license.plan;
    const PLANS = {
      basic: { features: [] },
      pro: { features: [] },
      enterprise: { features: ['remote_dashboard'] }
    };

    if (!PLANS[plan]?.features?.includes('remote_dashboard')) {
      return res.status(403).json({
        success: false,
        error: 'feature_not_available',
        message: 'Remote dashboard disponivel apenas no plano Enterprise',
        requiredPlan: 'enterprise'
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
        name: license.client || license.sub_client || 'Negocio',
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
    console.error('REMOTE DASHBOARD ERROR:', e);
    res.status(500).json({
      success: false,
      error: 'server_error',
      details: e.message
    });
  }
});

// =========================================================
// FINANCE OVERVIEW (atualizado com dados reais)
// =========================================================
app.get('/api/finance/overview', async (req, res) => {
  try {
    const { initDB } = await import('./db.js');
    const db = await initDB();

    const today = new Date().toISOString().split('T')[0];

    const todayRevenue = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM sales 
      WHERE date(created_at) = date('now') AND status = 'completed'
    `);

    const monthRevenue = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total 
      FROM sales 
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') 
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
// PUBLIC PLANS (para o app mostrar precos)
// =========================================================
app.get('/api/public/plans', (req, res) => {
  res.json({
    success: true,
    plans: {
      basic: {
        name: 'Basic',
        price: 1500,
        days: 30,
        maxUsers: 2,
        maxProducts: 500,
        features: ['pos', 'inventory', 'cash_register', 'basic_reports', 'z_report'],
      },
      pro: {
        name: 'Pro',
        price: 3500,
        days: 30,
        maxUsers: 5,
        maxProducts: 5000,
        features: ['pos', 'inventory', 'cash_register', 'advanced_reports', 'z_report', 'promotions', 'customers', 'multi_warehouse', 'analytics'],
      },
      enterprise: {
        name: 'Enterprise',
        price: 8500,
        days: 365,
        maxUsers: 999,
        maxProducts: 99999,
        features: ['pos', 'inventory', 'cash_register', 'advanced_reports', 'z_report', 'promotions', 'customers', 'multi_warehouse', 'analytics', 'accounting', 'profit_margin', 'remote_dashboard', 'priority_support', 'api_access'],
      },
    }
  });
});

// =========================================================
// PUBLIC VERSION (para auto-update)
// =========================================================
app.get('/api/public/version', (req, res) => {
  res.json({
    version: '2.3.1',
    downloadUrl: 'https://vmp-landing.vercel.app/download',
    releaseNotes: 'Correcoes de bugs, feature flags, painel remoto, transferencia de licencas',
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
  console.log(`VMP SaaS Control Plane v2.3.1 running on port ${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - Auth:           /api/auth`);
  console.log(`  - Licenses:       /api/licenses`);
  console.log(`  - Billing:        /api/billing`);
  console.log(`  - Admin:          /api/admin`);
  console.log(`  - Stats:          /api/stats`);
  console.log(`  - Public:         /api/public`);
  console.log(`  - Remote:         /api/remote/dashboard/:licenseId`);
  console.log(`  - POS Products:   /api/products`);
  console.log(`  - POS Sales:      /api/sales`);
});

export default app;