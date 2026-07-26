const express = require("express");
const router = express.Router();

const {
  sendOtp,
  verifyOtp,
  refreshToken,
  logout,
} = require("../controllers/adminLogin.controller");

const {
  sendOtpSchema,
  verifyOtpSchema,
  validate,
} = require("../validators/adminLogin.validator");

const {
  otpSendLimiter,
  otpVerifyLimiter,
} = require("../middlewares/rateLimiter");

/* ==========================================================
 *  Admin Login Routes
 * ==========================================================
 *
 *  POST /api/admin-login/send-otp     → rate limit + validate → sendOtp
 *  POST /api/admin-login/verify-otp   → rate limit + validate → verifyOtp
 *  POST /api/admin-login/refresh      → refreshToken
 *  POST /api/admin-login/logout       → logout
 *
 *  These routes are EXCLUSIVELY for admin role login.
 * ========================================================== */

router.post(
  "/send-otp",
  otpSendLimiter,
  validate(sendOtpSchema),
  sendOtp,
);

router.post(
  "/verify-otp",
  otpVerifyLimiter,
  validate(verifyOtpSchema),
  verifyOtp,
);

router.post("/refresh", refreshToken);

router.post("/logout", logout);

module.exports = router;
