import jwt from "jsonwebtoken";

const SECRET = "VMP_JWT_SECRET_2026";

export function authMiddleware(
  req,
  res,
  next
) {
  try {
    const authHeader =
      req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "missing_authorization_header",
      });
    }

    const parts =
      authHeader.split(" ");

    if (
      parts.length !== 2 ||
      parts[0] !== "Bearer"
    ) {
      return res.status(401).json({
        error: "invalid_auth_format",
      });
    }

    const token = parts[1];

    const decoded = jwt.verify(
      token,
      SECRET
    );

    req.user = decoded;

    next();
  } catch (e) {
    return res.status(403).json({
      error: "invalid_token",
    });
  }
}