import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { initDB } from "../db.js";

const SECRET = "VMP_JWT_SECRET_2026";

// Helper para verificar password (suporta passwords antigas em texto simples)
function verifyPassword(inputPassword, storedPassword) {
  if (storedPassword.startsWith('$2')) {
    return bcrypt.compareSync(inputPassword, storedPassword);
  }
  return inputPassword === storedPassword; // Fallback para texto simples
}

export async function login(req, res) {
  const { email, password, username } = req.body;
  const identifier = username || email;

  const db = await initDB();
  const user = await db.get(`SELECT * FROM admins WHERE email = ? OR username = ?`, [identifier, identifier]);

  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const valid = verifyPassword(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  // Migrar password para hash bcrypt se ainda estiver em texto simples
  if (!user.password.startsWith('$2')) {
    await db.run(`UPDATE admins SET password = ? WHERE id = ?`, [bcrypt.hashSync(password, 10), user.id]);
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: "8h" }
  );

  return res.json({ 
    token, 
    role: user.role, 
    username: user.username, 
    name: user.name || user.username 
  });
}

export async function getProfile(req, res) {
  try {
    const db = await initDB();
    const user = await db.get(`SELECT id, username, email, name, phone, role, created_at FROM admins WHERE id = ?`, [req.user.id]);

    if (!user) return res.status(404).json({ error: "not_found" });

    return res.json(user);
  } catch (e) {
    console.error("GET PROFILE ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function updateProfile(req, res) {
  try {
    const { name, username, email, phone } = req.body;
    const db = await initDB();

    // Verifica se o novo username já existe (exceto para si mesmo)
    if (username) {
      const existing = await db.get(`SELECT id FROM admins WHERE username = ? AND id != ?`, [username, req.user.id]);
      if (existing) {
        return res.status(409).json({ message: "Nome de utilizador já existe." });
      }
    }

    await db.run(
      `UPDATE admins SET name = ?, username = ?, email = ?, phone = ? WHERE id = ?`,
      [name, username, email, phone, req.user.id]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error("UPDATE PROFILE ERROR:", e);
    return res.status(500).json({ message: "Erro ao atualizar perfil." });
  }
}

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = await initDB();
    const user = await db.get(`SELECT * FROM admins WHERE id = ?`, [req.user.id]);

    if (!user) return res.status(404).json({ error: "not_found" });

    const valid = verifyPassword(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Password atual incorreta." });
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    await db.run(`UPDATE admins SET password = ? WHERE id = ?`, [hashed, req.user.id]);

    return res.json({ success: true });
  } catch (e) {
    console.error("CHANGE PASSWORD ERROR:", e);
    return res.status(500).json({ message: "Erro ao alterar password." });
  }
}