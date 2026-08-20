import {
  generateLicense,
  validateLicense,
  transferLicense,
  listLicenses,
  revokeLicense,
  reactivateLicense,
  updateLicense,
  getLicenseByMachineId,
  getLicenseStatusByMachineId,
} from '../services/licenseService.js';
import { initDB } from '../db.js';
import { createSubscription } from '../billing/subscriptionService.js';
import { PLANS } from '../billing/plans.js';
import crypto from 'crypto';

export async function generate(req, res) {
  try {
    const { machineId, client, plan, days } = req.body;

    if (!machineId) {
      return res.status(400).json({ error: 'missing_machine_id' });
    }
    if (!client) {
      return res.status(400).json({ error: 'missing_client' });
    }
    if (!plan) {
      return res.status(400).json({ error: 'missing_plan' });
    }

    const result = await generateLicense(machineId, client, plan, days);
    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
}

export async function validate(req, res) {
  try {
    const { license, machineId } = req.body;

    if (!license) {
      return res.status(400).json({ valid: false, error: 'missing_license' });
    }
    if (!machineId) {
      return res.status(400).json({ valid: false, error: 'missing_machine_id' });
    }

    const result = await validateLicense(license, machineId);
    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      valid: false,
      error: 'server_error',
      details: e.message,
    });
  }
}

export async function getByMachineId(req, res) {
  try {
    const { machineId } = req.params;

    if (!machineId) {
      return res.status(400).json({
        success: false,
        error: 'missing_machine_id',
        message: 'machineId é obrigatório',
      });
    }

    const result = await getLicenseByMachineId(machineId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Nenhuma licença encontrada para este dispositivo.',
      });
    }
    
    return res.json({
      success: true,
      license: result,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      success: false,
      error: 'server_error',
      details: e.message,
    });
  }
}

export async function getStatusByMachineId(req, res) {
  try {
    const { machineId } = req.params;
    if (!machineId) {
      return res.status(400).json({ success: false, error: 'missing_machine_id' });
    }
    const status = await getLicenseStatusByMachineId(machineId);
    return res.json({ success: true, status });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', details: e.message });
  }
}

export async function list(req, res) {
  try {
    const { status, client } = req.query;
    const result = await listLicenses(status, client);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', details: e.message });
  }
}

export async function transfer(req, res) {
  try {
    const { oldLicenseId, newMachineId, reason } = req.body;
    const result = await transferLicense(oldLicenseId, newMachineId, reason);
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', details: e.message });
  }
}

export async function revoke(req, res) {
  try {
    const { id } = req.params;
    const result = await revokeLicense(id);
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', details: e.message });
  }
}

export async function reactivate(req, res) {
  try {
    const { id } = req.params;
    const { days, machineId } = req.body;
    const result = await reactivateLicense(id, days, machineId);
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', details: e.message });
  }
}

export async function update(req, res) {
  try {
    const { id } = req.params;
    const { plan, status, expiry, client, machineId } = req.body;
    const result = await updateLicense(id, { plan, status, expiry, client, machineId });
    return res.json({ success: true, license: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', details: e.message });
  }
}

export async function getById(req, res) {
  try {
    const { id } = req.params;
    const db = await initDB();
    const license = await db.get(`SELECT * FROM licenses WHERE id = ?`, [id]);
    if (!license) return res.status(404).json({ error: 'not_found' });
    return res.json({ success: true, license });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'server_error', details: e.message });
  }
}

export async function approveRequest(req, res) {
  try {
    const db = await initDB();
    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [req.params.id]
    );
    if (!request) return res.status(404).json({ error: 'not_found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'already_processed', message: 'Este pedido já foi processado' });
    }
    const result = await generateLicense(
      request.machine_id,
      request.client_email,
      request.plan,
      365,
      false
    );
    if (!result || !result.licenseKey) {
      return res.status(500).json({ error: 'license_generation_failed' });
    }
    const licenseId = result.licenseId;
    await db.run(
      `UPDATE activation_requests SET status = 'approved', license_id = ? WHERE id = ?`,
      [licenseId, req.params.id]
    );
    return res.json({ success: true, license: result.licenseKey, licenseId: result.licenseId });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', details: e.message });
  }
}

export async function rejectRequest(req, res) {
  try {
    const db = await initDB();
    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [req.params.id]
    );
    if (!request) return res.status(404).json({ error: 'not_found' });
    await db.run(
      `UPDATE activation_requests SET status = 'rejected' WHERE id = ?`,
      [req.params.id]
    );
    return res.json({ success: true, message: 'Pedido rejeitado' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', details: e.message });
  }
}

export async function deleteLicense(req, res) {
  try {
    const { id } = req.params;
    const db = await initDB();
    const existing = await db.get(`SELECT id FROM licenses WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ error: 'not_found', message: 'Licença não encontrada' });
    }
    await db.run(`DELETE FROM licenses WHERE id = ?`, [id]);
    return res.json({ success: true, message: 'Licença apagada com sucesso' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', details: e.message });
  }
}

export async function markAsPaid(req, res) {
  try {
    const { licenseId } = req.body;
    const db = await initDB();

    const license = await db.get(`SELECT * FROM licenses WHERE id = ?`, [licenseId]);
    if (!license) {
      return res.status(404).json({ error: 'not_found', message: 'Licença não encontrada' });
    }
    if (license.payment_status === 'paid') {
      return res.status(400).json({ error: 'already_paid', message: 'Esta licença já está marcada como paga' });
    }

    const subscription = await createSubscription({
      client: license.client,
      plan: license.plan,
    });

    await db.run(
      `UPDATE licenses SET subscription_id = ? WHERE id = ?`,
      [subscription.id, licenseId]
    );

    await db.run(
      `UPDATE subscriptions SET payment_status = 'paid' WHERE id = ?`,
      [subscription.id]
    );

    const paymentId = crypto.randomUUID();
    const amount = PLANS[license.plan]?.price || 0;
    
    const now = new Date().toISOString();
    
    await db.run(
      `INSERT INTO payments (id, subscription_id, client, amount, currency, status, provider, reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, subscription.id, license.client, amount, 'MZN', 'completed', 'manual', `MANUAL-${Date.now()}`, now]
    );

    return res.json({
      success: true,
      message: 'Licença paga e convertida em subscrição com sucesso',
      subscriptionId: subscription.id,
      expiry: subscription.expiry,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', details: e.message });
  }
}

// =========================================================
// NOVA FUNÇÃO: Gerar Código de Renovação Offline (HMAC)
// =========================================================
export async function generateOfflineCode(req, res) {
  try {
    const { machineId, days = 30 } = req.body;

    if (!machineId) {
      return res.status(400).json({ error: 'missing_machine_id' });
    }

    const db = await initDB();
    const license = await db.get(`SELECT * FROM licenses WHERE machine_id = ?`, [machineId]);

    if (!license) {
      return res.status(404).json({ error: 'license_not_found', message: 'Nenhuma licença encontrada para este Machine ID.' });
    }

    // Calcular a nova data de expiração com base nos dias (padrão: 30)
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + days);
    const expiryStr = newExpiry.toISOString();

    // Chave secreta deve ser a mesma usada no Flutter (SaasLockEngine)
    const secret = 'vmp-saas-secret-2026';
    const payload = `${machineId}|${expiryStr}`;
    
    // Gerar a assinatura HMAC-SHA256
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex').toUpperCase();
    
    // Formato do código: MACHINE_ID-DATA_EXPIRACAO-HASH
    const code = `${machineId}-${expiryStr}-${signature}`;

    return res.json({ success: true, code });
  } catch (e) {
    console.error('ERRO AO GERAR CÓDIGO OFFLINE:', e);
    return res.status(500).json({ error: 'server_error', details: e.message });
  }
}