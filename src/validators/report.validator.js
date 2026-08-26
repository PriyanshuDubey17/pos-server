const { z } = require("zod");
const ApiError = require("../utils/ApiError");

const optionalQueryNumber = (schema) =>
  z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    schema.optional(),
  );

const reportSummaryQuerySchema = z
  .object({
    period: z.enum(["today", "month"]).default("today"),
    year: optionalQueryNumber(z.coerce.number().int().min(2020).max(2100)),
    month: optionalQueryNumber(z.coerce.number().int().min(1).max(12)),
  })
  .superRefine((query, ctx) => {
    if (query.period !== "month") return;
    const hasYear = query.year != null;
    const hasMonth = query.month != null;
    if (hasYear !== hasMonth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "year and month must be sent together.",
      });
    }
  });

const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    const message =
      result.error.issues?.[0]?.message || "Invalid query parameters";
    return next(new ApiError(message, 400));
  }
  req.query = result.data;
  next();
};

module.exports = {
  reportSummaryQuerySchema,
  validateQuery,
};
