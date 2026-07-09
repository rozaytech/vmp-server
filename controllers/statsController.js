import { initDB } from "../db.js";

export async function getStats(req, res) {
  try {
    const db = await initDB();

    const total = await db.get(
      `SELECT COUNT(*) as count FROM licenses`
    );

    const active = await db.get(
      `SELECT COUNT(*) as count FROM licenses WHERE status = 'active'`
    );

    const revoked = await db.get(
      `SELECT COUNT(*) as count FROM licenses WHERE status = 'revoked'`
    );

    const expired = await db.get(
      `SELECT COUNT(*) as count FROM licenses WHERE datetime(expiry) < datetime('now')`
    );

    const latest = await db.all(
      `SELECT * FROM licenses ORDER BY created_at DESC LIMIT 5`
    );

    return res.json({
      data: {
        total: total.count,
        active: active.count,
        revoked: revoked.count,
        expired: expired.count,
        latest,
      },
    });
  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: "server_error",
    });
  }
}