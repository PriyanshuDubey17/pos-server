const { z } = require("zod");
const ApiError = require("../utils/ApiError");

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const emptyStringToUndefined = (val) =>
  val === "" || val === undefined || val === null ? undefined : val;

const confirmSaleSchema = z
  .object({
    paymentMethod: z.enum(["Cash", "UPI"], {
      errorMap: () => ({ message: "Payment method must be Cash or UPI" }),
    }),
    items: z
      .array(
        z
          .object({
            menuItemId: z
              .string({ required_error: "Menu item is required" })
              .regex(objectIdRegex, "Invalid Menu Item ID"),
            qty: z
              .number({
                required_error: "Quantity is required",
                invalid_type_error: "Quantity must be a number",
              })
              .int("Quantity must be a whole number")
              .min(1, "Quantity must be at least 1"),
            variantName: z.preprocess(
              emptyStringToUndefined,
              z.string().trim().min(1).max(100).optional(),
            ),
          })
          .strict(),
      )
      .min(1, "Cart must have at least one item")
      .max(100, "Too many cart lines"),
  })
  .strict();

const updateReceiptCopiesSchema = z
  .object({
    receiptCopies: z.union([z.literal(1), z.literal(2)], {
      errorMap: () => ({ message: "Receipt copies must be 1 or 2" }),
    }),
  })
  .strict();

const updatePrinterSettingsSchema = z
  .object({
    paperWidth: z
      .enum(["58", "80"], {
        errorMap: () => ({ message: "Paper width must be 58 or 80" }),
      })
      .optional(),
    autoPrintOnConfirm: z.boolean().optional(),
    receiptCopies: z
      .union([z.literal(1), z.literal(2)], {
        errorMap: () => ({ message: "Receipt copies must be 1 or 2" }),
      })
      .optional(),
    deviceLabel: z
      .preprocess(
        (val) => (val === "" ? null : val),
        z.string().trim().max(120).nullable().optional(),
      ),
    isPaired: z.boolean().optional(),
    tokenLabel: z
      .enum(["Token", "Bill", "Order"], {
        errorMap: () => ({
          message: "Receipt number label must be Token, Bill, or Order",
        }),
      })
      .optional(),
    printLargeToken: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.paperWidth !== undefined ||
      body.autoPrintOnConfirm !== undefined ||
      body.receiptCopies !== undefined ||
      body.deviceLabel !== undefined ||
      body.isPaired !== undefined ||
      body.tokenLabel !== undefined ||
      body.printLargeToken !== undefined,
    { message: "At least one printer setting is required" },
  );

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

const listSalesQuerySchema = z.object({
  date: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .regex(ymdRegex, "date must be YYYY-MM-DD")
      .optional(),
  ),
  page: z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === "") return 1;
      const n = Number(val);
      return Number.isFinite(n) ? n : val;
    },
    z.number().int().min(1).default(1),
  ),
  limit: z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === "") return 20;
      const n = Number(val);
      return Number.isFinite(n) ? n : val;
    },
    z.number().int().min(1).max(100).default(20),
  ),
});

const saleIdParamSchema = z.object({
  id: z.string().regex(objectIdRegex, "Invalid sale id"),
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
  } catch {
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

    req.query = result.data;
    next();
  } catch {
    return next(new ApiError("Invalid query parameters.", 400));
  }
};

const validateParams = (schema) => (req, _res, next) => {
  try {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const message =
        result.error.issues?.[0]?.message || "Invalid path parameters";
      return next(new ApiError(message, 400));
    }
    req.params = { ...req.params, ...result.data };
    next();
  } catch {
    return next(new ApiError("Invalid path parameters.", 400));
  }
};

module.exports = {
  confirmSaleSchema,
  updateReceiptCopiesSchema,
  updatePrinterSettingsSchema,
  listSalesQuerySchema,
  saleIdParamSchema,
  validate,
  validateQuery,
  validateParams,
};
