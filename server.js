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
    version: '2.3.0',
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
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vmp-license-server',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '2.3.0',
  });
});

// Rotas existentes
app.use('/api/auth', authRoutes);
app.use('/api/license', licenseRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/public', publicRoutes);

// NOVO: Rotas POS
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);

app.get('/api/finance/overview', async (req, res) => {
  res.json({
    revenue: { today: 120, month: 3400, total: 12800 },
    subscriptions: { active: 42, trial: 6, cancelled: 3 },
    churnRate: 4.2,
    mrr: 3400,
    arr: 40800
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'route_not_found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error('SERVER_ERROR:', err);
  res.status(500).json({ error: 'internal_server_error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VMP SaaS Control Plane running on port ${PORT}`);
  console.log(`POS API endpoints: /api/products, /api/sales`);
});