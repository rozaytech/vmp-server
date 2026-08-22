import express from 'express';
import { initDB } from '../db.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { sendDiscordNotification } from '../services/discordNotificationService.js';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'VMP_REMOTE_DASHBOARD_SECRET_2026';
const TOKEN_EXPIRY_HOURS = 24;

// NOVO: Variáveis para controlar o spam de notificações do catálogo
let lastCatalogNotificationAt = 0;
const CATALOG_NOTIFICATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + 'VMP_PIN_SALT_2026').digest('hex');
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'missing_token',
      message: 'Token de autenticação não fornecido',
    });
  }
  try {
    const token = authHeader.substring(7);
    req.license = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'invalid_token',
      message: 'Token inválido ou expirado',
    });
  }
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

    const plan = license.sub_plan || license.plan;
    let customFeatures = [];
    try {
      customFeatures = license.custom_features ? JSON.parse(license.custom_features) : [];
    } catch (e) {
      customFeatures = [];
    }

    const hasRemoteDashboardFeature = plan === 'enterprise' || customFeatures.includes('remote_dashboard');
    if (!hasRemoteDashboardFeature) {
      return res.status(403).json({
        success: false,
        error: 'feature_not_available',
        message: 'Dashboard remoto não disponível para este plano',
        requiredPlan: 'enterprise',
      });
    }

    const pinHash = hashPin(pin);
    const storedPin = license.remote_pin;

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

    const token = jwt.sign(
      {
        licenseId: license.id,
        plan: plan,
        client: license.client,
      },
      JWT_SECRET,
      { expiresIn: `${TOKEN_EXPIRY_HOURS}h` }
    );

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

    await db.run(
      `INSERT INTO remote_access_tokens (license_id, token, pin_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [license.id, token, pinHash, now.toISOString(), expiresAt.toISOString()]
    );

    await db.run(
      `DELETE FROM remote_access_tokens 
       WHERE created_at < datetime('now', '-30 days') 
       OR (is_revoked = 1 AND created_at < datetime('now', '-7 days'))`
    );

    // CORREÇÃO: Removido o await para não bloquear a resposta da API
    sendDiscordNotification({
      title: '👁️ Acesso ao Dashboard Remoto',
      description: `O cliente **${license.client}** acedeu ao Dashboard Remoto com sucesso.`,
      color: 3447003,
    });

    res.json({
      success: true,
      token: token,
      expiresIn: TOKEN_EXPIRY_HOURS * 3600,
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
// POST /api/remote/pin/set — Definir/alterar PIN
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

    if (license.remote_pin && currentPin) {
      const currentHash = hashPin(currentPin);
      if (license.remote_pin !== currentHash) {
        return res.status(401).json({
          success: false,
          error: 'invalid_current_pin',
          message: 'PIN atual incorreto',
        });
      }
    }

    const pinHash = hashPin(pin);
    await db.run(
      `UPDATE licenses SET remote_pin = ? WHERE id = ?`,
      [pinHash, licenseId]
    );

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
// POST /api/remote/sync/products — Sync de catálogo do Flutter
// =========================================================
router.post('/sync/products', requireAuth, async (req, res) => {
  try {
    const { products } = req.body;
    const licenseId = req.license.licenseId;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'missing_products',
        message: 'Array de produtos obrigatório',
      });
    }

    const db = await initDB();
    const results = [];
    const now = new Date().toISOString();

    for (const p of products) {
      const clientProductId = p.id;

      try {
        const existing = await db.get(
          `SELECT id FROM products WHERE client_product_id = ? AND license_id = ?`,
          [clientProductId, licenseId]
        );

        if (existing) {
          await db.run(
            `UPDATE products SET
              name = ?, barcode = ?, price = ?, cost_price = ?,
              stock = ?, min_stock = ?, max_stock = ?, category = ?,
              unit = ?, is_active = ?, updated_at = ?
             WHERE id = ?`,
            [
              p.name || 'Produto',
              p.barcode || null,
              p.price || 0,
              p.cost_price || 0,
              p.stock || 0,
              p.min_stock || 0,
              p.max_stock || 0,
              p.category || null,
              p.unit || 'UN',
              p.is_active != null ? p.is_active : 1,
              now,
              existing.id,
            ]
          );
          results.push({ clientProductId, status: 'updated', serverId: existing.id });
        } else {
          const result = await db.run(
            `INSERT INTO products (
              name, barcode, price, cost_price, stock, min_stock, max_stock,
              category, unit, is_active, created_at, updated_at,
              client_product_id, license_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              p.name || 'Produto',
              p.barcode || null,
              p.price || 0,
              p.cost_price || 0,
              p.stock || 0,
              p.min_stock || 0,
              p.max_stock || 0,
              p.category || null,
              p.unit || 'UN',
              p.is_active != null ? p.is_active : 1,
              now,
              now,
              clientProductId,
              licenseId,
            ]
          );
          results.push({ clientProductId, status: 'created', serverId: result.lastID });
        }
      } catch (itemError) {
        console.error(`SYNC PRODUCT ERROR (clientProductId=${clientProductId}):`, itemError);
        results.push({ clientProductId, status: 'error', error: itemError.message });
      }
    }

    // NOVO: Controlo de spam no Discord. Só notifica se passaram 6 horas desde a última
    const currentTime = Date.now();
    if (results.length > 0 && (currentTime - lastCatalogNotificationAt > CATALOG_NOTIFICATION_INTERVAL_MS)) {
      lastCatalogNotificationAt = currentTime;
      
      // CORREÇÃO: Removido o await para não bloquear a resposta da API
      sendDiscordNotification({
        title: '📦 Catálogo Sincronizado',
        description: `O catálogo do cliente **${req.license.client}** foi atualizado (${results.length} produtos).`,
        color: 3447003,
      });
    }

    res.json({
      success: true,
      synced: results.filter(r => r.status !== 'error').length,
      errors: results.filter(r => r.status === 'error').length,
      details: results,
    });

  } catch (e) {
    console.error('SYNC PRODUCTS ERROR:', e);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: e.message,
    });
  }
});

// =========================================================
// POST /api/remote/sync/sales — Receber vendas do Flutter
// =========================================================
router.post('/sync/sales', requireAuth, async (req, res) => {
  try {
    const { sales } = req.body;
    const licenseId = req.license.licenseId;

    if (!Array.isArray(sales) || sales.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'missing_sales',
        message: 'Array de vendas obrigatório',
      });
    }

    const db = await initDB();
    const results = [];
    const errors = [];

    for (const saleData of sales) {
      const clientSaleId = saleData.id;

      try {
        const existing = await db.get(
          `SELECT id FROM sales WHERE client_sale_id = ? AND license_id = ?`,
          [clientSaleId, licenseId]
        );
        if (existing) {
          results.push({ clientSaleId, status: 'skipped', serverId: existing.id });
          continue;
        }

        const productIdMap = {};
        if (saleData.items && Array.isArray(saleData.items)) {
          for (const item of saleData.items) {
            let product = null;

            if (item.product_id != null) {
              product = await db.get(
                `SELECT id FROM products WHERE client_product_id = ? AND license_id = ?`,
                [item.product_id, licenseId]
              );
            }

            if (!product && item.barcode) {
              product = await db.get(
                `SELECT id FROM products WHERE barcode = ? AND (license_id = ? OR license_id IS NULL)`,
                [item.barcode, licenseId]
              );
            }

            if (!product) {
              const nowIso = new Date().toISOString();
              const result = await db.run(
                `INSERT INTO products (
                  name, barcode, price, cost_price, stock, category, unit,
                  is_active, created_at, updated_at, client_product_id, license_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  item.product_name || 'Produto',
                  item.barcode || null,
                  item.price || 0,
                  item.cost_price || 0,
                  0,
                  item.category || null,
                  item.unit || 'UN',
                  1,
                  saleData.date || nowIso,
                  saleData.date || nowIso,
                  item.product_id || null,
                  licenseId,
                ]
              );
              product = { id: result.lastID };
            }

            productIdMap[item.product_id] = product.id;
          }
        }

        const saleResult = await db.run(
          `INSERT INTO sales (
            user_id, user_name, total_amount, subtotal, tax_amount, discount_amount,
            customer_name, customer_nuit, notes, payment_method, status,
            client_sale_id, license_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            1,
            saleData.user || 'Sistema',
            saleData.total || 0,
            saleData.subtotal || saleData.total || 0,
            saleData.iva_amount || 0,
            saleData.discount_amount || 0,
            saleData.customer_name || null,
            saleData.customer_nuit || null,
            saleData.notes || null,
            saleData.payment_method || 'cash',
            saleData.status || 'completed',
            clientSaleId,
            licenseId,
            saleData.date || new Date().toISOString(),
            new Date().toISOString(),
          ]
        );
        const serverSaleId = saleResult.lastID;

        if (saleData.items && Array.isArray(saleData.items)) {
          for (const item of saleData.items) {
            const serverProductId = productIdMap[item.product_id];
            if (!serverProductId) continue;

            await db.run(
              `INSERT INTO sale_items (
                sale_id, product_id, product_name, quantity, unit_price,
                cost_price, total_price, discount, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                serverSaleId,
                serverProductId,
                item.product_name || 'Item',
                item.quantity || 0,
                item.price || 0,
                item.cost_price || 0,
                (item.price || 0) * (item.quantity || 0),
                item.discount_amount || 0,
                item.date || saleData.date || new Date().toISOString(),
              ]
            );
          }
        }

        if (saleData.payments && Array.isArray(saleData.payments)) {
          for (const payment of saleData.payments) {
            await db.run(
              `INSERT INTO sale_payments (
                sale_id, method, amount, change_amount, reference, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)`,
              [
                serverSaleId,
                payment.method || 'cash',
                payment.amount || 0,
                payment.change || 0,
                payment.reference || null,
                payment.created_at || saleData.date || new Date().toISOString(),
              ]
            );
          }
        }

        if (saleData.stock_movements && Array.isArray(saleData.stock_movements)) {
          for (const sm of saleData.stock_movements) {
            const serverProductId = productIdMap[sm.product_id];
            if (!serverProductId) continue;

            await db.run(
              `INSERT INTO stock_movements (
                product_id, type, quantity, unit_cost, reason, sale_id, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                serverProductId,
                sm.type || 'sale',
                sm.quantity || 0,
                sm.unit_cost || 0,
                sm.reason || 'Sync VMP',
                serverSaleId,
                sm.date || saleData.date || new Date().toISOString(),
              ]
            );

            await db.run(
              `UPDATE products SET stock = stock + ? WHERE id = ?`,
              [sm.quantity || 0, serverProductId]
            );
          }
        }

        results.push({ clientSaleId, status: 'synced', serverId: serverSaleId });

        // CORREÇÃO: Removido o await para não bloquear a resposta da API
        // MELHORIA: Título e campos incluem o email do estabelecimento (req.license.client)
        sendDiscordNotification({
          title: `🛒 Nova Venda Sincronizada - ${req.license.client}`,
          description: `Venda de **${saleData.total} MZN** registada no servidor.`,
          color: 3066993,
          fields: [
            { name: 'Licença de:', value: req.license.client, inline: true },
            { name: 'Cliente', value: saleData.customer_name || 'Consumidor Final', inline: true },
            { name: 'Operador', value: saleData.user || 'Sistema', inline: true },
            { name: 'Método', value: saleData.payment_method || 'cash', inline: true }
          ]
        });

      } catch (itemError) {
        console.error(`SYNC SALE ERROR (clientSaleId=${clientSaleId}):`, itemError);
        errors.push({ clientSaleId, error: itemError.message });
      }
    }

    res.json({
      success: true,
      synced: results.filter(r => r.status === 'synced').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: errors.length,
      details: results,
      errorDetails: errors,
    });

  } catch (e) {
    console.error('SYNC SALES ERROR:', e);
    res.status(500).json({
      success: false,
      error: 'server_error',
      message: e.message,
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
    let customFeatures = [];
    try {
      customFeatures = license.custom_features ? JSON.parse(license.custom_features) : [];
    } catch (e) {
      customFeatures = [];
    }

    const hasRemoteDashboardFeature = plan === 'enterprise' || customFeatures.includes('remote_dashboard');
    if (!hasRemoteDashboardFeature) {
      return res.status(403).json({
        success: false,
        error: 'feature_not_available',
        message: 'Dashboard remoto não disponível para este plano',
      });
    }

    const catOffset = "+2 hours";

    const todaySales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE date(created_at, '${catOffset}') = date('now', '${catOffset}') 
      AND status = 'completed'
      AND license_id = ?
    `, [licenseId]);

    const monthSales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE strftime('%Y-%m', created_at, '${catOffset}') = strftime('%Y-%m', 'now', '${catOffset}') 
      AND status = 'completed'
      AND license_id = ?
    `, [licenseId]);

    const weekSales = await db.get(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM sales 
      WHERE date(created_at, '${catOffset}') >= date('now', '${catOffset}', '-7 days') 
      AND status = 'completed'
      AND license_id = ?
    `, [licenseId]);

    // CORREÇÃO: Removido is_service. Agora usa stock/min_stock para identificar serviços
    const topProducts = await db.all(`
      SELECT p.name, p.stock, p.min_stock, SUM(si.quantity) as qty, SUM(si.total_price) as revenue
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' 
      AND s.license_id = ?
      AND date(s.created_at, '${catOffset}') >= date('now', '${catOffset}', '-7 days')
      GROUP BY si.product_id, p.name, p.stock, p.min_stock
      ORDER BY qty DESC
      LIMIT 5
    `, [licenseId]);

    // CORREÇÃO: Removido is_service. Usa min_stock > 0 para excluir serviços
    const lowStock = await db.all(`
      SELECT name, stock, min_stock
      FROM products
      WHERE stock <= min_stock AND stock > 0 AND is_active = 1
      AND min_stock > 0
      AND license_id = ?
      ORDER BY stock ASC
      LIMIT 10
    `, [licenseId]);

    // CORREÇÃO: Removido is_service. Usa min_stock > 0 para excluir serviços
    const outOfStock = await db.all(`
      SELECT name, stock, min_stock
      FROM products
      WHERE stock <= 0 AND is_active = 1
      AND min_stock > 0
      AND license_id = ?
      ORDER BY name ASC
      LIMIT 10
    `, [licenseId]);

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
      AND license_id = ?
      AND date(created_at, '${catOffset}') >= date('now', '${catOffset}', '-7 days')
      GROUP BY date(created_at, '${catOffset}')
      ORDER BY day ASC
    `, [licenseId]);

    const productCount = await db.get(`
      SELECT COUNT(*) as count FROM products 
      WHERE is_active = 1 AND license_id = ?
    `, [licenseId]);

    const userCount = await db.get(`SELECT COUNT(*) as count FROM pos_users WHERE is_active = 1`);

    await db.run(
      `UPDATE remote_access_tokens SET last_used_at = ? WHERE token = ?`,
      [now.toISOString(), token]
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
      `UPDATE remote_access_tokens SET is_revoked = 1 WHERE token = ?`,
      [token]
    );

    res.json({ success: true, message: 'Sessão terminada' });

  } catch (e) {
    console.error('LOGOUT ERROR:', e);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

export default router;