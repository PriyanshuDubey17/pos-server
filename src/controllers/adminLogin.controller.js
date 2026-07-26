const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Otp = require("../models/Otp");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { sendSMS } = require("../utils/sms/sms.service");
const { USER_ROLES } = require("../constants/accessPlans");
const {
  buildAdminAuthPayload,
  assertRestaurantAdminCanAccess,
} = require("../utils/buildAdminAuthPayload");
const {
  ADMIN_ACCESS_TOKEN,
  ADMIN_REFRESH_TOKEN,
  getCookieBaseOptions,
  getAdminAccessCookieOptions,
  getAdminRefreshCookieOptions,
} = require("../config/authCookies");

/* ==========================================================
 *  Admin Login Controller
 * ==========================================================
 *
 *  OTP login for super_admin and restaurant_admin.
 * ========================================================== */

const isPanelUserRole = (role) => USER_ROLES.includes(role);

/* ─────────────────────────────────────────────────────────
   🔧 HELPER FUNCTIONS
   ───────────────────────────────────────────────────────── */

/** Generate a cryptographically random 6-digit OTP */
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/** Hash OTP with bcrypt (10 salt rounds) */
const hashOtp = async (otp) => {
  return bcrypt.hash(otp, 10);
};

/** Compare plain OTP with hashed OTP */
const compareOtp = async (plainOtp, hashedOtp) => {
  return bcrypt.compare(plainOtp, hashedOtp);
};

/** Generate JWT access token — short-lived (15 min) */
const generateAccessToken = (user) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );
};

/** Generate JWT refresh token — long-lived (7 days) */
const generateRefreshToken = (user) => {
  return jwt.sign(
    { _id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" },
  );
};

/** Set both admin tokens as httpOnly cookies */
const setTokenCookies = (res, accessToken, refreshToken) => {
  res.cookie(ADMIN_ACCESS_TOKEN, accessToken, getAdminAccessCookieOptions());
  res.cookie(ADMIN_REFRESH_TOKEN, refreshToken, getAdminRefreshCookieOptions());
};

/** Clear admin token cookies */
const clearTokenCookies = (res) => {
  const cookieOptions = getCookieBaseOptions();

  res.clearCookie(ADMIN_ACCESS_TOKEN, cookieOptions);
  res.clearCookie(ADMIN_REFRESH_TOKEN, cookieOptions);
};

/* ─────────────────────────────────────────────────────────
   📤 SEND OTP
   ─────────────────────────────────────────────────────────
   POST /api/admin-login/send-otp
   Body: { phone: "6204239578" }

   Steps:
   1. Find account by phone
   2. Check role = super_admin | restaurant_admin
   3. Check status = "active"
   4. Cooldown check (60s since last OTP)
   5. Delete old OTP → create new one → send SMS
   ───────────────────────────────────────────────────────── */

const sendOtp = async (req, res, next) => {
  try {
    const { phone } = req.body;

    // Step 1: Find account by phone number
    const user = await User.findOne({ mobile: phone });

    if (!user) {
      return next(new ApiError("Account not found", 404));
    }

    // Step 2: Panel roles only
    if (!isPanelUserRole(user.role)) {
      return next(new ApiError("Not authorized. Admin access only.", 403));
    }

    // Step 3: Check status — blocked/inactive admin cannot login
    if (user.status !== "active") {
      return next(
        new ApiError("Account is blocked or inactive. Contact support.", 403),
      );
    }

    // Step 3b: restaurant_admin — restaurant must be active
    await assertRestaurantAdminCanAccess(user);

    // Step 4: Cooldown — prevent OTP flooding (60 seconds)
    const existingOtp = await Otp.findOne({
      userId: user._id,
      purpose: "login",
    });

    if (existingOtp) {
      const secondsSinceCreated =
        (Date.now() - new Date(existingOtp.createdAt).getTime()) / 1000;

      if (secondsSinceCreated < 60) {
        const waitSeconds = Math.ceil(60 - secondsSinceCreated);
        return next(
          new ApiError(
            `Please wait ${waitSeconds} seconds before requesting a new OTP.`,
            429,
          ),
        );
      }

      // Cooldown passed — delete old OTP
      await Otp.deleteOne({ _id: existingOtp._id });
    }

    // Step 5: Generate OTP → hash → save → send SMS
    const plainOtp = generateOtp();
    const hashedOtp = await hashOtp(plainOtp);

    await Otp.create({
      userId: user._id,
      phone,
      otp: hashedOtp,
      purpose: "login",
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
    });

    // Send SMS (dev mode: also console.log)
    if (process.env.NODE_ENV === "development") {
      console.log(`\n🔑 [DEV] OTP for ${phone}: ${plainOtp}\n`);
    }

    try {
      await sendSMS({
        to: phone,
        otp: plainOtp,
        message: `Your restaurant admin login OTP is: ${plainOtp}. Valid for 10 minutes.`,
        templateName: "OTPNew",
      });
    } catch (smsError) {
      // In development, don't fail if SMS provider is not configured
      if (process.env.NODE_ENV !== "development") {
        return next(new ApiError("Failed to send OTP. Try again later.", 502));
      }
      console.warn("⚠️  SMS send failed (dev mode, proceeding):", smsError.message);
    }

    const response = new ApiResponse(200, "OTP sent successfully");
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────
   ✅ VERIFY OTP
   ─────────────────────────────────────────────────────────
   POST /api/admin-login/verify-otp
   Body: { phone: "6204239578", otp: "123456" }

   Steps:
   1. Find admin account by phone
   2. Find OTP doc (userId + purpose: "login")
   3. Check expiry
   4. Check attempts < 3
   5. bcrypt compare
   6. Match → tokens → cookies → delete OTP → return user
   ───────────────────────────────────────────────────────── */

const verifyOtp = async (req, res, next) => {
  try {
    const { phone, otp } = req.body;

    // Step 1: Find admin account
    const user = await User.findOne({ mobile: phone });

    if (!user) {
      return next(new ApiError("Account not found", 404));
    }

    if (!isPanelUserRole(user.role)) {
      return next(new ApiError("Not authorized. Admin access only.", 403));
    }

    if (user.status !== "active") {
      return next(
        new ApiError("Account is blocked or inactive. Contact support.", 403),
      );
    }

    // restaurant_admin — restaurant must be active before OTP consume
    await assertRestaurantAdminCanAccess(user);

    // Step 2: Find OTP document
    const otpDoc = await Otp.findOne({
      userId: user._id,
      purpose: "login",
    });

    if (!otpDoc) {
      return next(
        new ApiError("No OTP found. Please request a new one.", 400),
      );
    }

    // Step 3: Check expiry (double check — TTL might not have cleaned up yet)
    if (new Date() > new Date(otpDoc.expiresAt)) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return next(
        new ApiError("OTP has expired. Please request a new one.", 410),
      );
    }

    // Step 4: Check max attempts (3)
    if (otpDoc.attempts >= 3) {
      await Otp.deleteOne({ _id: otpDoc._id });
      return next(
        new ApiError(
          "Too many wrong attempts. OTP invalidated. Request a new one.",
          429,
        ),
      );
    }

    // Step 5: Compare OTP
    const isMatch = await compareOtp(otp, otpDoc.otp);

    if (!isMatch) {
      // Increment attempts atomically
      const updatedOtpDoc = await Otp.findOneAndUpdate(
        { _id: otpDoc._id },
        { $inc: { attempts: 1 } },
        { returnDocument: "after" }
      );

      // In case the document was already deleted somehow
      if (!updatedOtpDoc) {
        return next(new ApiError("OTP session expired. Request a new OTP.", 401));
      }

      const remaining = 3 - updatedOtpDoc.attempts;

      if (remaining <= 0) {
        await Otp.deleteOne({ _id: otpDoc._id });
        return next(
          new ApiError(
            "Invalid OTP. All attempts used. Request a new OTP.",
            401,
          ),
        );
      }

      return next(
        new ApiError(
          `Invalid OTP. ${remaining} attempt${remaining > 1 ? "s" : ""} remaining.`,
          401,
        ),
      );
    }

    // Step 6: ✅ OTP matched — build auth payload, then issue tokens
    const authPayload = await buildAdminAuthPayload(user);

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set httpOnly cookies
    setTokenCookies(res, accessToken, refreshToken);

    // Update lastLoginAt (avoid full-doc validate on legacy fields)
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    // 🗑️ Delete OTP doc — prevent replay attack
    await Otp.deleteOne({ _id: otpDoc._id });

    const response = new ApiResponse(200, "Login successful", authPayload);
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────
   🔄 REFRESH TOKEN
   ─────────────────────────────────────────────────────────
   POST /api/admin-login/refresh

   Reads refreshToken from httpOnly cookie → verifies →
   issues new accessToken → sets new cookie.
   ───────────────────────────────────────────────────────── */

const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.[ADMIN_REFRESH_TOKEN];

    if (!token) {
      return next(new ApiError("Refresh token missing. Please login.", 401));
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      clearTokenCookies(res);
      if (err.name === "TokenExpiredError") {
        return next(new ApiError("Session expired. Please login again.", 401));
      }
      return next(new ApiError("Invalid refresh token. Please login.", 401));
    }

    // Find user — ensure still active and admin
    const user = await User.findById(decoded._id);

    if (!user) {
      clearTokenCookies(res);
      return next(new ApiError("User not found. Please login again.", 401));
    }

    if (!isPanelUserRole(user.role)) {
      clearTokenCookies(res);
      return next(new ApiError("Not authorized. Admin access only.", 403));
    }

    if (user.status !== "active") {
      clearTokenCookies(res);
      return next(new ApiError("Account is blocked or inactive.", 403));
    }

    let authPayload;
    try {
      authPayload = await buildAdminAuthPayload(user);
    } catch (err) {
      clearTokenCookies(res);
      return next(err);
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    // Set only admin access cookie (refresh stays as-is)
    res.cookie(ADMIN_ACCESS_TOKEN, newAccessToken, getAdminAccessCookieOptions());

    const response = new ApiResponse(
      200,
      "Token refreshed successfully",
      authPayload,
    );
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────
   🚪 LOGOUT
   ─────────────────────────────────────────────────────────
   POST /api/admin-login/logout

   Clears both accessToken and refreshToken cookies.
   ───────────────────────────────────────────────────────── */

const logout = async (_req, res, next) => {
  try {
    clearTokenCookies(res);

    const response = new ApiResponse(200, "Logged out successfully");
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

module.exports = { sendOtp, verifyOtp, refreshToken, logout };
