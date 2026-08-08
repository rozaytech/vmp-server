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

// =========================================================
// NOVO: Buscar licenca ativa por machine_id
// GET /api/licenses/machine/:machineId
// =========================================================
export async function getByMachineId(req, res) {
  try {
    const { machineId } = req.params;

    if (!machineId) {
      return res.status(400).json({
        success: false,
        error: 'missing_machine_id',
        message: 'machineId e obrigatorio',
      });
    }

    const result = await getLicenseByMachineId(machineId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Nenhuma licenca encontrada para este dispositivo.',
      });
    }

    return res.json({
      success: true,
      ...result,
    });
  } catch (e) {
    console.error('GET LICENSE BY MACHINE ERROR:', e);
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: e.message,
    });
  }
}

// =========================================================
// NOVO: Status da licenca por machine_id
// GET /api/licenses/status/:machineId
// =========================================================
export async function getStatusByMachineId(req, res) {
  try {
    const { machineId } = req.params;

    if (!machineId) {
      return res.status(400).json({
        success: false,
        error: 'missing_machine_id',
        message: 'machineId e obrigatorio',
      });
    }

    const result = await getLicenseStatusByMachineId(machineId);

    if (!result.exists) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Nenhuma licenca encontrada para este dispositivo.',
      });
    }

    return res.json({
      success: true,
      ...result,
    });
  } catch (e) {
    console.error('GET LICENSE STATUS ERROR:', e);
    return res.status(500).json({
      success: false,
      error: 'server_error',
      message: e.message,
    });
  }
}

export async function transfer(req, res) {
  try {
    const { oldLicenseId, newMachineId, reason } = req.body;

    if (!oldLicenseId || !newMachineId) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'oldLicenseId e newMachineId sao obrigatorios',
      });
    }

    const result = await transferLicense(oldLicenseId, newMachineId, reason);
    return res.json(result);
  } catch (e) {
    console.error('TRANSFER LICENSE ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
}

export async function revoke(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await revokeLicense(id, reason);
    return res.json(result);
  } catch (e) {
    console.error('REVOKE LICENSE ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

export async function reactivate(req, res) {
  try {
    const { id } = req.params;
    const { days, machineId } = req.body;

    const result = await reactivateLicense(id, days, machineId);
    return res.json(result);
  } catch (e) {
    console.error('REACTIVATE LICENSE ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
}

export async function update(req, res) {
  try {
    const { id } = req.params;
    const result = await updateLicense(id, req.body);
    return res.json(result);
  } catch (e) {
    console.error('UPDATE LICENSE ERROR:', e);
    if (e.message === 'license_not_found') {
      return res.status(404).json({ error: 'not_found' });
    }
    if (e.message === 'no_fields_to_update') {
      return res.status(400).json({ error: 'no_fields_to_update' });
    }
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
}

export async function list(req, res) {
  try {
    const { status, plan, client } = req.query;
    const licenses = await listLicenses({ status, plan, client });

    return res.json({
      success: true,
      data: licenses,
      count: licenses.length,
    });
  } catch (e) {
    console.error('LIST LICENSES ERROR:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

export async function getById(req, res) {
  try {
    const { initDB } = await import('../db.js');
    const db = await initDB();
    const { id } = req.params;

    const license = await db.get(
      `SELECT l.*, s.payment_status, s.start_date, s.auto_renew
       FROM licenses l
       LEFT JOIN subscriptions s ON l.subscription_id = s.id
       WHERE l.id = ?`,
      [id]
    );

    if (!license) {
      return res.status(404).json({ error: 'not_found' });
    }

    return res.json({ success: true, data: license });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
}

export async function approveRequest(req, res) {
  try {
    const { requestId, adminEmail } = req.body;

    if (!requestId) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'requestId e obrigatorio',
      });
    }

    const { initDB } = await import('../db.js');
    const db = await initDB();

    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [requestId]
    );

    if (!request) {
      return res.status(404).json({ error: 'request_not_found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        error: 'already_processed',
        message: `Pedido ja esta ${request.status}`,
      });
    }

    const result = await generateLicense(
      request.machine_id,
      request.client_email,
      request.plan,
      null
    );

    const now = new Date().toISOString();
    await db.run(
      `UPDATE activation_requests SET status = ?, license_id = ?, approved_at = ?, approved_by = ? WHERE id = ?`,
      ['approved', result.licenseId, now, adminEmail || 'admin', requestId]
    );

    await db.run(
      `INSERT INTO license_logs (license_id, machine_id, action, created_at) VALUES (?, ?, ?, ?)`,
      [result.licenseId, request.machine_id, 'approved_remote', now]
    );

    return res.json({
      success: true,
      message: 'Licenca aprovada e gerada com sucesso',
      license: {
        licenseId: result.licenseId,
        licenseKey: result.licenseKey,
        plan: result.plan,
        expiry: result.expiry,
      },
      requestId,
    });

  } catch (e) {
    console.error('APPROVE REQUEST ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
}

export async function rejectRequest(req, res) {
  try {
    const { requestId, reason } = req.body;

    if (!requestId) {
      return res.status(400).json({
        error: 'missing_fields',
        message: 'requestId e obrigatorio',
      });
    }

    const { initDB } = await import('../db.js');
    const db = await initDB();

    const request = await db.get(
      `SELECT * FROM activation_requests WHERE id = ?`,
      [requestId]
    );

    if (!request) {
      return res.status(404).json({ error: 'request_not_found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        error: 'already_processed',
        message: `Pedido ja esta ${request.status}`,
      });
    }

    const now = new Date().toISOString();
    await db.run(
      `UPDATE activation_requests SET status = ?, rejected_at = ?, rejection_reason = ? WHERE id = ?`,
      ['rejected', now, reason || 'Sem motivo', requestId]
    );

    return res.json({
      success: true,
      message: 'Pedido rejeitado',
      requestId,
    });

  } catch (e) {
    console.error('REJECT REQUEST ERROR:', e);
    return res.status(500).json({
      error: 'server_error',
      details: e.message,
    });
  }
}
