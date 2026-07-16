export const PLANS = {
  basic: {
    code: "basic",
    name: "Basic",
    price: 1500, // MZN
    days: 30,
    maxUsers: 2,
    maxProducts: 500,
    features: [
      "pos",
      "inventory",
      "cash_register",
      "basic_reports",
      "z_report",
    ],
    description: "Ideal para pequenos negocios e bancas",
  },

  pro: {
    code: "pro",
    name: "Pro",
    price: 3500, // MZN
    days: 30,
    maxUsers: 5,
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
    ],
    description: "Para lojas em crescimento",
  },

  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    price: 8500, // MZN
    days: 365,
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