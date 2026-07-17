import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const SECRET = "VMP_JWT_SECRET_2026";

// mock admin (depois liga ao DB se quiseres)
const adminUser = {
  id: 1,
  email: "admin@vmp.com",
  passwordHash: bcrypt.hashSync("admin123", 10),
  role: "superadmin"
};

export async function login(req, res) {
  const { email, password } = req.body;

  if (email !== adminUser.email) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const valid = bcrypt.compareSync(password, adminUser.passwordHash);

  if (!valid) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = jwt.sign(
    {
      id: adminUser.id,
      role: adminUser.role
    },
    SECRET,
    { expiresIn: "8h" }
  );

  return res.json({ token, role: adminUser.role });
}

export async function changePassword(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "missing_token" });
    }

    const token = authHeader.split(" ")[1];
    let decoded;

    try {
      decoded = jwt.verify(token, SECRET);
    } catch (err) {
      return res.status(401).json({ error: "invalid_token" });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "missing_fields",
        message: "currentPassword e newPassword sao obrigatorios"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: "weak_password",
        message: "A nova password deve ter pelo menos 6 caracteres"
      });
    }

    // Verificar se e o admin mock
    if (decoded.id !== adminUser.id) {
      return res.status(403).json({ error: "unauthorized" });
    }

    const valid = bcrypt.compareSync(currentPassword, adminUser.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "invalid_current_password" });
    }

    // Atualizar hash
    adminUser.passwordHash = bcrypt.hashSync(newPassword, 10);

    return res.json({
      success: true,
      message: "Password alterada com sucesso"
    });

  } catch (e) {
    console.error("CHANGE PASSWORD ERROR:", e);
    return res.status(500).json({ error: "server_error" });
  }
}