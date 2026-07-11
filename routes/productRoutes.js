import express from "express";
import { getDB } from "../db.js";

const router = express.Router();

// =========================================================
// LISTAR PRODUTOS
// =========================================================
router.get("/", async (req, res) => {
  try {
    const db = await getDB();
    const { search, warehouse_id, low_stock, category, is_active } = req.query;

    let query = `
      SELECT p.*, w.name as warehouse_name 
      FROM products p
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (p.name LIKE ? OR p.barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (warehouse_id) {
      query += ` AND p.warehouse_id = ?`;
      params.push(warehouse_id);
    }
    if (low_stock === 'true') {
      query += ` AND p.stock <= p.min_stock`;
    }
    if (category) {
      query += ` AND p.category = ?`;
      params.push(category);
    }
    if (is_active !== undefined) {
      query += ` AND p.is_active = ?`;
      params.push(is_active === 'true' ? 1 : 0);
    }

    query += ` ORDER BY p.name ASC`;
    const products = await db.all(query, params);

    res.json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (e) {
    console.error("LIST PRODUCTS ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// DETALHE DO PRODUTO
// =========================================================
router.get("/:id", async (req, res) => {
  try {
    const db = await getDB();
    const { id } = req.params;

    const product = await db.get(
      `SELECT p.*, w.name as warehouse_name 
       FROM products p
       LEFT JOIN warehouses w ON p.warehouse_id = w.id
       WHERE p.id = ?`,
      [id]
    );

    if (!product) {
      return res.status(404).json({ error: "not_found", message: "Produto não encontrado" });
    }

    res.json({ success: true, data: product });
  } catch (e) {
    console.error("GET PRODUCT ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// BUSCAR POR BARCODE
// =========================================================
router.get("/barcode/:barcode", async (req, res) => {
  try {
    const db = await getDB();
    const { barcode } = req.params;

    const product = await db.get(
      `SELECT p.*, w.name as warehouse_name 
       FROM products p
       LEFT JOIN warehouses w ON p.warehouse_id = w.id
       WHERE p.barcode = ? AND p.is_active = 1
       LIMIT 1`,
      [barcode]
    );

    if (!product) {
      return res.status(404).json({ error: "not_found", message: "Produto não encontrado" });
    }

    res.json({ success: true, data: product });
  } catch (e) {
    console.error("GET PRODUCT BY BARCODE ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// CRIAR PRODUTO
// =========================================================
router.post("/", async (req, res) => {
  try {
    const db = await getDB();
    const {
      name, barcode, price, cost_price, stock, min_stock, max_stock,
      category, unit, warehouse_id, description,
    } = req.body;

    if (!name || price === undefined || stock === undefined) {
      return res.status(400).json({
        error: "missing_fields",
        message: "name, price e stock são obrigatórios",
      });
    }

    // Verificar barcode duplicado
    if (barcode) {
      const existing = await db.get("SELECT id FROM products WHERE barcode = ?", [barcode]);
      if (existing) {
        return res.status(409).json({ error: "duplicate", message: "Barcode já existe" });
      }
    }

    const now = new Date().toISOString();
    const result = await db.run(
      `INSERT INTO products (
        name, barcode, price, cost_price, stock, min_stock, max_stock,
        category, unit, warehouse_id, description, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, barcode, price, cost_price || 0, stock, min_stock || 0, max_stock || 0,
        category || null, unit || 'UN', warehouse_id || null, description || null,
        1, now, now,
      ]
    );

    // Movimento de stock inicial
    await db.run(
      `INSERT INTO stock_movements (
        product_id, type, quantity, unit_cost, reason, warehouse_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [result.lastID, 'initial', stock, cost_price || 0, 'Stock inicial', warehouse_id || null, now]
    );

    const product = await db.get("SELECT * FROM products WHERE id = ?", [result.lastID]);

    res.status(201).json({
      success: true,
      message: "Produto criado com sucesso",
      data: product,
    });
  } catch (e) {
    console.error("CREATE PRODUCT ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// ATUALIZAR PRODUTO
// =========================================================
router.put("/:id", async (req, res) => {
  try {
    const db = await getDB();
    const { id } = req.params;
    const {
      name, barcode, price, cost_price, stock, min_stock, max_stock,
      category, unit, warehouse_id, description, is_active,
    } = req.body;

    const existing = await db.get("SELECT * FROM products WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ error: "not_found", message: "Produto não encontrado" });
    }

    // Verificar barcode duplicado (se mudou)
    if (barcode && barcode !== existing.barcode) {
      const duplicate = await db.get("SELECT id FROM products WHERE barcode = ? AND id != ?", [barcode, id]);
      if (duplicate) {
        return res.status(409).json({ error: "duplicate", message: "Barcode já existe" });
      }
    }

    const stockDiff = stock !== undefined ? stock - existing.stock : 0;
    const now = new Date().toISOString();

    await db.run(
      `UPDATE products SET
        name = COALESCE(?, name),
        barcode = COALESCE(?, barcode),
        price = COALESCE(?, price),
        cost_price = COALESCE(?, cost_price),
        stock = COALESCE(?, stock),
        min_stock = COALESCE(?, min_stock),
        max_stock = COALESCE(?, max_stock),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        warehouse_id = COALESCE(?, warehouse_id),
        description = COALESCE(?, description),
        is_active = COALESCE(?, is_active),
        updated_at = ?
      WHERE id = ?`,
      [
        name, barcode, price, cost_price, stock, min_stock, max_stock,
        category, unit, warehouse_id, description,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        now, id,
      ]
    );

    // Registrar movimento se stock mudou
    if (stockDiff !== 0) {
      await db.run(
        `INSERT INTO stock_movements (
          product_id, type, quantity, unit_cost, reason, warehouse_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          stockDiff > 0 ? 'adjustment_in' : 'adjustment_out',
          Math.abs(stockDiff),
          cost_price || existing.cost_price,
          'Ajuste manual',
          warehouse_id || existing.warehouse_id,
          now,
        ]
      );
    }

    const product = await db.get("SELECT * FROM products WHERE id = ?", [id]);

    res.json({
      success: true,
      message: "Produto atualizado com sucesso",
      data: product,
    });
  } catch (e) {
    console.error("UPDATE PRODUCT ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

// =========================================================
// REMOVER PRODUTO (soft delete)
// =========================================================
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDB();
    const { id } = req.params;

    const existing = await db.get("SELECT * FROM products WHERE id = ?", [id]);
    if (!existing) {
      return res.status(404).json({ error: "not_found", message: "Produto não encontrado" });
    }

    await db.run(
      "UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?",
      [new Date().toISOString(), id]
    );

    res.json({
      success: true,
      message: "Produto desativado com sucesso",
      data: { id, is_active: 0 },
    });
  } catch (e) {
    console.error("DELETE PRODUCT ERROR:", e);
    res.status(500).json({ error: "server_error", details: e.message });
  }
});

export default router;