import express from "express";
import { getDB } from "../db.js";
import crypto from "crypto";

const router = express.Router();

// =========================================================
// LISTAR VENDAS
// =========================================================
router.get("/", async (req, res) => {
  try {
    const db = await getDB();
    const { start_date, end_date, user_id, status, page = 1, limit = 50 } = req.query;

    let query = `
      SELECT s.*, u.name as user_name 
      FROM sales s
      LEFT JOIN pos_users u ON s.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date) {
      query += ` AND DATE(s.created_at) >= DATE(?)`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND DATE(s.created_at) <= DATE(?)`;
      params.push(end_date);
    }
    if (user_id) {
      query += ` AND s.user_id = ?`;
      params.push(user_id);
    }
    if (status) {
      query += ` AND s.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const sales = await db.all(query, params);

    // Count total
    let countQuery = `SELECT COUNT(*) as total FROM sales s WHERE 1=1`;
    const countParams = [];
    if (start_date) {
      countQuery += ` AND DATE(s.created_at) >= DATE(?)`;
      countParams.push(start_date);
    }
    if (end_date) {
      countQuery += ` AND DATE(s.created_at) <= DATE(?)`;
      countParams.push(end_date);
    }
    if (user_id) {
      countQuery += ` AND s.user_id = ?`;
      countParams.push(user_id);
    }
    if (status) {
      countQuery += ` AND s.status = ?`;
      countParams.push(status);
    }

    const { total } = await db.get(countQuery, countParams);

    res.json({
      success: true,
      count: sales.length,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      data: sales,
    });
  } catch (e) {
    console.error("LIST SALES ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// DETALHE DA VENDA
// =========================================================
router.get("/:id", async (req, res) => {
  try {
    const db = await getDB();
    const { id } = req.params;

    const sale = await db.get(
      `SELECT s.*, u.name as user_name 
       FROM sales s
       LEFT JOIN pos_users u ON s.user_id = u.id
       WHERE s.id = ?`,
      [id]
    );

    if (!sale) {
      return res.status(404).json({ error: "not_found", message: "Venda não encontrada" });
    }

    const items = await db.all(
      `SELECT si.*, p.barcode 
       FROM sale_items si
       LEFT JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = ?`,
      [id]
    );

    const payments = await db.all(
      `SELECT * FROM sale_payments WHERE sale_id = ?`,
      [id]
    );

    res.json({
      success: true,
      data: { ...sale, items, payments },
    });
  } catch (e) {
    console.error("GET SALE ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// CRIAR VENDA (com transaction)
// =========================================================
router.post("/", async (req, res) => {
  try {
    const db = await getDB();
    const {
      user_id, items, payments, total_amount, subtotal,
      tax_amount, discount_amount, customer_name, customer_nuit,
      notes, payment_method,
    } = req.body;

    if (!user_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "missing_fields",
        message: "user_id e items são obrigatórios",
      });
    }

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({
        error: "missing_fields",
        message: "payments são obrigatórios",
      });
    }

    await db.run("BEGIN TRANSACTION");
    const now = new Date().toISOString();

    try {
      // Gerar hash de auditoria
      const hashInput = `${user_id}-${Date.now()}-${JSON.stringify(items)}`;
      const auditHash = crypto.createHash("sha256").update(hashInput).digest("hex");

      // Criar venda
      const saleResult = await db.run(
        `INSERT INTO sales (
          user_id, total_amount, subtotal, tax_amount, discount_amount,
          customer_name, customer_nuit, notes, payment_method,
          status, audit_hash, is_synced, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user_id, total_amount, subtotal, tax_amount || 0, discount_amount || 0,
          customer_name || null, customer_nuit || null, notes || null, payment_method || null,
          'completed', auditHash, 1, now, now,
        ]
      );

      const saleId = saleResult.lastID;

      // Processar items
      for (const item of items) {
        // Verificar stock
        const product = await db.get(
          "SELECT stock, name FROM products WHERE id = ?",
          [item.product_id]
        );

        if (!product) {
          throw new Error(`Produto ${item.product_id} não encontrado`);
        }

        if (product.stock < item.quantity) {
          throw new Error(`Stock insuficiente para: ${product.name}`);
        }

        // Inserir item
        await db.run(
          `INSERT INTO sale_items (
            sale_id, product_id, product_name, quantity, unit_price,
            cost_price, total_price, discount, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleId, item.product_id, item.product_name || item.name,
            item.quantity, item.unit_price, item.cost_price || 0,
            item.total_price, item.discount || 0, now,
          ]
        );

        // Atualizar stock
        await db.run(
          "UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?",
          [item.quantity, now, item.product_id]
        );

        // Movimento de stock
        await db.run(
          `INSERT INTO stock_movements (
            product_id, type, quantity, unit_cost, reason, sale_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.product_id, 'sale', item.quantity, item.cost_price || 0,
            'Venda POS', saleId, now,
          ]
        );
      }

      // Inserir pagamentos
      for (const payment of payments) {
        await db.run(
          `INSERT INTO sale_payments (
            sale_id, method, amount, change_amount, reference, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            saleId, payment.method, payment.amount,
            payment.change_amount || 0, payment.reference || null, now,
          ]
        );
      }

      await db.run("COMMIT");

      const sale = await db.get("SELECT * FROM sales WHERE id = ?", [saleId]);

      res.status(201).json({
        success: true,
        message: "Venda criada com sucesso",
        data: sale,
      });
    } catch (innerError) {
      await db.run("ROLLBACK");
      throw innerError;
    }
  } catch (e) {
    console.error("CREATE SALE ERROR:", e);
    res.status(400).json({
      error: "transaction_error",
      message: e.message || "Falha ao criar venda",
    });
  }
});

// =========================================================
// CANCELAR VENDA
// =========================================================
router.post("/:id/cancel", async (req, res) => {
  try {
    const db = await getDB();
    const { id } = req.params;
    const { reason, cancelled_by } = req.body;

    const sale = await db.get("SELECT * FROM sales WHERE id = ?", [id]);
    if (!sale) {
      return res.status(404).json({ error: "not_found", message: "Venda não encontrada" });
    }

    if (sale.status === 'cancelled') {
      return res.status(400).json({ error: "already_cancelled", message: "Venda já cancelada" });
    }

    await db.run("BEGIN TRANSACTION");
    const now = new Date().toISOString();

    try {
      // Devolver stock
      const items = await db.all("SELECT * FROM sale_items WHERE sale_id = ?", [id]);
      for (const item of items) {
        await db.run(
          "UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?",
          [item.quantity, now, item.product_id]
        );

        await db.run(
          `INSERT INTO stock_movements (
            product_id, type, quantity, unit_cost, reason, sale_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.product_id, 'cancelled_sale', item.quantity, item.cost_price,
            `Cancelamento: ${reason || 'Sem motivo'}`, id, now,
          ]
        );
      }

      // Atualizar venda
      await db.run(
        `UPDATE sales SET 
          status = 'cancelled', 
          cancelled_at = ?, 
          cancelled_by = ?, 
          cancellation_reason = ?,
          updated_at = ?
        WHERE id = ?`,
        [now, cancelled_by || null, reason || 'Cancelado', now, id]
      );

      await db.run("COMMIT");

      res.json({
        success: true,
        message: "Venda cancelada com sucesso",
        data: { id, status: 'cancelled' },
      });
    } catch (innerError) {
      await db.run("ROLLBACK");
      throw innerError;
    }
  } catch (e) {
    console.error("CANCEL SALE ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// REEMBOLSO PARCIAL
// =========================================================
router.post("/:id/refund", async (req, res) => {
  try {
    const db = await getDB();
    const { id } = req.params;
    const { items, total_refund_amount, reason, processed_by } = req.body;

    const sale = await db.get("SELECT * FROM sales WHERE id = ?", [id]);
    if (!sale) {
      return res.status(404).json({ error: "not_found", message: "Venda não encontrada" });
    }

    await db.run("BEGIN TRANSACTION");
    const now = new Date().toISOString();

    try {
      for (const item of items) {
        // Devolver stock
        await db.run(
          "UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?",
          [item.quantity, now, item.product_id]
        );

        await db.run(
          `INSERT INTO stock_movements (
            product_id, type, quantity, unit_cost, reason, sale_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.product_id, 'refund', item.quantity, item.unit_cost || 0,
            `Reembolso: ${reason || 'Sem motivo'}`, id, now,
          ]
        );
      }

      await db.run("COMMIT");

      res.json({
        success: true,
        message: "Reembolso processado com sucesso",
        data: { sale_id: id, refund_amount: total_refund_amount, reason },
      });
    } catch (innerError) {
      await db.run("ROLLBACK");
      throw innerError;
    }
  } catch (e) {
    console.error("REFUND SALE ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// ESTATÍSTICAS DO DASHBOARD
// =========================================================
router.get("/dashboard/stats", async (req, res) => {
  try {
    const db = await getDB();

    // Vendas hoje
    const today = await db.get(
      `SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(total_amount), 0) as total_revenue,
        COALESCE(SUM(discount_amount), 0) as total_discounts
      FROM sales 
      WHERE status = 'completed'
      AND DATE(created_at) = DATE('now')`
    );

    // Por método de pagamento
    const paymentMethods = await db.all(
      `SELECT 
        payment_method as method,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as total
      FROM sales 
      WHERE status = 'completed'
      AND DATE(created_at) = DATE('now')
      GROUP BY payment_method`
    );

    // Top produtos hoje
    const topProducts = await db.all(
      `SELECT 
        si.product_id,
        si.product_name,
        SUM(si.quantity) as total_quantity,
        SUM(si.total_price) as total_revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed'
      AND DATE(s.created_at) = DATE('now')
      GROUP BY si.product_id, si.product_name
      ORDER BY total_quantity DESC
      LIMIT 10`
    );

    // Alertas stock baixo
    const lowStock = await db.get(
      `SELECT COUNT(*) as count FROM products 
       WHERE stock <= min_stock AND is_active = 1`
    );

    res.json({
      success: true,
      data: {
        today,
        payment_methods: paymentMethods,
        top_products: topProducts,
        low_stock_alert: lowStock.count,
      },
    });
  } catch (e) {
    console.error("DASHBOARD STATS ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

export default router;