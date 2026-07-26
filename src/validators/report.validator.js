const { z } = require("zod");
const ApiError = require("../utils/ApiError");

const reportSummaryQuerySchema = z.object({
  period: z.enum(["today", "month"]).default("today"),
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
