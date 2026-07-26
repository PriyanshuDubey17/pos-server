const { z } = require("zod");
const ApiError = require("../utils/ApiError");

/* ==========================================================
 *  Admin Login — Zod Validation Schemas
 * ==========================================================
 *
 *  sendOtpSchema  → phone (10 digit Indian mobile)
 *  verifyOtpSchema → phone + otp (6 digits)
 *
 *  validate(schema) is a reusable middleware wrapper that
 *  parses req.body and throws ApiError on failure.
 * ========================================================== */

/* ── Schemas ── */

const sendOtpSchema = z.object({
  phone: z
    .string({ required_error: "Phone number is required" })
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
});

const verifyOtpSchema = z.object({
  phone: z
    .string({ required_error: "Phone number is required" })
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),

  otp: z
    .string({ required_error: "OTP is required" })
    .trim()
    .regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
});

/* ── Middleware wrapper ── */
const validate = (schema) => (req, _res, next) => {
  try {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const zodErrors = result.error?.issues || result.error?.errors || [];
      const errors = zodErrors.map((e) => ({
        field: (e.path || []).join(".") || "unknown",
        message: e.message || "Invalid value",
      }));

      const summary = errors.length > 0
        ? errors.map((e) => e.field !== "unknown" ? `${e.field}: ${e.message}` : e.message).join("; ")
        : "Validation failed";

      return next(new ApiError(summary, 400, errors));
    }

    req.body = result.data; // sanitized data
    next();
  } catch (err) {
    return next(new ApiError("Invalid request data. Please check your input.", 400));
  }
};

module.exports = { sendOtpSchema, verifyOtpSchema, validate };
