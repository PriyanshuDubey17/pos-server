const ApiError = require("../utils/ApiError");
const { restaurantHasModule } = require("../constants/accessPlans");

/**
 * Block sales/POS routes when Restaurant.accessPlan does not include pos.
 * Requires protectAdmin (req.restaurant set for restaurant_admin).
 */
const requirePosAccess = (req, _res, next) => {
  const accessPlan = req.restaurant?.accessPlan;
  if (!accessPlan || !restaurantHasModule(accessPlan, "pos")) {
    return next(new ApiError("Your plan does not allow POS access.", 403));
  }
  next();
};

module.exports = { requirePosAccess };
