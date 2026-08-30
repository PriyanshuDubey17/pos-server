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

const resolvePeriodRange = ({ period, year, month, date }) => {
  const today = getKolkataYmd();

  if (period === "today") {
    return { from: today, to: today };
  }

  if (period === "day") {
    if (!date) {
      throw new ApiError("date is required for a day report.", 400);
    }
    if (date > today) {
      throw new ApiError("Cannot load a future day.", 400);
    }
    return { from: date, to: date };
  }

  const [todayYearStr, todayMonthStr] = today.split("-");
  const currentYear = Number(todayYearStr);
  const currentMonth = Number(todayMonthStr);
  const resolvedYear = year ?? currentYear;
  const resolvedMonth = month ?? currentMonth;

  if (
    resolvedYear > currentYear ||
    (resolvedYear === currentYear && resolvedMonth > currentMonth)
  ) {
    throw new ApiError("Cannot load a future month.", 400);
  }

  const yearStr = String(resolvedYear);
  const monthStr = String(resolvedMonth).padStart(2, "0");
  const from = `${yearStr}-${monthStr}-01`;
  const last = daysInMonth(resolvedYear, resolvedMonth);
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
    const { from, to } = resolvePeriodRange({
      period,
      year: req.query.year,
      month: req.query.month,
      date: req.query.date,
    });

    const rangeStart = kolkataDayStartUtc(from);
    const rangeEnd = kolkataDayStartUtc(addDaysYmd(to, 1));

    const matchStage = {
      restaurantId: restaurantObjectId,
      soldAt: { $gte: rangeStart, $lt: rangeEnd },
      status: { $ne: "voided" },
    };

    const [saleRows, itemRows] = await Promise.all([
      Sale.aggregate([
        { $match: matchStage },
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
            cashSale: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentMethod", "Cash"] },
                  "$totalAmount",
                  0,
                ],
              },
            },
            upiSale: {
              $sum: {
                $cond: [
                  { $eq: ["$paymentMethod", "UPI"] },
                  "$totalAmount",
                  0,
                ],
              },
            },
          },
        },
      ]),
      Sale.aggregate([
        { $match: matchStage },
        { $unwind: "$items" },
        {
          $group: {
            _id: {
              menuItemId: "$items.menuItemId",
              name: "$items.name",
            },
            qty: { $sum: "$items.qty" },
            amount: { $sum: "$items.lineTotal" },
          },
        },
        { $sort: { qty: -1, amount: -1 } },
        { $limit: 100 },
      ]),
    ]);

    const saleByDate = new Map(
      saleRows.map((row) => [
        row._id,
        {
          sale: Number(row.sale) || 0,
          saleCount: Number(row.saleCount) || 0,
          cashSale: Number(row.cashSale) || 0,
          upiSale: Number(row.upiSale) || 0,
        },
      ]),
    );

    const emptyDayTotals = {
      sale: 0,
      saleCount: 0,
      cashSale: 0,
      upiSale: 0,
    };

    const dayKeys = buildDayList(from, to);
    const days = dayKeys.map((date) => {
      const saleInfo = saleByDate.get(date) || emptyDayTotals;
      return {
        date,
        sale: saleInfo.sale,
        cashSale: saleInfo.cashSale,
        upiSale: saleInfo.upiSale,
      };
    });

    const totals = days.reduce(
      (acc, day) => {
        acc.sale += day.sale;
        acc.cashSale += day.cashSale;
        acc.upiSale += day.upiSale;
        return acc;
      },
      { sale: 0, saleCount: 0, cashSale: 0, upiSale: 0 },
    );
    totals.saleCount = [...saleByDate.values()].reduce(
      (n, row) => n + row.saleCount,
      0,
    );

    const topItems = itemRows.map((row) => ({
      menuItemId: row._id.menuItemId,
      name: row._id.name,
      qty: Number(row.qty) || 0,
      amount: Number(row.amount) || 0,
    }));

    res.status(200).json({
      success: true,
      data: {
        period,
        range: { from, to },
        totals,
        days,
        topItems,
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
