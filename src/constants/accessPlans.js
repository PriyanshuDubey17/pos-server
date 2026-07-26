/**
 * Single restaurant access plan: full (all modules).
 * accessPlan stays on Restaurant docs; only value allowed is "full".
 */

const USER_ROLES = Object.freeze(["super_admin", "restaurant_admin"]);

const ACCESS_PLANS = Object.freeze(["full"]);

const MODULES = Object.freeze([
  "menu",
  "pos",
  "stock",
  "reports",
  "settings",
  "print",
]);

/** Modules allowed per Restaurant.accessPlan */
const PLAN_MODULES = Object.freeze({
  full: Object.freeze([
    "menu",
    "pos",
    "stock",
    "reports",
    "settings",
    "print",
  ]),
});

const PLAN_MENU_READ = Object.freeze({
  full: true,
});

const PLAN_MENU_WRITE = Object.freeze({
  full: true,
});

function isValidUserRole(role) {
  return USER_ROLES.includes(role);
}

function isValidAccessPlan(plan) {
  return ACCESS_PLANS.includes(plan);
}

function getModulesForAccessPlan(accessPlan) {
  return PLAN_MODULES[accessPlan] || [];
}

function restaurantHasModule(accessPlan, moduleName) {
  return getModulesForAccessPlan(accessPlan).includes(moduleName);
}

module.exports = {
  USER_ROLES,
  ACCESS_PLANS,
  MODULES,
  PLAN_MODULES,
  PLAN_MENU_READ,
  PLAN_MENU_WRITE,
  isValidUserRole,
  isValidAccessPlan,
  getModulesForAccessPlan,
  restaurantHasModule,
};
