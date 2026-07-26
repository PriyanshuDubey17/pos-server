const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const { MenuItem } = require("../models/Menu");
const ApiError = require("../utils/ApiError");

const KOLKATA_TZ = "Asia/Kolkata";

const getTenantRestaurantId = (req) => {
  const restaurantId = req.user?.restaurantId;
  if (!restaurantId) {
    throw new ApiError(
      "Restaurant account is not linked. Contact support.",
      403,
    );
  }
  return restaurantId;
};

/** Business day YYYY-MM-DD in Asia/Kolkata */
const getKolkataYmd = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: KOLKATA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/** Midnight Asia/Kolkata for YYYY-MM-DD → UTC Date */
const kolkataDayStartUtc = (ymd) => new Date(`${ymd}T00:00:00+05:30`);

const addDaysYmd = (ymd, days) => {
  const start = kolkataDayStartUtc(ymd);
  const next = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return getKolkataYmd(next);
};

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const buildDayList = (fromYmd, toYmd) => {
  const days = [];
  let cursor = fromYmd;
  while (cursor <= toYmd) {
    days.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return days;
};

const resolvePeriodRange = (period) => {
  const today = getKolkataYmd();

  if (period === "today") {
    return { from: today, to: today };
  }

  const [yearStr, monthStr] = today.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const from = `${yearStr}-${monthStr}-01`;
  const last = daysInMonth(year, month);
  const to = `${yearStr}-${monthStr}-${String(last).padStart(2, "0")}`;
  return { from, to };
};

exports.getReportSummary = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const restaurantObjectId = new mongoose.Types.ObjectId(
      String(restaurantId),
    );
    const period = req.query.period || "today";
    const { from, to } = resolvePeriodRange(period);

    const rangeStart = kolkataDayStartUtc(from);
    const rangeEnd = kolkataDayStartUtc(addDaysYmd(to, 1));

    const saleRows = await Sale.aggregate([
      {
        $match: {
          restaurantId: restaurantObjectId,
          soldAt: { $gte: rangeStart, $lt: rangeEnd },
          status: { $ne: "voided" },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$soldAt",
              timezone: KOLKATA_TZ,
            },
          },
          sale: { $sum: "$totalAmount" },
          saleCount: { $sum: 1 },
        },
      },
    ]);

    const saleByDate = new Map(
      saleRows.map((row) => [
        row._id,
        {
          sale: Number(row.sale) || 0,
          saleCount: Number(row.saleCount) || 0,
        },
      ]),
    );

    const dayKeys = buildDayList(from, to);
    const days = dayKeys.map((date) => {
      const saleInfo = saleByDate.get(date) || {
        sale: 0,
        saleCount: 0,
      };
      return {
        date,
        sale: saleInfo.sale,
      };
    });

    const totals = days.reduce(
      (acc, day) => {
        acc.sale += day.sale;
        return acc;
      },
      { sale: 0, saleCount: 0 },
    );
    totals.saleCount = [...saleByDate.values()].reduce(
      (n, row) => n + row.saleCount,
      0,
    );

    res.status(200).json({
      success: true,
      data: {
        period,
        range: { from, to },
        totals,
        days,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * First-time setup checklist counts for restaurant_admin dashboard.
 */
exports.getSetupStatus = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const restaurantObjectId = new mongoose.Types.ObjectId(
      String(restaurantId),
    );

    const [menuItemCount, saleCount] = await Promise.all([
      MenuItem.countDocuments({
        restaurantId: restaurantObjectId,
        isDeleted: false,
      }),
      Sale.countDocuments({
        restaurantId: restaurantObjectId,
        status: { $ne: "voided" },
      }),
    ]);

    const steps = {
      hasMenu: menuItemCount > 0,
      hasSale: saleCount > 0,
    };

    const isComplete = steps.hasMenu && steps.hasSale;

    res.status(200).json({
      success: true,
      data: {
        menuItemCount,
        saleCount,
        steps,
        isComplete,
      },
    });
  } catch (error) {
    next(error);
  }
};
