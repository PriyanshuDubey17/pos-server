const ApiError = require("../utils/ApiError");
const { restaurantHasModule } = require("../constants/accessPlans");

/**
 * Block stock routes when Restaurant.accessPlan does not include stock.
 * Requires protectAdmin (req.restaurant set for restaurant_admin).
 */
const requireStockAccess = (req, _res, next) => {
  const accessPlan = req.restaurant?.accessPlan;
  if (!accessPlan || !restaurantHasModule(accessPlan, "stock")) {
    return next(new ApiError("Your plan does not allow stock access.", 403));
  }
  next();
};

module.exports = { requireStockAccess };
