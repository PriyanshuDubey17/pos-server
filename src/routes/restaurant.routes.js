const express = require("express");
const router = express.Router();

const {
  createRestaurant,
  listRestaurants,
  getRestaurantStats,
  getRestaurantById,
  updateRestaurant,
} = require("../controllers/restaurant.controller");

const {
  createRestaurantSchema,
  updateRestaurantSchema,
  listRestaurantsQuerySchema,
  validate,
  validateQuery,
  validateRestaurantIdParam,
} = require("../validators/restaurant.validator");

const { authGeneralLimiter } = require("../middlewares/rateLimiter");

/* ==========================================================
 *  Restaurant Routes — super_admin only (mounted in app.js)
 *
 *  POST   /api/restaurants
 *  GET    /api/restaurants
 *  GET    /api/restaurants/stats
 *  GET    /api/restaurants/:restaurantId
 *  PATCH  /api/restaurants/:restaurantId
 * ========================================================== */

router
  .route("/")
  .get(validateQuery(listRestaurantsQuerySchema), listRestaurants)
  .post(
    authGeneralLimiter,
    validate(createRestaurantSchema),
    createRestaurant,
  );

router.get("/stats", getRestaurantStats);

router
  .route("/:restaurantId")
  .get(validateRestaurantIdParam, getRestaurantById)
  .patch(
    authGeneralLimiter,
    validateRestaurantIdParam,
    validate(updateRestaurantSchema),
    updateRestaurant,
  );

module.exports = router;
