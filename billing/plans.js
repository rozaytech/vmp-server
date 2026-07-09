export const PLANS = {
  free: {
    name: "Free",
    price: 0,
    days: 7,
    features: ["basic_license"]
  },

  pro: {
    name: "Pro",
    price: 29,
    days: 30,
    features: ["license", "updates", "support"]
  },

  enterprise: {
    name: "Enterprise",
    price: 99,
    days: 365,
    features: ["all", "priority_support", "multi_device"]
  }
};