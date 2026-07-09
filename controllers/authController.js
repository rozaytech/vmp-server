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