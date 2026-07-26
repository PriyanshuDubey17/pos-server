const ApiError = require("../utils/ApiError");
const { PLAN_MENU_WRITE } = require("../constants/accessPlans");

/**
 * Block menu mutations when Restaurant.accessPlan does not allow writes.
 * Requires protectAdmin (req.restaurant set for restaurant_admin).
 */
const requireMenuWrite = (req, _res, next) => {
  const accessPlan = req.restaurant?.accessPlan;
  if (!accessPlan || !PLAN_MENU_WRITE[accessPlan]) {
    return next(
      new ApiError("Your plan does not allow menu edits.", 403),
    );
  }
  next();
};

module.exports = { requireMenuWrite };
