export const PLANS = {
  basic: {
    code: "basic",
    name: "Basic",
    price: 3500, // MZN (Atualizado de 1500)
    days: 30,
    maxUsers: 10, // Atualizado de 2
    maxProducts: 500,
    features: [
      "pos",
      "inventory",
      "cash_register",
      "basic_reports",
      "z_report",
      "users", // ADIÇÃO: Gestão de Utilizadores
    ],
    description: "Ideal para pequenos negocios e bancas",
  },

  pro: {
    code: "pro",
    name: "Pro",
    price: 7000, // MZN (Atualizado de 3500)
    days: 30,
    maxUsers: 30, // Atualizado de 5
    maxProducts: 5000,
    features: [
      "pos",
      "inventory",
      "cash_register",
      "advanced_reports",
      "z_report",
      "promotions",
      "customers",
      "multi_warehouse",
      "analytics",
      "users", // ADIÇÃO: Gestão de Utilizadores
    ],
    description: "Para lojas em crescimento",
  },

  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    price: 12500, // MZN (Atualizado de 8500)
    days: 30, // Atualizado de 365
    maxUsers: 999,
    maxProducts: 99999,
    features: [
      "pos",
      "inventory",
      "cash_register",
      "advanced_reports",
      "z_report",
      "promotions",
      "customers",
      "multi_warehouse",
      "analytics",
      "accounting",
      "profit_margin",
      "remote_dashboard",
      "priority_support",
      "api_access",
      "users", // ADIÇÃO: Gestão de Utilizadores
    ],
    description: "Para cadeias e grandes estabelecimentos",
  },
};

export function getPlanFeatures(planCode) {
  return PLANS[planCode]?.features || [];
}

export function hasFeature(planCode, feature) {
  const features = getPlanFeatures(planCode);
  return features.includes(feature);
}

export function getPlanPrice(planCode) {
  return PLANS[planCode]?.price || 0;
}

export function getPlanDays(planCode) {
  return PLANS[planCode]?.days || 30;
}

export function listPlans() {
  return Object.values(PLANS);
}