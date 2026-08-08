import express from 'express';
import {
  generate,
  validate,
  getByMachineId,
  getStatusByMachineId,
  transfer,
  revoke,
  reactivate,
  update,
  list,
  getById,
  approveRequest,
  rejectRequest,
} from '../controllers/licenseController.js';

const router = express.Router();

// POST /api/licenses/generate
router.post('/generate', generate);

// POST /api/licenses/validate
router.post('/validate', validate);

// =========================================================
// NOVO: GET /api/licenses/machine/:machineId
// Busca licenca ativa por machine_id (usado pelo Flutter
// para sincronizar quando bloqueado localmente)
// =========================================================
router.get('/machine/:machineId', getByMachineId);

// =========================================================
// NOVO: GET /api/licenses/status/:machineId
// Status leve da licenca por machine_id
// =========================================================
router.get('/status/:machineId', getStatusByMachineId);

// GET /api/licenses/list
router.get('/list', list);

// POST /api/licenses/transfer
router.post('/transfer', transfer);

// POST /api/licenses/revoke/:id
router.post('/revoke/:id', revoke);

// POST /api/licenses/reactivate/:id
router.post('/reactivate/:id', reactivate);

// PUT /api/licenses/:id
router.put('/:id', update);

// GET /api/licenses/:id
router.get('/:id', getById);

// POST /api/licenses/approve-request
router.post('/approve-request', approveRequest);

// POST /api/licenses/reject-request
router.post('/reject-request', rejectRequest);

export default router;
