const { z } = require("zod");
const ApiError = require("../utils/ApiError");
const { ACCESS_PLANS } = require("../constants/accessPlans");

/* ==========================================================
 *  Restaurant — Zod Validation Schemas (super_admin)
 * ========================================================== */

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const emptyStringToUndefined = (val) =>
  val === "" || val === null || val === undefined ? undefined : val;

/** Empty / null → null (explicit clear on update) */
const emptyToNull = (val) => {
  if (val === "" || val === null || val === undefined) return null;
  return val;
};

const mobileSchema = z
  .string({ required_error: "Mobile number is required" })
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");

const optionalEmailSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().email("Enter a valid email").optional(),
);

const optionalPhoneSchema = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit phone number")
    .optional(),
);

/** For PATCH — omit | valid value | null (clear) */
const clearablePhoneSchema = z.preprocess(
  emptyToNull,
  z
    .union([
      z.null(),
      z
        .string()
        .trim()
        .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit phone number"),
    ])
    .optional(),
);

const clearableEmailSchema = z.preprocess(
  emptyToNull,
  z
    .union([z.null(), z.string().trim().email("Enter a valid email")])
    .optional(),
);

const ownerSchema = z
  .object({
    name: z
      .string({ required_error: "Owner name is required" })
      .trim()
      .min(1, "Owner name cannot be empty")
      .max(100, "Owner name too long"),
    mobile: mobileSchema,
    email: optionalEmailSchema,
  })
  .strict();

const createRestaurantSchema = z
  .object({
    name: z
      .string({ required_error: "Restaurant name is required" })
      .trim()
      .min(1, "Restaurant name cannot be empty")
      .max(150, "Restaurant name too long"),
    accessPlan: z.enum(ACCESS_PLANS).default("full"),
    status: z.enum(["pending", "active", "suspended"]).default("active"),
    allowTwoReceiptCopies: z.boolean().optional(),
    phone: clearablePhoneSchema,
    email: clearableEmailSchema,
    owner: ownerSchema
      .extend({
        email: clearableEmailSchema,
      })
      .strict(),
  })
  .strict();

const updateRestaurantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Restaurant name cannot be empty")
      .max(150, "Restaurant name too long")
      .optional(),
    accessPlan: z.enum(ACCESS_PLANS).optional(),
    status: z.enum(["pending", "active", "suspended"]).optional(),
    allowTwoReceiptCopies: z.boolean().optional(),
    phone: clearablePhoneSchema,
    email: clearableEmailSchema,
    owner: z
      .object({
        name: z
          .string({ required_error: "Owner name is required" })
          .trim()
          .min(1, "Owner name cannot be empty")
          .max(100, "Owner name too long"),
        mobile: mobileSchema,
        email: clearableEmailSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required to update",
  });

const listRestaurantsQuerySchema = z.object({
  status: z.enum(["pending", "active", "suspended"]).optional(),
  accessPlan: z.enum(ACCESS_PLANS).optional(),
  search: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().max(100).optional(),
  ),
});

const restaurantIdParamSchema = z.object({
  restaurantId: z
    .string({ required_error: "Restaurant ID is required" })
    .regex(objectIdRegex, "Invalid Restaurant ID"),
});

const validate = (schema) => (req, _res, next) => {
  try {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const zodErrors = result.error?.issues || result.error?.errors || [];
      const errors = zodErrors.map((e) => ({
        field: (e.path || []).join(".") || "unknown",
        message: e.message || "Invalid value",
      }));

      const summary =
        errors.length > 0
          ? errors
              .map((e) =>
                e.field !== "unknown" ? `${e.field}: ${e.message}` : e.message,
              )
              .join("; ")
          : "Validation failed";

      return next(new ApiError(summary, 400, errors));
    }

    req.body = result.data;
    next();
  } catch (_err) {
    return next(
      new ApiError("Invalid request data. Please check your input.", 400),
    );
  }
};

const validateQuery = (schema) => (req, _res, next) => {
  try {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const zodErrors = result.error?.issues || result.error?.errors || [];
      const errors = zodErrors.map((e) => ({
        field: (e.path || []).join(".") || "unknown",
        message: e.message || "Invalid value",
      }));

      const summary =
        errors.length > 0
          ? errors
              .map((e) =>
                e.field !== "unknown" ? `${e.field}: ${e.message}` : e.message,
              )
              .join("; ")
          : "Validation failed";

      return next(new ApiError(summary, 400, errors));
    }

    req.validatedQuery = result.data;
    next();
  } catch (_err) {
    return next(new ApiError("Invalid query parameters.", 400));
  }
};

const validateRestaurantIdParam = (req, _res, next) => {
  try {
    const result = restaurantIdParamSchema.safeParse(req.params);

    if (!result.success) {
      const zodErrors = result.error?.issues || result.error?.errors || [];
      const errors = zodErrors.map((e) => ({
        field: (e.path || []).join(".") || "unknown",
        message: e.message || "Invalid value",
      }));

      return next(
        new ApiError(errors[0]?.message || "Invalid Restaurant ID", 400, errors),
      );
    }

    req.params.restaurantId = result.data.restaurantId;
    next();
  } catch (_err) {
    return next(new ApiError("Invalid Restaurant ID.", 400));
  }
};

module.exports = {
  createRestaurantSchema,
  updateRestaurantSchema,
  listRestaurantsQuerySchema,
  validate,
  validateQuery,
  validateRestaurantIdParam,
};
