import express from 'express';
import { initDB } from '../db.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const router = express.Router();

// SECRET para JWT (deve estar no .env em produção)
const JWT_SECRET = process.env.JWT_SECRET || 'VMP_REMOTE_DASHBOARD_SECRET_2026';
const TOKEN_EXPIRY_HOURS = 24; // Token válido por 24h

// =========================================================
// HELPER: Hash PIN
// =========================================================
function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + 'VMP_PIN_SALT_2026').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// =========================================================
// POST /api/remote/auth — Autenticar com License ID + PIN
// =========================================================
router.post('/auth', async (req, res) => {
  try {
    const { licenseId, pin } = req.body;

    if (!licenseId || !pin) {
      return res.status(400).json({
        success: false,
        error: 'missing_fields',
        message: 'licenseId e pin são obrigatórios',
      });
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_pin_format',
        message: 'O PIN deve ter entre 4 e 6 dígitos numéricos',
      });
    }

    const db = await initDB();

    // Verificar licença
    const license = await db.get(
      `SELECT l.*, s.plan as sub_plan, s.expiry_date as sub_expiry
       FROM licenses l
       LEFT JOIN subscriptions s ON l.subscription_id = s.id
       WHERE l.id = ? AND l.status = 'active'`,
      [licenseId]
    );

    if (!license) {
      return res.status(404).json({
        success: false,
        error: 'license_not_found',
        message: 'Licença não encontrada ou inativa',
      });
    }

    // Verificar expiração
    const now = new Date();
    const expiry = new Date(license.expiry || license.sub_expiry);
    if (now > expiry) {
      return res.status(403).json({
        success: false,
        error: 'license_expired',
        message: 'Licença expirada',
        expiry: expiry.toISOString(),
      });
    }

    // Verificar plano Enterprise
    const plan = license.sub_plan || license.plan;
    if (plan !== 'enterprise') {
      return res.status(403).json({
        success: false,
        error: 'feature_not_available',
        message: 'Dashboard remoto disponível apenas no plano Enterprise',
        requiredPlan: 'enterprise',
      });
    }

    // Verificar PIN
    const pinHash = hashPin(pin);
    const storedPin = license.remote_pin;

    // Se não tiver PIN definido
    if (!storedPin) {
      return res.status(401).json({
        success: false,
        error: 'pin_not_set',
        message: 'PIN de acesso remoto não configurado. Configure no aplicativo VMP SaaS.',
      });
    }

    if (storedPin !== pinHash) {
      return res.status(401).json({
        success: false,
        error: 'invalid_pin',
        message: 'PIN incorreto',
      });
    }

    // Gerar token JWT
    const token = jwt.sign(
      {
        licenseId: license.id,
        plan: plan,
        client: license.client,
      },
      JWT_SECRET,
      { expiresIn: `${TOKEN_EXPIRY_HOURS}h` }
    );

    // Guardar token na base de dados (para revogação)
    const dbToken = generateToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

    await db.run(
      `INSERT INTO remote_access_tokens (license_id, token, pin_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [license.id, dbToken, pinHash, now.toISOString(), expiresAt.toISOString()]
    );

    // Limpar tokens antigos (mais de 30 dias)
    await db.run(
      `DELETE FROM remote_access_tokens 
       WHERE created_at < datetime('now', '-30 days') 
       OR (is_revoked = 1 AND created_at < datetime('now', '-7 days'))`
    );

    res.json({
      success: true,
      token: token,
      expiresIn: TOKEN_EXPIRY_HOURS * 3600, // segundos
      business: {
        name: license.client || 'Negócio',
        plan: plan,
        expiry: expiry.toISOString(),
      },
    });

  } catch (e) {
    console.error('REMOTE AUTH ERROR:', e);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: 'Erro interno do servidor',
    });
  }
});

// =========================================================
// POST /api/remote/pin/set — Definir/alterar PIN (chamado pelo app Flutter)
// =========================================================
router.post('/pin/set', async (req, res) => {
  try {
    const { licenseId, pin, currentPin } = req.body;

    if (!licenseId || !pin) {
      return res.status(400).json({
        success: false,
        error: 'missing_fields',
        message: 'licenseId e pin são obrigatórios',
      });
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_pin_format',
        message: 'O PIN deve ter entre 4 e 6 dígitos numéricos',
      });
    }

    const db = await initDB();

    // Verificar licença
    const license = await db.get(
      `SELECT l.*, s.plan as sub_plan
       FROM licenses l
       LEFT JOIN subscriptions s ON l.subscription_id = s.id
       WHERE l.id = ? AND l.status = 'active'`,
      [licenseId]
    );

    if (!license) {
      return res.status(404).json({
        success: false,
        error: 'license_not_found',
      });
    }

    // Se já tem PIN, exigir currentPin para alterar
    if (license.remote_pin && currentPin) {
      const currentHash = hashPin(currentPin);
      if (license.remote_pin !== currentHash) {
        return res.status(401).json({
          success: false,
          error: 'invalid_current_pin',
          message: 'PIN actual incorreto',
        });
      }
    }

    // Atualizar PIN
    const pinHash = hashPin(pin);
    await db.run(
      `UPDATE licenses SET remote_pin = ? WHERE id = ?`,
      [pinHash, licenseId]
    );

    // Revogar tokens antigos (força re-login)
    await db.run(
      `UPDATE remote_access_tokens SET is_revoked = 1 WHERE license_id = ?`,
      [licenseId]
    );

    res.json({
      success: true,
      message: 'PIN configurado com sucesso',
    });

  } catch (e) {
    console.error('SET PIN ERROR:', e);
    res.status(500).json({
      success: false,
      error: 'server_error',
    });
  }
});

// =========================================================
// POST /api/remote/pin/verify — Verificar se PIN está configurado
// =========================================================
router.post('/pin/verify', async (req, res) => {
  try {
    const { licenseId } = req.body;

    if (!licenseId) {
      return res.status(400).json({
        success: false,
        error: 'missing_license_id',
      });
    }

    const db = await initDB();

    const license = await db.get(
      `SELECT remote_pin FROM licenses WHERE id = ?`,
      [licenseId]
    );

    if (!license) {
      return res.status(404).json({
        success: false,
        error: 'license_not_found',
      });
    }

    res.json({
      success: true,
      hasPin: !!license.remote_pin,
    });

  } catch (e) {
    console.error('VERIFY PIN ERROR:', e);
    res.status(500).json({
      success: false,
      error: 'server_error',
    });
  }
});

// =========================================================
// GET /api/remote/dashboard — Dashboard protegido por JWT
// =========================================================
router.get('/dashboard', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'missing_token',
        message: 'Token de autenticação não fornecido',
      });
    }

    const token = authHeader.substring(7);

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: 'invalid_token',
        message: 'Token inválido ou expirado',
      });
    }

    const licenseId = decoded.licenseId;
    const db = await initDB();

    const license = await db.get(
      `SELECT l.*, s.plan as sub_plan, s.expiry_date as sub_expiry, s.client as sub_client
       FROM licenses l
       LEFT JOIN subscriptions s ON l.subscription_id = s.id
       WHERE l.id = ? AND l.status = 'active'`,
      [licenseId]
    );

    if (!license) {
      return res.status(404).json({
        success: false,
        error: 'license_not_found_or_inactive',
      });
    }

    const now = new Date();
    const expiry = new Date(license.expiry || license.sub_expiry);
    if (now > expiry) {
      return res.status(403).json({
        success: false,
        error: 'license_expired',
        expiry: expiry.toISOString(),
      });
    }

    const plan = license.sub_plan || license.plan;
    if (plan !== 'enterprise') {
      return res.status(403).json({
        success: false,
        error: 'feature_not_available',
        message: 'Dashboard remoto disponível apenas no plano Enterprise',
      });
    }

    // Timezone CAT = UTC+2
    const catOffset = "+2 hours";

    const todaySales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE date(created_at, '${catOffset}') = date('now', '${catOffset}') 
      AND status = 'completed'
    `);

    const monthSales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE strftime('%Y-%m', created_at, '${catOffset}') = strftime('%Y-%m', 'now', '${catOffset}') 
      AND status = 'completed'
    `);

    const weekSales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE date(created_at, '${catOffset}') >= date('now', '${catOffset}', '-7 days') 
      AND status = 'completed'
    `);

    const topProducts = await db.all(`
      SELECT p.name, SUM(si.quantity) as qty, SUM(si.total_price) as revenue
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' 
      AND date(s.created_at, '${catOffset}') >= date('now', '${catOffset}', '-7 days')
      GROUP BY si.product_id
      ORDER BY qty DESC
      LIMIT 5
    `);

    const lowStock = await db.all(`
      SELECT name, stock, min_stock
      FROM products
      WHERE stock <= min_stock AND stock > 0 AND is_active = 1
      ORDER BY stock ASC
      LIMIT 10
    `);

    const outOfStock = await db.all(`
      SELECT name, stock, min_stock
      FROM products
      WHERE stock = 0 AND is_active = 1
      ORDER BY name ASC
      LIMIT 10
    `);

    const openSessions = await db.all(`
      SELECT cs.*, pu.name as user_name
      FROM cash_sessions cs
      JOIN pos_users pu ON cs.user_id = pu.id
      WHERE cs.status = 'open'
    `);

    const salesByDay = await db.all(`
      SELECT 
        date(created_at, '${catOffset}') as day,
        COALESCE(SUM(total_amount), 0) as total,
        COUNT(*) as count
      FROM sales 
      WHERE status = 'completed' 
      AND date(created_at, '${catOffset}') >= date('now', '${catOffset}', '-7 days')
      GROUP BY date(created_at, '${catOffset}')
      ORDER BY day ASC
    `);

    const productCount = await db.get(`SELECT COUNT(*) as count FROM products WHERE is_active = 1`);
    const userCount = await db.get(`SELECT COUNT(*) as count FROM pos_users WHERE is_active = 1`);

    await db.run(
      `UPDATE remote_access_tokens SET last_used_at = ? WHERE token LIKE ?`,
      [now.toISOString(), token.substring(0, 16) + '%']
    );

    res.json({
      success: true,
      business: {
        name: license.client || license.sub_client || 'Negócio',
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
      week: {
        sales: weekSales.count || 0,
        revenue: weekSales.total || 0,
      },
      topProducts: topProducts || [],
      alerts: {
        lowStock: lowStock || [],
        outOfStock: outOfStock || [],
        openSessions: openSessions || [],
      },
      chart: {
        salesByDay: salesByDay || [],
      },
      stats: {
        totalProducts: productCount.count || 0,
        totalUsers: userCount.count || 0,
      },
      lastUpdated: now.toISOString(),
    });

  } catch (e) {
    console.error('REMOTE DASHBOARD ERROR:', e);
    res.status(500).json({
      success: false,
      error: 'server_error',
      details: e.message,
    });
  }
});

// =========================================================
// POST /api/remote/logout — Revogar token
// =========================================================
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'missing_token' });
    }

    const token = authHeader.substring(7);
    const db = await initDB();

    await db.run(
      `UPDATE remote_access_tokens SET is_revoked = 1 WHERE token LIKE ?`,
      [token.substring(0, 16) + '%']
    );

    res.json({ success: true, message: 'Sessão terminada' });

  } catch (e) {
    console.error('LOGOUT ERROR:', e);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

export default router;
