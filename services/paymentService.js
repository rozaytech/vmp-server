import { v4 as uuidv4 } from 'uuid';

// =========================================================
// DADOS REAIS DE PAGAMENTO
// =========================================================
const PAYMENT_CONFIG = {
  emola: {
    message: 'Envie o valor via eMola para o número abaixo e indique a referência no assunto.',
    phone: '870018297',
    holder: 'VMP SaaS',
    whatsappConfirm: '846166104',
  },
  mpesa: {
    message: 'Envie o valor via M-Pesa para o número abaixo e indique a referência no assunto.',
    phone: '846166104',
    holder: 'VMP SaaS',
    whatsappConfirm: '846166104',
  },
  visa: {
    message: 'Pagamento via cartão em breve. Por agora, use eMola, M-Pesa ou Transferência Bancária.',
    note: 'Stripe em integração',
  },
  transfer: {
    message: 'Efetue transferência bancária para a conta BCI abaixo.',
    bank: 'BCI - Banco Comercial e de Investimentos',
    accountNumber: '22558873010001',
    nib: '000800002558873010113',
    iban: 'MZ59000800002558873010113',
    holder: 'Adamgy Adamo / VMP SaaS',
    emailConfirm: 'freelancer.adamgy@gmail.com',
    whatsappConfirm: '846166104',
  },
};

// =========================================================
// INITIATE PAYMENT
// =========================================================
export async function initiatePayment(type, amount, client, plan) {
  const reference = `VMP-${type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const config = PAYMENT_CONFIG[type] || { message: 'Método não disponível' };

  const instructions = {
    ...config,
    reference,
    amount,
    client,
    plan,
    nextSteps: [
      '1. Efetue o pagamento com os dados acima',
      '2. Envie o comprovativo por:',
      `   • WhatsApp: ${config.whatsappConfirm || '846166104'}`,
      `   • Email: ${config.emailConfirm || 'freelancer.adamgy@gmail.com'}`,
      '3. A sua licença será ativada em até 24h após confirmação',
    ],
  };

  return {
    success: true,
    type,
    reference,
    amount,
    status: 'pending',
    instructions,
  };
}

// =========================================================
// VERIFY PAYMENT (manual — admin confirma no painel)
// =========================================================
export async function verifyPayment(reference) {
  // Mock: sempre aprova para demo
  // Em produção: admin confirma manualmente após receber comprovativo
  
  return {
    success: true,
    reference,
    status: 'pending_confirmation',
    message: 'Pagamento registado. Aguarda confirmação manual do administrador.',
    note: 'Envie o comprovativo por WhatsApp 846166104 ou email freelancer.adamgy@gmail.com',
    verifiedAt: new Date().toISOString(),
  };
}