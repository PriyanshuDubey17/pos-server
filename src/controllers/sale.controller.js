const mongoose = require("mongoose");
const Sale = require("../models/Sale");
const Restaurant = require("../models/Restaurant");
const { Category, MenuItem } = require("../models/Menu");
const ApiError = require("../utils/ApiError");
const { withMongoTransaction } = require("../utils/withMongoTransaction");
const { resolveStockDeduct } = require("../utils/menuStock");

/** Fixed POS payment options — not restaurant-configurable */
const ALLOWED_PAYMENT_METHODS = ["Cash", "UPI"];

/** Fixed POS order types — not restaurant-configurable */
const ALLOWED_ORDER_TYPES = ["Dine", "Parcel"];

const TOKEN_LABEL_OPTIONS = ["Token", "Bill", "Order"];

const resolveTokenLabel = (value) =>
  TOKEN_LABEL_OPTIONS.includes(value) ? value : "Token";

/* ==========================================================
 *  Helpers
 * ========================================================== */

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
const getTodayTokenDate = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

/** Midnight Asia/Kolkata for YYYY-MM-DD → UTC Date */
const kolkataDayStartUtc = (ymd) => new Date(`${ymd}T00:00:00+05:30`);

const addDaysYmd = (ymd, days) => {
  const start = kolkataDayStartUtc(ymd);
  const next = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(next);
};

const resolveUnitPriceAndName = (menuItem, variantName) => {
  const variants = Array.isArray(menuItem.variants) ? menuItem.variants : [];
  const hasVariants = variants.length > 0;

  if (hasVariants) {
    let variant = null;
    if (variantName) {
      variant = variants.find(
        (v) =>
          String(v.name || "").trim().toLowerCase() ===
          String(variantName).trim().toLowerCase(),
      );
      if (!variant) {
        throw new ApiError(
          `Variant "${variantName}" not found for ${menuItem.name}`,
          400,
        );
      }
    } else {
      variant =
        variants.find((v) => v.isDefault) ||
        variants.reduce((best, v) =>
          !best || Number(v.price) < Number(best.price) ? v : best,
        null);
    }

    if (!variant || typeof variant.price !== "number") {
      throw new ApiError(`No valid price for ${menuItem.name}`, 400);
    }

    return {
      unitPrice: variant.price,
      name: `${menuItem.name} (${variant.name})`,
      variantName: variant.name,
    };
  }

  if (typeof menuItem.price !== "number") {
    throw new ApiError(`No valid price for ${menuItem.name}`, 400);
  }

  if (variantName) {
    throw new ApiError(
      `${menuItem.name} has no variants; remove variantName`,
      400,
    );
  }

  return {
    unitPrice: menuItem.price,
    name: menuItem.name,
    variantName: null,
  };
};

const buildReceiptPayload = ({ restaurant, sale }) => {
  const saleRecord = sale.toObject ? sale.toObject() : sale;
  const hasSalePhone = Object.prototype.hasOwnProperty.call(
    saleRecord,
    "phone",
  );
  const restaurantPhone = String(restaurant.phone || "").trim() || null;
  const phone = hasSalePhone ? saleRecord.phone : restaurantPhone;

  return {
    restaurantName: restaurant.name,
    phone: phone || null,
    tokenLabel: resolveTokenLabel(
      saleRecord.tokenLabel || restaurant.printerSettings?.tokenLabel,
    ),
    tokenNo: sale.tokenNo,
    soldAt: sale.soldAt,
    status: sale.status || "completed",
    items: sale.items.map((line) => ({
      name: line.name,
      qty: line.qty,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
    totalAmount: sale.totalAmount,
    paymentMethod: sale.paymentMethod,
    orderType: sale.orderType || null,
    paperWidth: restaurant.printerSettings?.paperWidth || "58",
    receiptCopies: restaurant.printerSettings?.receiptCopies === 2 ? 2 : 1,
    printLargeToken: restaurant.printerSettings?.printLargeToken !== false,
  };
};

/** Normalize printerSettings for API responses */
const normalizePrinterSettings = (printerSettings = {}) => ({
  paperWidth: printerSettings.paperWidth === "80" ? "80" : "58",
  autoPrintOnConfirm: printerSettings.autoPrintOnConfirm !== false,
  isPaired: !!printerSettings.isPaired,
  deviceLabel: printerSettings.deviceLabel || null,
  receiptCopies: printerSettings.receiptCopies === 2 ? 2 : 1,
  tokenLabel: resolveTokenLabel(printerSettings.tokenLabel),
  printLargeToken: printerSettings.printLargeToken !== false,
});

/**
 * Atomically allocate next daily token (Asia/Kolkata business day).
 * Safe under concurrent confirms.
 */
const allocateNextTokenNo = async (restaurantId, session) => {
  const today = getTodayTokenDate();
  const opts = { returnDocument: "after", session };

  let updated = await Restaurant.findOneAndUpdate(
    { _id: restaurantId, tokenDate: today },
    { $inc: { lastTokenNo: 1 } },
    opts,
  );
  if (updated) return updated.lastTokenNo;

  updated = await Restaurant.findOneAndUpdate(
    {
      _id: restaurantId,
      $or: [{ tokenDate: null }, { tokenDate: { $ne: today } }],
    },
    { $set: { tokenDate: today, lastTokenNo: 1 } },
    opts,
  );
  if (updated) return 1;

  updated = await Restaurant.findOneAndUpdate(
    { _id: restaurantId, tokenDate: today },
    { $inc: { lastTokenNo: 1 } },
    opts,
  );
  if (!updated) {
    throw new ApiError("Restaurant not found", 404);
  }
  return updated.lastTokenNo;
};

/**
 * Core confirm logic — always runs inside withMongoTransaction(session).
 */
const applyConfirmSale = async ({
  restaurantId,
  userId,
  paymentMethod,
  orderType,
  cartItems,
  session,
}) => {
  const restaurant = await Restaurant.findById(restaurantId).session(session);
  if (!restaurant) {
    throw new ApiError("Restaurant not found", 404);
  }

  const allowedMethods = ALLOWED_PAYMENT_METHODS;
  if (!allowedMethods.includes(paymentMethod)) {
    throw new ApiError("Payment method must be Cash or UPI", 400);
  }

  if (!ALLOWED_ORDER_TYPES.includes(orderType)) {
    throw new ApiError("Order type must be Dine or Parcel", 400);
  }

  const menuItemIds = [
    ...new Set(cartItems.map((line) => String(line.menuItemId))),
  ];
  const menuItems = await MenuItem.find({
    _id: { $in: menuItemIds },
    restaurantId,
    isDeleted: false,
    isAvailable: true,
  }).session(session);
  const menuById = new Map(menuItems.map((m) => [String(m._id), m]));

  const tokenNo = await allocateNextTokenNo(restaurantId, session);
  restaurant.lastTokenNo = tokenNo;
  restaurant.tokenDate = getTodayTokenDate();

  const saleLines = [];
  /** Aggregate base qty needed per menu item (same item multiple lines) */
  const stockNeedByItemId = new Map();

  for (const cartLine of cartItems) {
    const menuItem = menuById.get(String(cartLine.menuItemId));
    if (!menuItem) {
      throw new ApiError(
        "One or more menu items are unavailable or not found",
        400,
      );
    }

    const { unitPrice, name, variantName } = resolveUnitPriceAndName(
      menuItem,
      cartLine.variantName,
    );
    const qty = cartLine.qty;
    const lineTotal = unitPrice * qty;

    saleLines.push({
      menuItemId: menuItem._id,
      name,
      qty,
      unitPrice,
      lineTotal,
    });

    if (menuItem.stockEnabled) {
      const deductPerUnit = resolveStockDeduct(menuItem, variantName);
      const need = deductPerUnit * qty;
      const key = String(menuItem._id);
      stockNeedByItemId.set(key, (stockNeedByItemId.get(key) || 0) + need);
    }
  }

  const stockAdjustments = [];
  for (const [menuItemId, baseQty] of stockNeedByItemId.entries()) {
    const menuItem = menuById.get(menuItemId);
    const updated = await MenuItem.findOneAndUpdate(
      {
        _id: menuItemId,
        restaurantId,
        stockEnabled: true,
        isDeleted: false,
        stockQty: { $gte: baseQty },
      },
      { $inc: { stockQty: -baseQty } },
      { session, returnDocument: "after" },
    );
    if (!updated) {
      throw new ApiError(
        `Not enough stock for ${menuItem?.name || "item"}`,
        400,
      );
    }
    stockAdjustments.push({
      menuItemId: updated._id,
      baseQty,
    });
  }

  const totalAmount = saleLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const soldAt = new Date();

  const salePayload = {
    restaurantId,
    tokenNo,
    soldAt,
    items: saleLines,
    totalAmount,
    paymentMethod,
    orderType,
    status: "completed",
    stockAdjustments,
    createdByUserId: userId,
    tokenLabel: resolveTokenLabel(restaurant.printerSettings?.tokenLabel),
    phone: String(restaurant.phone || "").trim() || null,
  };

  const [sale] = await Sale.create([salePayload], { session });

  const receiptPayload = buildReceiptPayload({ restaurant, sale });

  return {
    sale,
    receiptPayload,
  };
};

const confirmSaleWithEffects = async (payload) =>
  withMongoTransaction((session) =>
    applyConfirmSale({ ...payload, session }),
  );

/**
 * Core void logic — always runs inside withMongoTransaction(session).
 * Does not change token sequence (Restaurant.lastTokenNo).
 * Restores stock from sale.stockAdjustments snapshot when present.
 */
const applyVoidSale = async ({ restaurantId, userId, saleId, session }) => {
  const sale = await Sale.findOne({ _id: saleId, restaurantId }).session(
    session,
  );
  if (!sale) {
    throw new ApiError("Sale not found", 404);
  }
  if (sale.status === "voided") {
    throw new ApiError("Sale is already voided", 400);
  }

  sale.status = "voided";
  sale.voidedAt = new Date();
  sale.voidedByUserId = userId;
  await sale.save({ session });

  const adjustments = Array.isArray(sale.stockAdjustments)
    ? sale.stockAdjustments
    : [];

  for (const row of adjustments) {
    const baseQty = Number(row.baseQty);
    if (!Number.isFinite(baseQty) || baseQty <= 0) continue;

    await MenuItem.findOneAndUpdate(
      {
        _id: row.menuItemId,
        restaurantId,
      },
      { $inc: { stockQty: baseQty } },
      { session },
    );
  }

  return sale;
};

const voidSaleWithEffects = async (payload) =>
  withMongoTransaction((session) => applyVoidSale({ ...payload, session }));

/* ==========================================================
 *  POS menu
 * ========================================================== */

exports.getPosMenu = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);

    const [categories, items, restaurant] = await Promise.all([
      Category.find({ restaurantId, isActive: true })
        .sort({ displayOrder: 1, name: 1 })
        .select("_id name displayOrder type image")
        .lean(),
      MenuItem.find({
        restaurantId,
        isDeleted: false,
        isAvailable: true,
      })
        .sort({ displayOrder: 1, name: 1 })
        .select(
          "_id name category price variants isVeg image displayOrder stockEnabled stockQty baseUnit stockDeduct",
        )
        .lean(),
      Restaurant.findById(restaurantId)
        .select("printerSettings allowTwoReceiptCopies")
        .lean(),
    ]);

    const activeCategoryIds = new Set(categories.map((c) => String(c._id)));
    const posItems = items
      .filter((item) => activeCategoryIds.has(String(item.category)))
      .map((item) => {
        const variants = Array.isArray(item.variants) ? item.variants : [];
        let displayPrice = item.price;
        if (variants.length > 0) {
          const defaultVariant =
            variants.find((v) => v.isDefault) ||
            variants.reduce((best, v) =>
              !best || Number(v.price) < Number(best.price) ? v : best,
            null);
          displayPrice = defaultVariant?.price ?? null;
        }

        return {
          _id: item._id,
          name: item.name,
          category: item.category,
          price: item.price,
          displayPrice,
          variants: variants.map((v) => ({
            name: v.name,
            price: v.price,
            isDefault: !!v.isDefault,
            stockDeduct: v.stockDeduct ?? null,
          })),
          isVeg: item.isVeg,
          image: item.image,
          displayOrder: item.displayOrder,
          stockEnabled: !!item.stockEnabled,
          stockQty: item.stockEnabled ? Number(item.stockQty) || 0 : null,
          baseUnit: item.stockEnabled ? item.baseUnit : null,
          stockDeduct: item.stockEnabled ? item.stockDeduct ?? null : null,
        };
      });

    const printerSettings = normalizePrinterSettings(
      restaurant?.printerSettings,
    );

    res.status(200).json({
      success: true,
      data: {
        categories,
        items: posItems,
        paymentMethods: ALLOWED_PAYMENT_METHODS,
        orderTypes: ALLOWED_ORDER_TYPES,
        receiptCopies: printerSettings.receiptCopies,
        allowTwoReceiptCopies: !!restaurant?.allowTwoReceiptCopies,
        autoPrintOnConfirm: printerSettings.autoPrintOnConfirm,
        paperWidth: printerSettings.paperWidth,
        printerSettings,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Receipt copies setting
 * ========================================================== */

exports.updateReceiptCopies = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { receiptCopies } = req.body;

    const restaurant = await Restaurant.findByIdAndUpdate(
      restaurantId,
      { $set: { "printerSettings.receiptCopies": receiptCopies } },
      { returnDocument: "after", runValidators: true },
    ).select("printerSettings.receiptCopies");

    if (!restaurant) {
      throw new ApiError("Restaurant not found", 404);
    }

    const savedCopies =
      restaurant.printerSettings?.receiptCopies === 2 ? 2 : 1;

    res.status(200).json({
      success: true,
      message: "Receipt copies updated",
      data: { receiptCopies: savedCopies },
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Printer settings (thermal)
 * ========================================================== */

exports.getPrinterSettings = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const restaurant = await Restaurant.findById(restaurantId)
      .select("printerSettings allowTwoReceiptCopies")
      .lean();

    if (!restaurant) {
      throw new ApiError("Restaurant not found", 404);
    }

    res.status(200).json({
      success: true,
      data: {
        ...normalizePrinterSettings(restaurant.printerSettings),
        allowTwoReceiptCopies: !!restaurant.allowTwoReceiptCopies,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.updatePrinterSettings = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const {
      paperWidth,
      autoPrintOnConfirm,
      receiptCopies,
      deviceLabel,
      isPaired,
      tokenLabel,
      printLargeToken,
    } = req.body;

    const $set = {};
    if (paperWidth !== undefined) {
      $set["printerSettings.paperWidth"] = paperWidth;
    }
    if (autoPrintOnConfirm !== undefined) {
      $set["printerSettings.autoPrintOnConfirm"] = autoPrintOnConfirm;
    }
    if (receiptCopies !== undefined) {
      $set["printerSettings.receiptCopies"] = receiptCopies;
    }
    if (deviceLabel !== undefined) {
      $set["printerSettings.deviceLabel"] = deviceLabel;
    }
    if (isPaired !== undefined) {
      $set["printerSettings.isPaired"] = isPaired;
    }
    if (tokenLabel !== undefined) {
      $set["printerSettings.tokenLabel"] = tokenLabel;
    }
    if (printLargeToken !== undefined) {
      $set["printerSettings.printLargeToken"] = printLargeToken;
    }

    const restaurant = await Restaurant.findByIdAndUpdate(
      restaurantId,
      { $set },
      { returnDocument: "after", runValidators: true },
    ).select("printerSettings");

    if (!restaurant) {
      throw new ApiError("Restaurant not found", 404);
    }

    res.status(200).json({
      success: true,
      message: "Printer settings updated",
      data: normalizePrinterSettings(restaurant.printerSettings),
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  List sales (by Kolkata business day)
 * ========================================================== */

exports.listSales = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const restaurantObjectId = new mongoose.Types.ObjectId(
      String(restaurantId),
    );
    const { page, limit } = req.query;
    const date = req.query.date || getTodayTokenDate();

    const rangeStart = kolkataDayStartUtc(date);
    const rangeEnd = kolkataDayStartUtc(addDaysYmd(date, 1));

    const filter = {
      restaurantId: restaurantObjectId,
      soldAt: { $gte: rangeStart, $lt: rangeEnd },
    };

    const activeTotalsFilter = {
      ...filter,
      status: { $ne: "voided" },
    };

    const skip = (page - 1) * limit;

    const [sales, total, totalsAgg] = await Promise.all([
      Sale.find(filter)
        .sort({ soldAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("tokenNo soldAt totalAmount paymentMethod orderType items status")
        .lean(),
      Sale.countDocuments(filter),
      Sale.aggregate([
        { $match: activeTotalsFilter },
        {
          $group: {
            _id: null,
            dayTotal: { $sum: "$totalAmount" },
            dayCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const items = sales.map((sale) => ({
      _id: sale._id,
      tokenNo: sale.tokenNo,
      soldAt: sale.soldAt,
      totalAmount: sale.totalAmount,
      paymentMethod: sale.paymentMethod,
      orderType: sale.orderType || null,
      status: sale.status || "completed",
      itemCount: Array.isArray(sale.items)
        ? sale.items.reduce((n, line) => n + (Number(line.qty) || 0), 0)
        : 0,
      itemsPreview: Array.isArray(sale.items)
        ? sale.items.slice(0, 3).map((line) => ({
            name: line.name,
            qty: line.qty,
          }))
        : [],
    }));

    const dayStats = totalsAgg[0] || { dayTotal: 0, dayCount: 0 };

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      meta: {
        date,
        dayTotal: dayStats.dayTotal || 0,
        dayCount: dayStats.dayCount || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Sale receipt (history)
 * ========================================================== */

exports.getSaleReceipt = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError("Invalid sale id", 400);
    }

    const [sale, restaurant] = await Promise.all([
      Sale.findOne({ _id: id, restaurantId }).lean(),
      Restaurant.findById(restaurantId)
        .select("name phone printerSettings")
        .lean(),
    ]);

    if (!sale) {
      throw new ApiError("Sale not found", 404);
    }
    if (!restaurant) {
      throw new ApiError("Restaurant not found", 404);
    }

    const receiptPayload = buildReceiptPayload({ restaurant, sale });

    res.status(200).json({
      success: true,
      data: { receiptPayload },
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Confirm sale
 * ========================================================== */

exports.confirmSale = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const userId = req.user._id;
    const { paymentMethod, orderType, items } = req.body;

    const { sale, receiptPayload } = await confirmSaleWithEffects({
      restaurantId,
      userId,
      paymentMethod,
      orderType,
      cartItems: items,
    });

    res.status(201).json({
      success: true,
      message: "Sale confirmed",
      data: {
        sale,
        receiptPayload,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Void sale (keep token; status only)
 * ========================================================== */

exports.voidSale = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const userId = req.user._id;
    const { id } = req.params;

    const sale = await voidSaleWithEffects({
      restaurantId,
      userId,
      saleId: id,
    });

    res.status(200).json({
      success: true,
      message: "Sale voided",
      data: {
        _id: sale._id,
        tokenNo: sale.tokenNo,
        status: sale.status,
        voidedAt: sale.voidedAt,
        totalAmount: sale.totalAmount,
      },
    });
  } catch (error) {
    next(error);
  }
};
