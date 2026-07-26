const { z } = require("zod");
const ApiError = require("../utils/ApiError");

/* ==========================================================
 *  Menu & Category — Zod Validation Schema
 * ==========================================================
 *
 *  Validates payloads for creating and updating Categories
 *  and Menu Items. All schemas use .strict() to prevent
 *  field injection attacks (e.g. isDeleted).
 * ========================================================== */

/* ── Helpers ── */
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const emptyStringToNull = (val) => (val === "" || val === undefined ? null : val);

const optionalUrl = z.preprocess(
  emptyStringToNull,
  z.string().url("Must be a valid URL").nullable().optional()
);

const optionalString = z.preprocess(
  emptyStringToNull,
  z.string().nullable().optional()
);

const optionalBoolean = z.preprocess((val) => {
  if (val === undefined || val === null || val === "") return undefined;
  if (val === "true" || val === true) return true;
  if (val === "false" || val === false) return false;
  return val;
}, z.boolean().optional());

const refineStockRules = (data, ctx, { requireStockFields }) => {
  const stockEnabled = data.stockEnabled === true;
  if (!stockEnabled) return;

  if (!data.baseUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "baseUnit is required when stock is enabled",
      path: ["baseUnit"],
    });
  }

  const hasVariants = Array.isArray(data.variants) && data.variants.length > 0;

  if (hasVariants) {
    data.variants.forEach((variant, index) => {
      if (typeof variant.stockDeduct !== "number" || variant.stockDeduct <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each variant needs stockDeduct greater than 0 when stock is enabled",
          path: ["variants", index, "stockDeduct"],
        });
      }
    });
  } else if (requireStockFields || data.stockEnabled === true) {
    // Create always has variants array (possibly empty). Update may omit variants —
    // when enabling stock without variants in payload, stockDeduct on item is required
    // if variants are empty or absent (controller merges for update).
    if (data.variants !== undefined && !hasVariants) {
      if (typeof data.stockDeduct !== "number" || data.stockDeduct <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "stockDeduct greater than 0 is required when stock is enabled without variants",
          path: ["stockDeduct"],
        });
      }
    } else if (requireStockFields && !hasVariants) {
      if (typeof data.stockDeduct !== "number" || data.stockDeduct <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "stockDeduct greater than 0 is required when stock is enabled without variants",
          path: ["stockDeduct"],
        });
      }
    }
  }
};

/* ── Category Sub-Schemas ── */
const categoryBase = z.object({
  name: z
    .string({ required_error: "Category name is required" })
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name too long"),
  image: optionalUrl,
  imagePublicId: optionalString,
  displayOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  type: z.enum(["normal", "recommended", "special"]).default("normal"),
});

const createCategorySchema = categoryBase.strict();
const updateCategorySchema = categoryBase.partial().strict();

/* ── Menu Item Sub-Schemas ── */
const variantSchema = z.object({
  name: z.string().trim().min(1, "Variant name is required").max(100),
  price: z.number().min(0, "Price cannot be negative"),
  isDefault: z.boolean().default(false),
  stockDeduct: z.number().min(0, "Stock deduct cannot be negative").optional().nullable(),
});

const menuItemBase = z.object({
  category: z
    .string({ required_error: "Category ID is required" })
    .regex(objectIdRegex, "Invalid Category ID"),
  name: z
    .string({ required_error: "Menu item name is required" })
    .trim()
    .min(1, "Name cannot be empty")
    .max(200),
  description: z.string().max(2000, "Description too long (max 2000 chars)").optional().nullable(),
  price: z.number().min(0, "Price cannot be negative").optional().nullable(),
  variants: z.array(variantSchema).max(20, "Too many variants (max 20)").default([]),
  image: optionalUrl,
  imagePublicId: optionalString,
  isVeg: z.boolean({ required_error: "isVeg flag is required" }),
  isAvailable: z.boolean().default(true),
  displayOrder: z.number().int().min(0).default(0),
  stockEnabled: z.boolean().default(false),
  baseUnit: z
    .preprocess(
      emptyStringToNull,
      z.enum(["piece", "gram"]).nullable().optional()
    ),
  stockQty: z.number().min(0, "Stock qty cannot be negative").optional(),
  stockDeduct: z.number().min(0, "Stock deduct cannot be negative").optional().nullable(),
});

const createMenuItemSchema = menuItemBase
  .strict()
  .superRefine((data, ctx) => {
    const hasPrice = typeof data.price === "number";
    const hasVariants = data.variants && data.variants.length > 0;

    if (!hasPrice && !hasVariants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either a base price or at least one variant must be provided",
        path: ["price"],
      });
    }

    if (hasVariants) {
      const defaults = data.variants.filter((v) => v.isDefault);
      if (defaults.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Only one default variant allowed",
          path: ["variants"],
        });
      }
    }

    refineStockRules(data, ctx, { requireStockFields: true });
  })
  .transform((data) => {
    let next = data;
    if (data.variants && data.variants.length > 0) {
      next = { ...next, price: null, stockDeduct: null };
    } else if (typeof data.price === "number") {
      next = { ...next, variants: [] };
    }
    if (!next.stockEnabled) {
      next = {
        ...next,
        baseUnit: null,
        stockDeduct: null,
        stockQty: typeof next.stockQty === "number" ? next.stockQty : 0,
      };
    }
    return next;
  });

const updateMenuItemSchema = menuItemBase
  .partial()
  .strict()
  .superRefine((data, ctx) => {
    if (data.variants && data.variants.length > 0) {
      const defaults = data.variants.filter((v) => v.isDefault);
      if (defaults.length > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Only one default variant allowed",
          path: ["variants"],
        });
      }
    }

    if (data.stockEnabled === true) {
      refineStockRules(data, ctx, { requireStockFields: false });
    }
  })
  .transform((data) => {
    if (data.variants && data.variants.length > 0) {
      return { ...data, price: null, stockDeduct: null };
    }
    if (data.stockEnabled === false) {
      return { ...data, baseUnit: null, stockDeduct: null };
    }
    return data;
  });

const adjustStockSchema = z
  .object({
    qty: z
      .number({ required_error: "Quantity is required" })
      .positive("Quantity must be greater than 0"),
    unit: z.enum(["piece", "gram", "kg"]).optional(),
  })
  .strict();

/* ── List / query schemas ── */
const listMenuItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
  search: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().trim().max(200).optional()
  ),
  category: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.string().regex(objectIdRegex, "Invalid Category ID").optional()
  ),
  isVeg: optionalBoolean,
  isAvailable: optionalBoolean,
  archived: optionalBoolean,
  requireActiveCategory: optionalBoolean,
  sortBy: z
    .enum(["default", "name-asc", "name-desc", "price-low", "price-high", "newest"])
    .default("default"),
});

/* ── Middleware wrapper (reusable pattern) ── */
const validateQuery = (schema) => (req, _res, next) => {
  try {
    const result = schema.safeParse(req.query);

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

    req.validatedQuery = result.data;
    next();
  } catch (err) {
    return next(new ApiError("Invalid query parameters.", 400));
  }
};

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

    req.body = result.data;
    next();
  } catch (err) {
    return next(new ApiError("Invalid request data. Please check your input.", 400));
  }
};

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  listMenuItemsQuerySchema,
  adjustStockSchema,
  validate,
  validateQuery,
};
