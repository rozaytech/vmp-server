import {
  generateLicense,
  validateLicense,
} from '../services/licenseService.js';

export async function generate(req, res) {
  try {
    const {
      machineId,
      client,
      plan,
      days,
    } = req.body;

    if (!machineId) {
      return res.status(400).json({
        error: 'missing_machine_id',
      });
    }

    if (!client) {
      return res.status(400).json({
        error: 'missing_client',
      });
    }

    if (!plan) {
      return res.status(400).json({
        error: 'missing_plan',
      });
    }

    const result = await generateLicense({
      machineId,
      client,
      plan,
      days,
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
    const {
      license,
      machineId,
    } = req.body;

    if (!license) {
      return res.status(400).json({
        valid: false,
        error: 'missing_license',
      });
    }

    if (!machineId) {
      return res.status(400).json({
        valid: false,
        error: 'missing_machine_id',
      });
    }

    const result = await validateLicense(
      license,
      machineId,
    );

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