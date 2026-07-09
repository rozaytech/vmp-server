import express from 'express';
import { initDB } from '../db.js';
import { generateLicense } from '../services/licenseService.js';
import { sendEmail, licenseApprovedTemplate } from '../services/emailService.js';

const router = express.Router();

// =========================================================
// MIDDLEWARE: verificar auth básica (mock)
// Em produção: usar JWT middleware
// =========================================================
router.use((req, res, next) => {
  // Mock: aceitar tudo para demo
  // Em produção: verificar req.headers.authorization
  next();
});

// =========================================================
// DASHBOARD STATS
// =========================================================
router.get('/stats', async (req, res) => {
  try {
    const db = await initDB();

    const totalLicenses = await db.get(`SELECT COUNT(*) as count FROM licenses`);
    const activeLicenses = await db.get(`SELECT COUNT(*) as count FROM licenses WHERE status = 'active'`);
    const totalSubscriptions = await db.get(`SELECT COUNT(*) as count FROM subscriptions`);
    const activeSubscriptions = await db.get(`SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'`);
    const trialSubscriptions = await db.get(`SELECT COUNT(*) as count FROM subscriptions WHERE status = 'trial'`);
    const pendingRequests = await db.get(`SELECT COUNT(*) as count FROM activation_requests WHERE status = 'pending'`);
    const totalRevenue = await db.get(`SELECT SUM(amount) as total FROM payments WHERE status = 'completed'`);

    const recentRequests = await db.all(`
      SELECT * FROM activation_requests
      ORDER BY created_at DESC
      LIMIT 5
    `);

    const recentSubscriptions = await db.all(`
      SELECT s.*, l.machine_id
      FROM subscriptions s
      LEFT JOIN licenses l ON l.subscription_id = s.id
      ORDER BY s.created_at DESC
      LIMIT 5
    `);

    return res.json({
      stats: {
        totalLicenses: totalLicenses?.count || 0,
        activeLicenses: activeLicenses?.count || 0,
        totalSubscriptions: totalSubscriptions?.count || 0,
        activeSubscriptions: activeSubscriptions?.count || 0,
        trialSubscriptions: trialSubscriptions?.count || 0,
        pendingRequests: pendingRequests?.count || 0,
        totalRevenue: totalRevenue?.total || 0,
      },
      recentRequests,
      recentSubscriptions,
    });

  } catch (e) {
    console.error('ADMIN STATS ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// =========================================================
// ACTIVATION REQUESTS
// =========================================================
router.get('/activation-requests', async (req, res) => {
  try {
    const db = await initDB();
    const status = req.query.status;

    let query = `SELECT * FROM activation_requests`;
    let params = [];

    if (status && status !== 'all') {
      query += ` WHERE status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const rows = await db.all(query, params);

    return res.json({ requests: rows });

  } catch (e) {
    console.error('ACTIVATION REQUESTS ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// =========================================================
// APPROVE REQUEST
// =========================================================
router.post('/activation-requests/:id/approve', async (req, res) => {
  try {
    const db = await initDB();
    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [req.params.id]
    );

    if (!request) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        error: 'already_processed',
        message: 'Este pedido já foi processado',
      });
    }

    const result = await generateLicense(
      request.machine_id,
      request.client_email,
      request.plan,
      365
    );

    const licenseData = JSON.parse(
      Buffer.from(result.license, 'base64').toString()
    );
    const licenseId = licenseData.payload.id;

    await db.run(
      `UPDATE activation_requests SET status = 'approved', license_id = ? WHERE id = ?`,
      [licenseId, req.params.id]
    );

    // Enviar email com a licença
    const template = licenseApprovedTemplate(
      request.client_email,
      result.license,
      request.plan,
      result.subscription.endDate
    );
    await sendEmail({ to: request.client_email, ...template });

    return res.json({
      success: true,
      license: result.license,
      subscription: result.subscription,
      message: 'Licença aprovada e enviada por email',
    });

  } catch (e) {
    console.error('APPROVE ERROR:', e);
    return res.status(500).json({ error: 'server_error', details: e.message });
  }
});

// =========================================================
// REJECT REQUEST
// =========================================================
router.post('/activation-requests/:id/reject', async (req, res) => {
  try {
    const db = await initDB();
    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [req.params.id]
    );

    if (!request) {
      return res.status(404).json({ error: 'not_found' });
    }

    await db.run(
      `UPDATE activation_requests SET status = 'rejected' WHERE id = ?`,
      [req.params.id]
    );

    // Enviar email de rejeição
    await sendEmail({
      to: request.client_email,
      subject: 'VMP SaaS - Pedido Rejeitado',
      body: `Olá,

Lamentamos informar que o seu pedido de ativação foi rejeitado.

Se acredita que se trata de um erro, contacte o nosso suporte.

Obrigado,
Equipa VMP SaaS`,
    });

    return res.json({ success: true, message: 'Pedido rejeitado' });

  } catch (e) {
    console.error('REJECT ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// =========================================================
// ALL SUBSCRIPTIONS
// =========================================================
router.get('/subscriptions', async (req, res) => {
  try {
    const db = await initDB();
    const status = req.query.status;

    let query = `
      SELECT s.*, l.machine_id, l.id as license_id
      FROM subscriptions s
      LEFT JOIN licenses l ON l.subscription_id = s.id
    `;
    let params = [];

    if (status && status !== 'all') {
      query += ` WHERE s.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY s.created_at DESC`;

    const rows = await db.all(query, params);

    return res.json({ subscriptions: rows });

  } catch (e) {
    console.error('SUBSCRIPTIONS ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// =========================================================
// ALL LICENSES
// =========================================================
router.get('/licenses', async (req, res) => {
  try {
    const db = await initDB();
    const rows = await db.all(`
      SELECT l.*, s.status as sub_status, s.expiry_date as sub_expiry
      FROM licenses l
      LEFT JOIN subscriptions s ON s.id = l.subscription_id
      ORDER BY l.created_at DESC
    `);

    return res.json({ licenses: rows });

  } catch (e) {
    console.error('LICENSES ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// =========================================================
// EMAIL LOGS
// =========================================================
router.get('/email-logs', async (req, res) => {
  try {
    const db = await initDB();
    const rows = await db.all(`
      SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 50
    `);

    return res.json({ emails: rows });

  } catch (e) {
    console.error('EMAIL LOGS ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;