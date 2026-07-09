import { Resend } from 'resend';

// Em produção: usar variável de ambiente
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_xxxxxxxx'; // substitui pela tua key
const resend = new Resend(RESEND_API_KEY);

const FROM_EMAIL = 'VMP SaaS <licencas@vmp-saas.com>'; // ou o domínio que verificares no Resend

// =========================================================
// SEND EMAIL REAL (Resend)
// =========================================================
export async function sendEmail({ to, subject, body, html }) {
  try {
    const data = await resend.emails.send({
      from: FROM_EMAIL,
      to: [to],
      subject: subject,
      text: body,
      html: html || body?.replace(/\n/g, '<br>'),
    });

    console.log('EMAIL ENVIADO:', data);

    return {
      success: true,
      messageId: data.id,
      status: 'sent',
    };
  } catch (error) {
    console.error('EMAIL ERROR:', error);

    // Fallback: guardar na DB para retry manual
    const db = await initDB();
    await db.run(
      `
      INSERT INTO email_logs (recipient, subject, body, status, created_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      [to, subject, body || html, 'failed', new Date().toISOString()]
    );

    return {
      success: false,
      error: error.message,
      status: 'failed',
    };
  }
}

// Templates (mantêm-se iguais)
export function licenseApprovedTemplate(clientEmail, licenseKey, plan, expiryDate) {
  return {
    subject: 'VMP SaaS - Licença Aprovada',
    body: `Olá,

A sua licença VMP foi aprovada com sucesso!

Plano: ${plan}
Validade: ${expiryDate}

Chave de ativação:
${licenseKey}

Copie esta chave e cole na aplicação VMP para ativar.

Obrigado,
Equipa VMP SaaS`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2e7d32;">Licença VMP Aprovada</h2>
        <p>Olá,</p>
        <p>A sua licença foi aprovada com sucesso!</p>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Plano:</strong> ${plan}</p>
          <p><strong>Validade:</strong> ${expiryDate}</p>
        </div>
        <p>Chave de ativação:</p>
        <div style="background: #e8f5e9; padding: 15px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 13px;">
          ${licenseKey}
        </div>
        <p style="margin-top: 20px;">Copie esta chave e cole na aplicação VMP para ativar.</p>
        <p>Obrigado,<br>Equipa VMP SaaS</p>
      </div>
    `,
  };
}

export function trialStartedTemplate(clientEmail, days, expiryDate) {
  return {
    subject: 'VMP SaaS - Trial Iniciado',
    body: `Olá,

O seu trial de ${days} dias foi iniciado com sucesso!

Validade: ${expiryDate}

A sua aplicação já está ativa. Aproveite para testar todas as funcionalidades.

Obrigado,
Equipa VMP SaaS`,
  };
}

export function paymentInstructionsTemplate(clientEmail, method, reference, amount, instructions) {
  return {
    subject: `VMP SaaS - Instruções de Pagamento (${method})`,
    body: `Olá,

Recebemos o seu pedido de ativação. Para concluir, efetue o pagamento:

Método: ${method}
Valor: ${amount}
Referência: ${reference}

${instructions}

Assim que confirmarmos o pagamento, a sua licença será ativada automaticamente.

Obrigado,
Equipa VMP SaaS`,
  };
}