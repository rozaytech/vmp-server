export function getPlan(plan) {
  const plans = {
    basic: {
      name: "Basic",
      days: 30,
      maxMachines: 1,
    },

    pro: {
      name: "Pro",
      days: 365,
      maxMachines: 3,
    },

    enterprise: {
      name: "Enterprise",
      days: 3650,
      maxMachines: 999,
    },
  };

  return plans[plan] || plans.basic;
}