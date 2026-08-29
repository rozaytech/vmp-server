import { initDB } from "../db.js";
import { sendDiscordNotification } from "../services/discordNotificationService.js";
import bcrypt from "bcryptjs";

export async function getLicenses(req, res) {
  try {
    const db = await initDB();

    const licenses = await db.all(`
      SELECT * FROM licenses
      ORDER BY expiry DESC
    `);

    return res.json(licenses);
  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: "server_error",
    });
  }
}

export async function revokeLicense(req, res) {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        error: "missing_id",
      });
    }

    const db = await initDB();

    // Buscar informações da licença antes de revogar
    const license = await db.get(
      `SELECT client, plan FROM licenses WHERE id = ?`,
      [id]
    );

    await db.run(
      `
      UPDATE licenses
      SET status = 'revoked'
      WHERE id = ?
      `,
      [id]
    );

    // NOTIFICAÇÃO: Licença revogada
    if (license) {
      await sendDiscordNotification({
        title: '⚠️ Licença Revogada',
        description: `A licença do cliente **${license.client}** (Plano: ${license.plan}) foi revogada manualmente.`,
        color: 15158332, // Vermelho
      });
    }

    return res.json({
      success: true,
    });
  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: "server_error",
    });
  }
}

// =========================================================
// GESTÃO DE UTILIZADORES (ADMIN PANEL)
// =========================================================
export async function listUsers(req, res) {
  try {
    const db = await initDB();
    // Seleciona todas as colunas para evitar erros de coluna em falta
    const users = await db.all(`SELECT * FROM admins ORDER BY created_at DESC`);
    return res.json({ users });
  } catch (e) {
    console.error("LIST USERS ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function createUser(req, res) {
  try {
    const { name, email, username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: "missing_fields" });

    const db = await initDB();
    const existing = await db.get(`SELECT id FROM admins WHERE username = ?`, [username]);
    if (existing) return res.status(409).json({ error: "username_taken" });

    const hashed = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO admins (username, password, role, name, email, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [username, hashed, role || 'viewer', name || username, email || null, now]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error("CREATE USER ERROR:", e);
    return res.status(500).json({ error: "server_error", details: e.message });
  }
}

export async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) return res.status(400).json({ error: "cannot_delete_self" });

    const db = await initDB();
    const user = await db.get(`SELECT role FROM admins WHERE id = ?`, [id]);

    if (!user) return res.status(404).json({ error: "not_found" });
    if (user.role === 'superadmin') return res.status(403).json({ error: "cannot_delete_superadmin" });

    await db.run(`DELETE FROM admins WHERE id = ?`, [id]);
    return res.json({ success: true });
  } catch (e) {
    console.error("DELETE USER ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}