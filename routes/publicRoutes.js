import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { initDB } from '../db.js';
import { generateLicense } from '../services/licenseService.js';
import { getSubscription } from '../services/billingService.js';
import { initiatePayment, verifyPayment } from '../services/paymentService.js';
import { sendEmail, trialStartedTemplate, paymentInstructionsTemplate } from '../services/emailService.js';

const router = express.Router();

// =========================================================
// START TRIAL
// =========================================================
router.post('/trial/start', async (req, res) => {
  try {
    const { machineId, email, plan } = req.body;

    if (!machineId || !email || !plan) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'machineId, email e plan são obrigatórios',
      });
    }

    const result = await generateLicense(machineId, email, plan, 7, true);

    // Enviar email mock
    const template = trialStartedTemplate(email, 7, result.subscription.endDate);
    await sendEmail({ to: email, ...template });

    return res.json({
      success: true,
      license: result.license,
      subscription: result.subscription,
      message: 'Trial de 7 dias iniciado com sucesso',
    });

  } catch (e) {
    console.error('TRIAL START ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
});

// =========================================================
// CHECK TRIAL STATUS
// =========================================================
router.get('/trial/status/:machineId', async (req, res) => {
  try {
    const db = await initDB();

    const row = await db.get(
      `
      SELECT s.*
      FROM subscriptions s
      JOIN licenses l ON l.subscription_id = s.id
      WHERE l.machine_id = ? AND s.status = 'trial'
      ORDER BY s.created_at DESC
      LIMIT 1
      `,
      [req.params.machineId]
    );

    if (!row) {
      return res.json({
        hasTrial: false,
      });
    }

    const now = new Date();
    const endDate = new Date(row.expiry_date);
    const diffMs = endDate - now;
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return res.json({
      hasTrial: true,
      active: now <= endDate,
      daysLeft: Math.max(0, daysLeft),
      subscription: row,
    });

  } catch (e) {
    console.error('TRIAL STATUS ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
    });
  }
});

// =========================================================
// REQUEST LICENSE (REMOTE ACTIVATION) — CORRIGIDO
// Agora cria pedido PENDENTE, não gera licença automaticamente
// =========================================================
router.post('/license/request', async (req, res) => {
  try {
    const { machineId, email, plan } = req.body;

    if (!machineId || !email || !plan) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'machineId, email e plan são obrigatórios',
      });
    }

    const db = await initDB();
    const requestId = uuidv4();
    const now = new Date().toISOString();

    // Verificar se já existe pedido pendente
    const existing = await db.get(
      `
      SELECT * FROM activation_requests
      WHERE machine_id = ? AND client_email = ? AND status = 'pending'
      `,
      [machineId, email]
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'pending_request_exists',
        message: 'Já existe um pedido pendente para este email. Aguarde aprovação.',
        requestId: existing.id,
      });
    }

    await db.run(
      `
      INSERT INTO activation_requests (
        id, machine_id, client_email, plan, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [requestId, machineId, email, plan, 'pending', now]
    );

    // Enviar email de confirmação de pedido
    await sendEmail({
      to: email,
      subject: 'VMP SaaS - Pedido Recebido',
      body: `Olá,

Recebemos o seu pedido de ativação para o plano ${plan}.

O seu pedido está em análise. Assim que aprovado, receberá a sua licença por email.

Machine ID: ${machineId}
Pedido: ${requestId}

Obrigado,
Equipa VMP SaaS`,
    });

    return res.json({
      success: true,
      status: 'pending',
      requestId,
      message: 'Pedido enviado com sucesso. Aguarde aprovação do administrador.',
    });

  } catch (e) {
    console.error('LICENSE REQUEST ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
});

// =========================================================
// CHECK REQUEST STATUS
// =========================================================
router.get('/license/request/:requestId', async (req, res) => {
  try {
    const db = await initDB();

    const row = await db.get(
      `
      SELECT * FROM activation_requests WHERE id = ?
      `,
      [req.params.requestId]
    );

    if (!row) {
      return res.status(404).json({
        error: 'not_found',
      });
    }

    return res.json({
      success: true,
      request: row,
    });

  } catch (e) {
    console.error('CHECK REQUEST ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
    });
  }
});

// =========================================================
// INITIATE PAYMENT
// =========================================================
router.post('/payment/initiate', async (req, res) => {
  try {
    const { type, amount, client, plan } = req.body;

    if (!type || !amount || !client || !plan) {
      return res.status(400).json({
        error: 'missing_fields',
      });
    }

    const result = await initiatePayment(type, amount, client, plan);

    // Enviar email com instruções
    const template = paymentInstructionsTemplate(
      client,
      type,
      result.reference,
      amount,
      result.instructions.message
    );
    await sendEmail({ to: client, ...template });

    return res.json(result);

  } catch (e) {
    console.error('PAYMENT INITIATE ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
    });
  }
});

// =========================================================
// VERIFY PAYMENT
// =========================================================
router.post('/payment/verify', async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        error: 'missing_reference',
      });
    }

    const result = await verifyPayment(reference);

    return res.json(result);

  } catch (e) {
    console.error('PAYMENT VERIFY ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
    });
  }
});

export default router;