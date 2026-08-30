const { z } = require("zod");
const ApiError = require("../utils/ApiError");

const KOLKATA_TZ = "Asia/Kolkata";
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_MIN_YEAR = 2020;

const optionalQueryNumber = (schema) =>
  z.preprocess(
    (val) => (val === undefined || val === "" ? undefined : val),
    schema.optional(),
  );

const getKolkataYmd = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: KOLKATA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/** Rejects rolled dates like 2026-02-30 (JS would become March). */
const isRealKolkataYmd = (ymd) => {
  if (!YMD_PATTERN.test(ymd)) return false;
  const parsed = new Date(`${ymd}T12:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return false;
  return getKolkataYmd(parsed) === ymd;
};

const reportSummaryQuerySchema = z
  .object({
    period: z.enum(["today", "day", "month"]).default("today"),
    year: optionalQueryNumber(z.coerce.number().int().min(2020).max(2100)),
    month: optionalQueryNumber(z.coerce.number().int().min(1).max(12)),
    date: z
      .preprocess(
        (val) => (val === undefined || val === "" ? undefined : val),
        z.string().regex(YMD_PATTERN).optional(),
      ),
  })
  .superRefine((query, ctx) => {
    if (query.period === "day" && query.date == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date is required for a day report.",
      });
    }

    if (query.period === "month") {
      const hasYear = query.year != null;
      const hasMonth = query.month != null;
      if (hasYear !== hasMonth) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "year and month must be sent together.",
        });
      }
    }

    if (query.date == null) return;

    if (!isRealKolkataYmd(query.date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date must be a real calendar day (YYYY-MM-DD).",
      });
      return;
    }

    const year = Number(query.date.slice(0, 4));
    if (year < REPORT_MIN_YEAR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `date year must be ${REPORT_MIN_YEAR} or later.`,
      });
      return;
    }

    const today = getKolkataYmd();
    if (query.date > today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot load a future day.",
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
