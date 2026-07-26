const Restaurant = require("../models/Restaurant");
const ApiError = require("./ApiError");

const RESTAURANT_INACTIVE_MESSAGE =
  "Restaurant is not active. Contact platform support.";

/**
 * Load restaurant for restaurant_admin and ensure it is active.
 * Returns null for super_admin.
 */
const assertRestaurantAdminCanAccess = async (user) => {
  if (user.role !== "restaurant_admin") {
    return null;
  }

  if (!user.restaurantId) {
    throw new ApiError(
      "Restaurant account is not linked. Contact support.",
      403,
    );
  }

  const restaurant = await Restaurant.findById(user.restaurantId).select(
    "_id name accessPlan status",
  );

  if (!restaurant) {
    throw new ApiError("Restaurant not found. Contact support.", 403);
  }

  if (restaurant.status !== "active") {
    throw new ApiError(RESTAURANT_INACTIVE_MESSAGE, 403);
  }

  return restaurant;
};

const formatUserForAuth = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  mobile: user.mobile,
  role: user.role,
  restaurantId: user.restaurantId || null,
  profilePic: user.profilePic,
  status: user.status,
});

const formatRestaurantForAuth = (restaurant) => {
  if (!restaurant) return null;
  return {
    _id: restaurant._id,
    name: restaurant.name,
    accessPlan: restaurant.accessPlan,
    status: restaurant.status,
  };
};

/**
 * Build login/refresh payload: user + restaurant context.
 * Throws ApiError(403) when restaurant_admin restaurant is missing/inactive.
 */
const buildAdminAuthPayload = async (user) => {
  if (user.role === "super_admin") {
    return {
      user: formatUserForAuth(user),
      restaurant: null,
    };
  }

  const restaurant = await assertRestaurantAdminCanAccess(user);
  return {
    user: formatUserForAuth(user),
    restaurant: formatRestaurantForAuth(restaurant),
  };
};

module.exports = {
  buildAdminAuthPayload,
  assertRestaurantAdminCanAccess,
  formatRestaurantForAuth,
  RESTAURANT_INACTIVE_MESSAGE,
};
