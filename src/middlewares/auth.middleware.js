const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { ADMIN_ACCESS_TOKEN } = require("../config/authCookies");
const {
  assertRestaurantAdminCanAccess,
} = require("../utils/buildAdminAuthPayload");

/* ==========================================================
 *  Auth Middlewares
 * ==========================================================
 *
 *  protectAdmin    → Verify adminAccessToken cookie → attach req.user
 *                    (+ req.restaurant for restaurant_admin)
 *  authorizeRole   → Check req.user.role against allowed roles
 * ========================================================== */

const verifyAccessToken = async (req, tokenCookieName) => {
  const token = req.cookies?.[tokenCookieName];

  if (!token) {
    throw new ApiError("Access denied. Please login.", 401);
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded._id).select("-__v");

  if (!user) {
    throw new ApiError("User not found. Please login again.", 401);
  }

  if (user.status !== "active") {
    throw new ApiError("Account is blocked or inactive.", 403);
  }

  return user;
};

const createProtectMiddleware = (tokenCookieName) => async (req, _res, next) => {
  try {
    const user = await verifyAccessToken(req, tokenCookieName);
    req.user = user;

    if (user.role === "restaurant_admin") {
      req.restaurant = await assertRestaurantAdminCanAccess(user);
    } else {
      req.restaurant = null;
    }

    next();
  } catch (err) {
    if (err instanceof ApiError) {
      return next(err);
    }
    if (err.name === "TokenExpiredError") {
      return next(new ApiError("Session expired. Please login again.", 401));
    }
    if (err.name === "JsonWebTokenError") {
      return next(new ApiError("Invalid token. Please login again.", 401));
    }
    next(err);
  }
};

const protectAdmin = createProtectMiddleware(ADMIN_ACCESS_TOKEN);

/* ── Authorize Role — role-based access control ── */

const authorizeRole = (...allowedRoles) => {
  return (req, _res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(
        new ApiError("You do not have permission to access this resource.", 403),
      );
    }
    next();
  };
};

module.exports = { protectAdmin, authorizeRole };
