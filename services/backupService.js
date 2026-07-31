import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'database.db');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Config
const ENABLED = process.env.BACKUP_ENABLED !== 'false';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const BACKUP_EMAIL = process.env.BACKUP_EMAIL;
const SCHEDULE_HOUR = parseInt(process.env.BACKUP_HOUR || '2', 10);
const SCHEDULE_MINUTE = parseInt(process.env.BACKUP_MINUTE || '0', 10);
const API_KEY = process.env.BACKUP_API_KEY;

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function compressFile(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(outputPath);
    const gzip = zlib.createGzip();
    input.pipe(gzip).pipe(output);
    output.on('finish', resolve);
    output.on('error', reject);
    gzip.on('error', reject);
  });
}

async function sendToDiscord(filePath, fileName, caption) {
  if (!DISCORD_WEBHOOK) return false;

  const fileBuffer = fs.readFileSync(filePath);
  const boundary = '----VMPBoundary' + Math.random().toString(36).substring(2);

  const payloadJson = JSON.stringify({
    content: caption,
    username: 'VMP Backup',
    avatar_url: 'https://cdn-icons-png.flaticon.com/512/2920/2920277.png',
  });

  const parts = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n${payloadJson}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/gzip\r\n\r\n`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const res = await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[BACKUP] Discord erro:', text);
    return false;
  }
  return true;
}

async function sendToEmail(filePath, fileName, caption) {
  if (!SENDGRID_API_KEY || !BACKUP_EMAIL) return false;

  const fileBuffer = fs.readFileSync(filePath);
  const base64 = fileBuffer.toString('base64');

  const payload = {
    personalizations: [{ to: [{ email: BACKUP_EMAIL }] }],
    from: { email: 'backup@vmp-saas.com', name: 'VMP Backup' },
    subject: `VMP Backup - ${fileName}`,
    content: [{ type: 'text/plain', value: caption }],
    attachments: [{
      content: base64,
      filename: fileName,
      type: 'application/gzip',
      disposition: 'attachment',
    }],
  };

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[BACKUP] SendGrid erro:', text);
    return false;
  }
  return true;
}

export async function sendBackup() {
  if (!ENABLED) {
    console.log('[BACKUP] Backup automatico desativado.');
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `vmp-backup-${dateStr}.db.gz`;
  const backupPath = path.join(BACKUP_DIR, fileName);

  try {
    ensureBackupDir();

    if (!fs.existsSync(DB_PATH)) {
      console.error('[BACKUP] Base de dados nao encontrada:', DB_PATH);
      return;
    }

    console.log('[BACKUP] A compactar database.db...');
    await compressFile(DB_PATH, backupPath);

    const fileBuffer = fs.readFileSync(backupPath);
    const sizeKB = (fileBuffer.length / 1024).toFixed(1);

    const catTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Maputo' }));
    const caption =
      `VMP Backup Automatico\n` +
      `Data (CAT): ${catTime.toLocaleString('pt-PT')}\n` +
      `Ficheiro: ${fileName}\n` +
      `Tamanho: ${sizeKB} KB`;

    let sent = false;

    // 1. Tentar Discord
    if (DISCORD_WEBHOOK) {
      console.log('[BACKUP] A enviar para Discord...');
      sent = await sendToDiscord(backupPath, fileName, caption);
      if (sent) console.log('[BACKUP] Discord: OK');
    }

    // 2. Fallback SendGrid
    if (!sent && SENDGRID_API_KEY && BACKUP_EMAIL) {
      console.log('[BACKUP] A enviar para Email (SendGrid)...');
      sent = await sendToEmail(backupPath, fileName, caption);
      if (sent) console.log('[BACKUP] Email: OK');
    }

    if (sent) {
      fs.unlinkSync(backupPath);
      console.log('[BACKUP] Concluido e ficheiro local removido.');
    } else {
      console.error('[BACKUP] Nao foi possivel enviar por nenhum canal. Ficheiro guardado em:', backupPath);
    }

  } catch (e) {
    console.error('[BACKUP] Erro:', e.message);
  }
}

export function startBackupScheduler() {
  if (!ENABLED) {
    console.log('[BACKUP] Scheduler desativado.');
    return;
  }

  if (!DISCORD_WEBHOOK && !(SENDGRID_API_KEY && BACKUP_EMAIL)) {
    console.log('[BACKUP] Nenhum canal configurado. Adicione DISCORD_WEBHOOK_URL ou SENDGRID_API_KEY+BACKUP_EMAIL.');
    return;
  }

  // Converter CAT (UTC+2) para UTC
  let utcHour = SCHEDULE_HOUR - 2;
  if (utcHour < 0) utcHour += 24;

  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(utcHour, SCHEDULE_MINUTE, 0, 0);

  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const msUntil = target - now;
  const minsUntil = Math.round(msUntil / 1000 / 60);

  console.log(`[BACKUP] Scheduler iniciado. Proximo backup: ${target.toISOString()} (em ${minsUntil} minutos)`);

  setTimeout(() => {
    sendBackup();
    setInterval(sendBackup, 24 * 60 * 60 * 1000);
  }, msUntil);
}

export async function triggerBackup(req, res) {
  const apiKey = req.headers['x-api-key'];
  if (!API_KEY || apiKey !== API_KEY) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  await sendBackup();
  res.json({ success: true, message: 'Backup executado. Verifique os logs.' });
}