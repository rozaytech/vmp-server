export const PLANS = {
  basic: {
    code: "basic",
    name: "Basic",
    price: 1350, // MZN (Reduzido drasticamente para captar mercado)
    days: 30,
    maxUsers: 10,
    maxProducts: 500,
    features: [
      "pos",
      "inventory",
      "cash_register",
      "basic_reports",
      "z_report",
      "users",
    ],
    description: "Ideal para pequenos negocios e bancas",
  },

  pro: {
    code: "pro",
    name: "Pro",
    price: 2700, // MZN
    days: 30,
    maxUsers: 30,
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
      "users",
    ],
    description: "Para lojas em crescimento",
  },

  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    price: 4900, // MZN
    days: 30,
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
      "users",
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