import { initDB } from "../db.js";

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

    await db.run(
      `
      UPDATE licenses
      SET status = 'revoked'
      WHERE id = ?
      `,
      [id]
    );

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