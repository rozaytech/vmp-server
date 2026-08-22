// =========================================================
// SERVIÇO DE NOTIFICAÇÕES VIA DISCORD WEBHOOK
// Configurado para enviar notificações em tempo real
// =========================================================

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export async function sendDiscordNotification({ title, description = '', color = 3447003, fields = [] }) {
  if (!WEBHOOK_URL) {
    console.warn('Discord Webhook não configurado (DISCORD_WEBHOOK_URL ausente). Notificação ignorada.');
    return false;
  }

  const payload = {
    embeds: [
      {
        title: title,
        description: description,
        color: color,
        fields: fields.map(field => ({
          name: field.name,
          value: field.value,
          inline: field.inline ?? false
        })),
        timestamp: new Date().toISOString(),
      }
    ]
  };

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('Erro ao enviar notificação Discord:', response.status, response.statusText);
      return false;
    }

    console.log('Notificação Discord enviada com sucesso:', title);
    return true;
  } catch (error) {
    console.error('Erro de rede ao enviar notificação Discord:', error);
    return false;
  }
}