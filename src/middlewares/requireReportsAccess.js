const ApiError = require("../utils/ApiError");
const { restaurantHasModule } = require("../constants/accessPlans");

/**
 * Block reports routes when Restaurant.accessPlan does not include reports.
 * Requires protectAdmin (req.restaurant set for restaurant_admin).
 */
const requireReportsAccess = (req, _res, next) => {
  const accessPlan = req.restaurant?.accessPlan;
  if (!accessPlan || !restaurantHasModule(accessPlan, "reports")) {
    return next(
      new ApiError("Your plan does not allow reports access.", 403),
    );
  }
  next();
};

module.exports = { requireReportsAccess };
