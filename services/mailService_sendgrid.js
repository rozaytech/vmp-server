import sgMail from '@sendgrid/mail';
import { initDB } from '../db.js';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'freelancer.adamgy@gmail.com';

if (SENDGRID_API_KEY && !SENDGRID_API_KEY.includes('demo')) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// =========================================================
// SEND EMAIL
// =========================================================
export async function sendEmail({ to, subject, body, html }) {
  try {
    if (!SENDGRID_API_KEY || SENDGRID_API_KEY.includes('demo')) {
      console.log('[EMAIL MOCK] SendGrid não configurado.');
      console.log('Para:', to, '| Assunto:', subject);
      await logEmail(to, subject, body, 'mock_no_api_key', 'API key não configurada');
      return {
        success: false,
        status: 'mock',
        message: 'Email simulado (API key não configurada)',
      };
    }

    const msg = {
      to,
      from: { email: FROM_EMAIL, name: 'VMP SaaS' },
      subject,
      text: body,
      html: html || body?.replace(/\n/g, '<br>') || '',
    };

    const [response] = await sgMail.send(msg);

    const messageId = response?.headers?.['x-message-id'] || 'unknown';

    console.log('[EMAIL ENVIADO]', messageId, '→', to);
    await logEmail(to, subject, body, 'sent', null, messageId);

    return {
      success: true,
      messageId,
      status: 'sent',
    };
  } catch (error) {
    const errMsg = error.response?.body?.errors?.[0]?.message || error.message;
    console.error('[EMAIL ERROR]', errMsg);
    await logEmail(to, subject, body, 'failed', errMsg);

    return {
      success: false,
      status: 'failed',
      error: errMsg,
    };
  }
}

// =========================================================
// LOG EMAIL TO DB
// =========================================================
async function logEmail(to, subject, body, status, errorMessage = null, messageId = null) {
  try {
    const db = await initDB();
    await db.run(
      `INSERT INTO email_logs (recipient, subject, body, status, error_message, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        to,
        subject,
        body?.substring(0, 2000) || '',
        status,
        errorMessage,
        messageId,
        new Date().toISOString(),
      ]
    );
  } catch (e) {
    console.error('EMAIL LOG ERROR:', e);
  }
}

// =========================================================
// TEMPLATES (iguais ao Resend, reutilizáveis)
// =========================================================
export function licenseApprovedTemplate(clientEmail, licenseKey, plan, expiryDate) {
  return {
    subject: '✅ VMP SaaS — Licença Aprovada',
    body: `Olá,

A sua licença VMP foi aprovada com sucesso!

📋 DETALHES:
• Plano: ${plan}
• Validade: ${new Date(expiryDate).toLocaleDateString('pt-PT')}
• Email: ${clientEmail}

🔑 CHAVE DE ATIVAÇÃO:
${licenseKey}

📲 COMO ATIVAR:
1. Abra a aplicação VMP
2. Na tela de ativação, cole a chave acima
3. Clique em "Ativar com Licença"

💬 SUPORTE:
• WhatsApp: 846166104
• Email: freelancer.adamgy@gmail.com

Obrigado por escolher VMP SaaS!
Equipa VMP`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f8f9fa;">
        <div style="background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
          <h2 style="color: #2e7d32; margin-top: 0;">✅ Licença VMP Aprovada</h2>
          <p>Olá,</p>
          <p>A sua licença foi aprovada com sucesso!</p>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 8px 0;"><strong>Plano:</strong> ${plan}</p>
            <p style="margin: 8px 0;"><strong>Validade:</strong> ${new Date(expiryDate).toLocaleDateString('pt-PT')}</p>
            <p style="margin: 8px 0;"><strong>Email:</strong> ${clientEmail}</p>
          </div>
          <p><strong>🔑 Chave de Ativação:</strong></p>
          <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; word-break: break-all; font-family: monospace; font-size: 13px; border: 1px dashed #4caf50;">
            ${licenseKey}
          </div>
          <div style="margin-top: 24px; padding: 16px; background: #e3f2fd; border-radius: 8px;">
            <p style="margin: 0 0 12px; font-weight: bold;">📲 Como Ativar:</p>
            <ol style="margin: 0; padding-left: 20px;">
              <li>Abra a aplicação VMP</li>
              <li>Na tela de ativação, cole a chave acima</li>
              <li>Clique em "Ativar com Licença"</li>
            </ol>
          </div>
          <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="margin: 0 0 8px; font-weight: bold;">💬 Suporte:</p>
            <p style="margin: 4px 0;">• WhatsApp: <a href="https://wa.me/258846166104" style="color: #25d366;">846166104</a></p>
            <p style="margin: 4px 0;">• Email: <a href="mailto:freelancer.adamgy@gmail.com" style="color: #1976d2;">freelancer.adamgy@gmail.com</a></p>
          </div>
          <p style="margin-top: 24px; color: #666; font-size: 13px;">Obrigado por escolher VMP SaaS!<br>Equipa VMP</p>
        </div>
      </div>
    `,
  };
}

export function trialStartedTemplate(clientEmail, days, expiryDate) {
  return {
    subject: '🎉 VMP SaaS — Trial Iniciado',
    body: `Olá,

O seu trial de ${days} dias foi iniciado com sucesso!

📋 DETALHES:
• Validade: ${new Date(expiryDate).toLocaleDateString('pt-PT')}
• Email: ${clientEmail}

✅ A sua aplicação já está ativa!
Aproveite para testar todas as funcionalidades do VMP.

⏰ Quando o trial terminar:
• Pode renovar para plano pago
• Ou solicitar nova licença

💬 SUPORTE:
• WhatsApp: 846166104
• Email: freelancer.adamgy@gmail.com

Obrigado,
Equipa VMP SaaS`,
  };
}

export function paymentInstructionsTemplate(clientEmail, method, reference, amount, instructions) {
  const methodNames = {
    emola: 'eMola',
    mpesa: 'M-Pesa',
    visa: 'Cartão Visa',
    transfer: 'Transferência Bancária',
  };

  return {
    subject: `💳 VMP SaaS — Instruções de Pagamento (${methodNames[method] || method})`,
    body: `Olá,

Recebemos o seu pedido de ativação. Para concluir, efetue o pagamento:

📋 DETALHES DO PAGAMENTO:
• Método: ${methodNames[method] || method}
• Valor: ${amount.toFixed(2)} MZN
• Referência: ${reference}
• Cliente: ${clientEmail}

${instructions.message}

${instructions.phone ? `• Número: ${instructions.phone}` : ''}
${instructions.holder ? `• Titular: ${instructions.holder}` : ''}
${instructions.bank ? `• Banco: ${instructions.bank}` : ''}
${instructions.accountNumber ? `• Conta: ${instructions.accountNumber}` : ''}
${instructions.nib ? `• NIB: ${instructions.nib}` : ''}
${instructions.iban ? `• IBAN: ${instructions.iban}` : ''}

✅ PRÓXIMOS PASSOS:
1. Efetue o pagamento com os dados acima
2. Envie o comprovativo por:
   • WhatsApp: 846166104
   • Email: freelancer.adamgy@gmail.com
3. A sua licença será ativada em até 24h

⏳ Prazo: O pagamento deve ser efetuado em até 48h.

Obrigado,
Equipa VMP SaaS`,
  };
}

export function requestReceivedTemplate(clientEmail, machineId, plan, requestId) {
  return {
    subject: '📥 VMP SaaS — Pedido Recebido',
    body: `Olá,

Recebemos o seu pedido de ativação para o plano ${plan}.

📋 DETALHES:
• Email: ${clientEmail}
• Machine ID: ${machineId}
• Plano: ${plan}
• Pedido: ${requestId}

⏳ O seu pedido está em análise.
Assim que aprovado, receberá a licença por email.

💬 DÚVIDAS?
• WhatsApp: 846166104
• Email: freelancer.adamgy@gmail.com

Obrigado pela paciência,
Equipa VMP SaaS`,
  };
}