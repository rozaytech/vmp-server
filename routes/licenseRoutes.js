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
  deleteLicense,
  markAsPaid,
  generateOfflineCode, // NOVO: Importação da função
  updateFeatures,      // NOVO: Importação da função para guardar módulos personalizados
} from '../controllers/licenseController.js';
import { authMiddleware } from "../middleware/authMiddleware.js"; // ADIÇÃO: Proteção admin

const router = express.Router();

// ADIÇÃO: Função para permitir Admin e Super Admin com mensagem clara
function requireAdminOrSuper(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const role = (req.user.role || '').toLowerCase().replace(/[\s_-]/g, '');
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({ error: 'forbidden', message: 'Acesso negado. Apenas Administradores ou Super Admins podem gerir utilizadores.' });
  }
  next();
}

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
router.post('/transfer', authMiddleware, requireAdminOrSuper, transfer); // ADIÇÃO: Proteção

// POST /api/licenses/revoke/:id
router.post('/revoke/:id', authMiddleware, requireAdminOrSuper, revoke); // ADIÇÃO: Proteção

// POST /api/licenses/reactivate/:id
router.post('/reactivate/:id', authMiddleware, requireAdminOrSuper, reactivate); // ADIÇÃO: Proteção

// PUT /api/licenses/:id
router.put('/:id', authMiddleware, requireAdminOrSuper, update); // ADIÇÃO: Proteção

// GET /api/licenses/:id
router.get('/:id', getById);

// POST /api/licenses/approve-request
router.post('/approve-request', authMiddleware, requireAdminOrSuper, approveRequest); // ADIÇÃO: Proteção

// POST /api/licenses/reject-request
router.post('/reject-request', authMiddleware, requireAdminOrSuper, rejectRequest); // ADIÇÃO: Proteção

// =========================================================
// NOVAS ROTAS PARA O PAINEL ADMIN (Licenses.jsx)
// =========================================================

// DELETE /api/licenses/:id
router.delete('/:id', authMiddleware, requireAdminOrSuper, deleteLicense); // ADIÇÃO: Proteção

// POST /api/licenses/pay
router.post('/pay', authMiddleware, requireAdminOrSuper, markAsPaid); // ADIÇÃO: Proteção

// =========================================================
// NOVA ROTA: Geração de Código Offline
// =========================================================
router.post('/generate-offline-code', authMiddleware, requireAdminOrSuper, generateOfflineCode); // ADIÇÃO: Proteção

// =========================================================
// NOVA ROTA: Atualizar funcionalidades personalizadas
// (Usado pelo botão "Módulos" no Painel Admin)
// =========================================================
router.put('/:id/features', authMiddleware, requireAdminOrSuper, updateFeatures); // ADIÇÃO: Proteção

export default router;