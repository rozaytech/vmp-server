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
import { sendDiscordNotification } from '../services/discordNotificationService.js';

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

    // NOTIFICAÇÃO: Nova licença gerada manualmente
    await sendDiscordNotification({
      title: '📄 Nova Licença Gerada',
      description: `Uma nova licença foi criada para **${client}** (Plano: ${plan}).`,
      color: 3447003, // Azul
      fields: [
        { name: 'Machine ID', value: machineId, inline: true },
        { name: 'Dias', value: days?.toString() || 'Padrão', inline: true }
      ]
    });

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

    // NOTIFICAÇÃO: Licença revogada
    await sendDiscordNotification({
      title: '⚠️ Licença Revogada',
      description: `Licença **${id}** foi revogada pelo administrador.`,
      color: 15158332, // Vermelho
    });

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

    // NOTIFICAÇÃO: Licença reativada
    await sendDiscordNotification({
      title: '✅ Licença Reativada',
      description: `Licença **${id}** foi reativada.${days ? ` Válida por ${days} dias.` : ''}`,
      color: 3066993, // Verde
    });

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

    // NOTIFICAÇÃO: Licença atualizada
    await sendDiscordNotification({
      title: '✏️ Licença Atualizada',
      description: `Licença **${id}** foi atualizada pelo administrador.`,
      color: 3447003, // Azul
      fields: [
        { name: 'Plano', value: plan || 'Não alterado', inline: true },
        { name: 'Estado', value: status || 'Não alterado', inline: true }
      ]
    });

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

    // NOTIFICAÇÃO: Pedido aprovado
    await sendDiscordNotification({
      title: '✅ Pedido de Ativação Aprovado',
      description: `O pedido de **${request.client_email}** foi aprovado! Plano: ${request.plan}.`,
      color: 3066993, // Verde
    });

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

    // NOTIFICAÇÃO: Pedido rejeitado
    await sendDiscordNotification({
      title: '❌ Pedido de Ativação Rejeitado',
      description: `O pedido de **${request.client_email}** foi rejeitado.`,
      color: 15158332, // Vermelho
    });

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

    // NOTIFICAÇÃO: Licença apagada
    await sendDiscordNotification({
      title: '🗑️ Licença Apagada',
      description: `A licença **${id}** foi apagada permanentemente.`,
      color: 15158332, // Vermelho
    });

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

    // NOTIFICAÇÃO: Pagamento confirmado
    await sendDiscordNotification({
      title: '💰 Pagamento Confirmado',
      description: `A licença de **${license.client}** foi paga e convertida em subscrição!`,
      color: 3066993, // Verde
      fields: [
        { name: 'Plano', value: license.plan, inline: true },
        { name: 'Valor', value: `${amount} MZN`, inline: true },
        { name: 'Expiração', value: new Date(subscription.expiry).toLocaleDateString('pt-PT'), inline: true }
      ]
    });

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
// NOVA FUNÇÃO: Atualizar funcionalidades personalizadas da licença
// =========================================================
export async function updateFeatures(req, res) {
  try {
    const { id } = req.params;
    const { features } = req.body; // Array de strings (ex: ["remote_dashboard", "inventory"])

    if (!Array.isArray(features)) {
      return res.status(400).json({ error: 'invalid_features', message: 'A lista de funcionalidades deve ser um array' });
    }

    const db = await initDB();
    const license = await db.get(`SELECT id FROM licenses WHERE id = ?`, [id]);
    if (!license) {
      return res.status(404).json({ error: 'not_found', message: 'Licença não encontrada' });
    }

    // Guardar como string JSON
    const featuresJson = JSON.stringify(features);
    await db.run(
      `UPDATE licenses SET custom_features = ? WHERE id = ?`,
      [featuresJson, id]
    );

    // NOTIFICAÇÃO: Funcionalidades atualizadas
    await sendDiscordNotification({
      title: '🧩 Funcionalidades Personalizadas Atualizadas',
      description: `As funcionalidades da licença **${id}** foram atualizadas.`,
      color: 3447003, // Azul
      fields: [
        { name: 'Funcionalidades Ativas', value: features.join(', ') || 'Nenhuma (Padrão do plano)', inline: false }
      ]
    });

    return res.json({ success: true, message: 'Funcionalidades atualizadas com sucesso' });
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

    // NOTIFICAÇÃO: Código offline gerado
    await sendDiscordNotification({
      title: '🔑 Código de Renovação Offline Gerado',
      description: `Um código offline foi gerado para **${license.client}**.`,
      color: 16776960, // Amarelo
      fields: [
        { name: 'Código', value: code, inline: false }
      ]
    });

    return res.json({ success: true, code });
  } catch (e) {
    console.error('ERRO AO GERAR CÓDIGO OFFLINE:', e);
    return res.status(500).json({ error: 'server_error', details: e.message });
  }
}