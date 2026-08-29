import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { initDB } from "../db.js";

const SECRET = "VMP_JWT_SECRET_2026";

export async function login(req, res) {
  const { email, password } = req.body;

  const db = await initDB();
  const user = await db.get(`SELECT * FROM admins WHERE email = ? OR username = ?`, [email, email]);

  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
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
    const user = await db.get(`SELECT id, username, email, name, role, created_at FROM admins WHERE id = ?`, [req.user.id]);

    if (!user) return res.status(404).json({ error: "not_found" });

    return res.json(user);
  } catch (e) {
    console.error("GET PROFILE ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function updateProfile(req, res) {
  try {
    const { name, username } = req.body;
    const db = await initDB();

    await db.run(`UPDATE admins SET name = ?, username = ? WHERE id = ?`, [name, username, req.user.id]);

    return res.json({ success: true });
  } catch (e) {
    console.error("UPDATE PROFILE ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = await initDB();
    const user = await db.get(`SELECT * FROM admins WHERE id = ?`, [req.user.id]);

    if (!user) return res.status(404).json({ error: "not_found" });

    const valid = bcrypt.compareSync(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: "invalid_current_password" });
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    await db.run(`UPDATE admins SET password = ? WHERE id = ?`, [hashed, req.user.id]);

    return res.json({ success: true });
  } catch (e) {
    console.error("CHANGE PASSWORD ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}