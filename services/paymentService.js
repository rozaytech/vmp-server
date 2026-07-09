import { v4 as uuidv4 } from 'uuid';
import { initDB } from '../db.js';

// =========================================================
// INITIATE PAYMENT
// =========================================================
export async function initiatePayment(type, amount, client, plan) {
  const reference = `VMP-${type.toUpperCase()}-${Date.now()}`;

  const instructions = {
    emola: {
      message: 'Envie o valor para o número 9xx xxx xxx via eMola e indique a referência abaixo.',
      reference,
      phone: '9xx xxx xxx',
      amount,
    },
    mpesa: {
      message: 'Envie o valor para o número 8xx xxx xxx via M-Pesa e indique a referência abaixo.',
      reference,
      phone: '8xx xxx xxx',
      amount,
    },
    visa: {
      message: 'Redirecionamento para pagamento seguro via Stripe (modo demo).',
      reference,
      stripeUrl: `https://checkout.stripe.com/mock/${reference}`,
      amount,
    },
    transfer: {
      message: 'Efetue transferência bancária para a conta abaixo.',
      reference,
      bankAccount: 'AO06 0040 0000 1234 5678 9012 3',
      holder: 'VMP SaaS Lda',
      bank: 'BFA / BPC',
      amount,
    },
  };

  return {
    success: true,
    type,
    reference,
    amount,
    status: 'pending',
    instructions: instructions[type] || { message: 'Método de pagamento não reconhecido' },
  };
}

// =========================================================
// VERIFY PAYMENT
// =========================================================
export async function verifyPayment(reference) {
  const db = await initDB();

  const payment = await db.get(
    `
    SELECT *
    FROM payments
    WHERE reference = ?
    `,
    [reference]
  );

  if (payment) {
    await db.run(
      `
      UPDATE payments
      SET status = 'completed'
      WHERE reference = ?
      `,
      [reference]
    );

    await db.run(
      `
      UPDATE subscriptions
      SET payment_status = 'paid', status = 'active'
      WHERE id = ?
      `,
      [payment.subscription_id]
    );
  }

  return {
    success: true,
    reference,
    status: 'completed',
    verifiedAt: new Date().toISOString(),
    message: 'Pagamento confirmado (modo demo). Em produção, integrar API real.',
  };
}