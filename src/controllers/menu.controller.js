const mongoose = require("mongoose");
const { Category, MenuItem } = require("../models/Menu");
const ApiError = require("../utils/ApiError");
const { cloudinary, deleteImageFromCloudinary } = require("../utils/cloudinary");
const {
  assertMenuItemStockConfig,
  resolveMinStockDeduct,
} = require("../utils/menuStock");

/* ==========================================================
 *  Helpers
 * ========================================================== */

/**
 * Validate that a string is a valid MongoDB ObjectId
 */
const assertValidObjectId = (id, label = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(`Invalid ${label} format`, 400);
  }
};

/**
 * Escape special regex characters to prevent ReDoS / Regex injection
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tenant restaurantId from logged-in restaurant_admin */
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

/**
 * Build Mongo sort object from sortBy query param
 */
const getSortStage = (sortBy) => {
  switch (sortBy) {
    case "name-asc":
      return { name: 1 };
    case "name-desc":
      return { name: -1 };
    case "price-low":
      return { effectivePrice: 1, name: 1 };
    case "price-high":
      return { effectivePrice: -1, name: 1 };
    case "newest":
      return { createdAt: -1 };
    default:
      return { displayOrder: 1, createdAt: -1 };
  }
};

/**
 * Build aggregation pipeline stages shared by list + count queries
 */
const buildMenuItemsListPipeline = (filter, requireActiveCategory) => {
  const stages = [{ $match: filter }];

  stages.push({
    $lookup: {
      from: "categories",
      localField: "category",
      foreignField: "_id",
      as: "_cat",
    },
  });

  stages.push({ $unwind: { path: "$_cat", preserveNullAndEmptyArrays: !requireActiveCategory } });

  if (requireActiveCategory) {
    stages.push({ $match: { "_cat.isActive": true } });
  }

  stages.push({
    $addFields: {
      effectivePrice: {
        $cond: {
          if: {
            $and: [
              { $isArray: "$variants" },
              { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
            ],
          },
          then: { $min: "$variants.price" },
          else: "$price",
        },
      },
      category: {
        _id: "$_cat._id",
        name: "$_cat.name",
        isActive: "$_cat.isActive",
      },
    },
  });

  stages.push({ $project: { _cat: 0 } });

  return stages;
};

/**
 * Build Mongo filter from validated list query params (tenant-scoped)
 */
const buildFilterFromQuery = (query = {}, restaurantId) => {
  const { search, category, isVeg, isAvailable, archived } = query;
  const filter = {
    isDeleted: archived === true,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  };

  if (category) {
    filter.category = new mongoose.Types.ObjectId(category);
  }
  if (isVeg !== undefined) filter.isVeg = isVeg;
  // Soft-deleted items are always unavailable — skip availability filter when listing archive
  if (archived !== true && isAvailable !== undefined) {
    filter.isAvailable = isAvailable;
  }
  if (search) filter.$text = { $search: search };

  return filter;
};

/* ==========================================================
 *  Cloudinary Signature
 * ========================================================== */

exports.getCloudinarySignature = (req, res, next) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = "restaurant/menu";

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );

    res.status(200).json({
      success: true,
      timestamp,
      signature,
      folder,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Category Controllers
 * ========================================================== */

exports.getCategories = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);

    const categories = await Category.aggregate([
      { $match: { restaurantId: restaurantObjectId } },
      { $sort: { displayOrder: 1, createdAt: -1 } },
      {
        $lookup: {
          from: "menuitems",
          let: { catId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$category", "$$catId"] },
                    { $eq: ["$restaurantId", restaurantObjectId] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                linked: { $sum: 1 },
                active: {
                  $sum: {
                    $cond: [{ $eq: ["$isDeleted", false] }, 1, 0],
                  },
                },
              },
            },
          ],
          as: "itemStats",
        },
      },
      {
        $addFields: {
          itemCount: {
            $ifNull: [{ $arrayElemAt: ["$itemStats.active", 0] }, 0],
          },
          linkedItemCount: {
            $ifNull: [{ $arrayElemAt: ["$itemStats.linked", 0] }, 0],
          },
        },
      },
      { $project: { itemStats: 0 } },
    ]);

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};

exports.createCategory = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const escapedName = escapeRegex(req.body.name);
    const existing = await Category.findOne({
      restaurantId,
      name: { $regex: new RegExp(`^${escapedName}$`, "i") },
    });

    if (existing) {
      throw new ApiError("Category with this name already exists", 400);
    }

    const { restaurantId: _ignored, ...rest } = req.body;
    const category = await Category.create({ ...rest, restaurantId });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(new ApiError("Category with this name already exists", 400));
    }
    next(error);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { id } = req.params;
    assertValidObjectId(id, "Category ID");

    if (req.body.name) {
      const escapedName = escapeRegex(req.body.name);
      const existing = await Category.findOne({
        restaurantId,
        name: { $regex: new RegExp(`^${escapedName}$`, "i") },
        _id: { $ne: id },
      });
      if (existing) {
        throw new ApiError("Another category with this name already exists", 400);
      }
    }

    const oldCategory = await Category.findOne({ _id: id, restaurantId });
    if (!oldCategory) {
      throw new ApiError("Category not found", 404);
    }

    // Handle image changes:
    // 1. If new imagePublicId is different from old → delete old image
    // 2. If imagePublicId is being cleared (set to "" or null) → delete old image
    const oldPublicId = oldCategory.imagePublicId;
    const newPublicId = req.body.imagePublicId;

    if (oldPublicId && newPublicId !== undefined && newPublicId !== oldPublicId) {
      await deleteImageFromCloudinary(oldPublicId);
    }

    const { restaurantId: _ignored, ...rest } = req.body;
    const category = await Category.findOneAndUpdate(
      { _id: id, restaurantId },
      rest,
      {
        returnDocument: "after",
        runValidators: true,
      },
    );

    if (!category) {
      throw new ApiError("Category not found", 404);
    }

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(new ApiError("Another category with this name already exists", 400));
    }
    next(error);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { id } = req.params;
    assertValidObjectId(id, "Category ID");

    // Block delete if ANY menu item is linked (including archived)
    const linkedItems = await MenuItem.countDocuments({
      category: id,
      restaurantId,
    });
    if (linkedItems > 0) {
      throw new ApiError(
        `Cannot delete category. ${linkedItems} menu item${linkedItems > 1 ? "s are" : " is"} linked (including archived). Deactivate the category instead.`,
        400
      );
    }

    const category = await Category.findOne({ _id: id, restaurantId });
    if (!category) {
      throw new ApiError("Category not found", 404);
    }

    // Delete associated Cloudinary image before removing from DB
    if (category.imagePublicId) {
      await deleteImageFromCloudinary(category.imagePublicId);
    }

    await Category.findOneAndDelete({ _id: id, restaurantId });

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Menu Item Controllers
 * ========================================================== */

exports.getMenuItems = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const {
      page,
      limit,
      requireActiveCategory,
      sortBy,
    } = req.validatedQuery;

    const filter = buildFilterFromQuery(req.validatedQuery, restaurantId);
    const basePipeline = buildMenuItemsListPipeline(filter, !!requireActiveCategory);

    const countResult = await MenuItem.aggregate([...basePipeline, { $count: "total" }]);
    const total = countResult[0]?.total ?? 0;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;

    const sortStage = getSortStage(sortBy);
    const items = await MenuItem.aggregate([
      ...basePipeline,
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
    ]);

    res.status(200).json({
      success: true,
      data: items,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error) {
    next(error);
  }
};

exports.getMenuItemStats = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const query = req.validatedQuery || {};
    const filter = buildFilterFromQuery(query, restaurantId);
    const basePipeline = buildMenuItemsListPipeline(filter, !!query.requireActiveCategory);

    const [result] = await MenuItem.aggregate([
      ...basePipeline,
      {
        $facet: {
          total: [{ $count: "count" }],
          available: [{ $match: { isAvailable: true } }, { $count: "count" }],
          veg: [{ $match: { isVeg: true } }, { $count: "count" }],
          nonVeg: [{ $match: { isVeg: false } }, { $count: "count" }],
        },
      },
    ]);

    const facet = result || {};

    res.status(200).json({
      success: true,
      data: {
        total: facet.total?.[0]?.count ?? 0,
        available: facet.available?.[0]?.count ?? 0,
        veg: facet.veg?.[0]?.count ?? 0,
        nonVeg: facet.nonVeg?.[0]?.count ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.createMenuItem = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);

    // Validate category exists in this restaurant
    const category = await Category.findOne({
      _id: req.body.category,
      restaurantId,
    });
    if (!category) {
      throw new ApiError("Invalid category selected", 400);
    }

    // Prevent assigning items to an inactive category
    if (!category.isActive) {
      throw new ApiError("Cannot create items under an inactive category. Activate the category first.", 400);
    }

    // Duplicate name within same category (active + soft-deleted)
    const escapedName = escapeRegex(req.body.name);
    const duplicate = await MenuItem.findOne({
      restaurantId,
      name: { $regex: new RegExp(`^${escapedName}$`, "i") },
      category: req.body.category,
    });
    if (duplicate) {
      throw new ApiError(
        duplicate.isDeleted
          ? "An archived item with this name already exists in this category"
          : "An item with this name already exists in the selected category",
        400,
      );
    }

    // --- XOR Price & Variants (Zod transform already cleans, this is a safety net) ---
    if (req.body.variants && req.body.variants.length > 0) {
      req.body.price = null;
      req.body.stockDeduct = null;
    } else if (req.body.price !== undefined && req.body.price !== null) {
      req.body.variants = [];
    } else {
      throw new ApiError("Either a base price or variants must be provided", 400);
    }

    if (!req.body.stockEnabled) {
      req.body.baseUnit = null;
      req.body.stockDeduct = null;
      if (req.body.stockQty === undefined) req.body.stockQty = 0;
    }

    assertMenuItemStockConfig(req.body);

    const {
      restaurantId: _ignored,
      addonGroups: _dropAddons,
      recipe: _dropRecipe,
      isCombo: _dropIsCombo,
      comboItems: _dropComboItems,
      isBestseller: _dropIsBestseller,
      prepTime: _dropPrepTime,
      ...rest
    } = req.body;
    const item = await MenuItem.create({ ...rest, restaurantId });

    res.status(201).json({
      success: true,
      message: "Menu item created successfully",
      data: item,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(
        new ApiError(
          "An item with this name already exists in the selected category (including archived)",
          400,
        ),
      );
    }
    next(error);
  }
};

exports.updateMenuItem = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { id } = req.params;
    assertValidObjectId(id, "Menu Item ID");

    if (req.body.category) {
      const category = await Category.findOne({
        _id: req.body.category,
        restaurantId,
      });
      if (!category) {
        throw new ApiError("Invalid category selected", 400);
      }
      // Prevent reassignment to an inactive category
      if (!category.isActive) {
        throw new ApiError("Cannot reassign item to an inactive category. Activate the category first.", 400);
      }
    }

    // Atomic: fetch old item to handle image cleanup
    const oldItem = await MenuItem.findOne({
      _id: id,
      restaurantId,
      isDeleted: false,
    });
    if (!oldItem) {
      throw new ApiError("Menu item not found or deleted", 404);
    }

    // Duplicate name within target category (active + soft-deleted)
    if (req.body.name || req.body.category) {
      const targetName = req.body.name || oldItem.name;
      const targetCategory = req.body.category || oldItem.category;
      const escapedName = escapeRegex(targetName);
      const duplicate = await MenuItem.findOne({
        restaurantId,
        name: { $regex: new RegExp(`^${escapedName}$`, "i") },
        category: targetCategory,
        _id: { $ne: id },
      });
      if (duplicate) {
        throw new ApiError(
          duplicate.isDeleted
            ? "An archived item with this name already exists in this category"
            : "An item with this name already exists in the selected category",
          400,
        );
      }
    }

    // --- Deep Merge XOR: Price & Variants ---
    const mergedVariants = req.body.variants !== undefined ? req.body.variants : oldItem.variants;
    const mergedPrice = req.body.price !== undefined ? req.body.price : oldItem.price;

    if (mergedVariants && mergedVariants.length > 0) {
      req.body.price = null;
      req.body.stockDeduct = null;
    } else if (mergedPrice != null) {
      req.body.variants = [];
    } else {
      throw new ApiError("Base price or variants must be provided", 400);
    }

    const mergedStockEnabled =
      req.body.stockEnabled !== undefined
        ? req.body.stockEnabled
        : oldItem.stockEnabled;
    if (!mergedStockEnabled) {
      req.body.baseUnit = null;
      req.body.stockDeduct = null;
    }

    const stockPreview = {
      stockEnabled: mergedStockEnabled,
      baseUnit:
        req.body.baseUnit !== undefined ? req.body.baseUnit : oldItem.baseUnit,
      stockDeduct:
        req.body.stockDeduct !== undefined
          ? req.body.stockDeduct
          : oldItem.stockDeduct,
      variants:
        req.body.variants !== undefined ? req.body.variants : oldItem.variants,
    };
    assertMenuItemStockConfig(stockPreview);

    // Handle image changes:
    // 1. New image uploaded (different publicId) → delete old
    // 2. Image removed (publicId set to "" or null) → delete old
    const oldPublicId = oldItem.imagePublicId;
    const newPublicId = req.body.imagePublicId;

    if (oldPublicId && newPublicId !== undefined && newPublicId !== oldPublicId) {
      await deleteImageFromCloudinary(oldPublicId);
    }

    const {
      restaurantId: _ignored,
      addonGroups: _dropAddons,
      recipe: _dropRecipe,
      isCombo: _dropIsCombo,
      comboItems: _dropComboItems,
      isBestseller: _dropIsBestseller,
      prepTime: _dropPrepTime,
      ...rest
    } = req.body;
    const item = await MenuItem.findOneAndUpdate(
      { _id: id, restaurantId, isDeleted: false },
      {
        $set: rest,
        $unset: {
          addonGroups: "",
          recipe: "",
          isCombo: "",
          comboItems: "",
          isBestseller: "",
          prepTime: "",
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      },
    );

    if (!item) {
      throw new ApiError("Menu item not found or deleted", 404);
    }

    res.status(200).json({
      success: true,
      message: "Menu item updated successfully",
      data: item,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(
        new ApiError(
          "An item with this name already exists in the selected category (including archived)",
          400,
        ),
      );
    }
    next(error);
  }
};

exports.deleteMenuItem = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { id } = req.params;
    assertValidObjectId(id, "Menu Item ID");

    // Soft delete to preserve order history integrity
    const item = await MenuItem.findOneAndUpdate(
      { _id: id, restaurantId, isDeleted: false },
      { isDeleted: true, isAvailable: false },
      { returnDocument: "after" }
    );

    if (!item) {
      throw new ApiError("Menu item not found or already deleted", 404);
    }

    res.status(200).json({
      success: true,
      message: "Menu item deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.restoreMenuItem = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { id } = req.params;
    assertValidObjectId(id, "Menu Item ID");

    const item = await MenuItem.findOneAndUpdate(
      { _id: id, restaurantId, isDeleted: true },
      { isDeleted: false, isAvailable: true },
      { returnDocument: "after" },
    ).populate("category", "name isActive");

    if (!item) {
      throw new ApiError("Archived menu item not found", 404);
    }

    res.status(200).json({
      success: true,
      message: "Menu item restored successfully",
      data: item,
    });
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Stock list + receive
 * ========================================================== */

exports.listStockItems = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);

    const items = await MenuItem.find({
      restaurantId,
      isDeleted: false,
      stockEnabled: true,
    })
      .sort({ name: 1 })
      .select(
        "_id name category baseUnit stockQty stockDeduct variants isAvailable image",
      )
      .populate("category", "name isActive")
      .lean();

    const data = items.map((item) => {
      const minDeduct = resolveMinStockDeduct(item);
      const stockQty = Number(item.stockQty) || 0;

      return {
        _id: item._id,
        name: item.name,
        category: item.category,
        baseUnit: item.baseUnit,
        stockQty,
        stockDeduct: item.stockDeduct,
        variants: (item.variants || []).map((v) => ({
          name: v.name,
          price: v.price,
          isDefault: !!v.isDefault,
          stockDeduct: v.stockDeduct,
        })),
        isAvailable: item.isAvailable,
        image: item.image,
        minDeduct,
      };
    });

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

exports.adjustStock = async (req, res, next) => {
  try {
    const restaurantId = getTenantRestaurantId(req);
    const { id } = req.params;
    assertValidObjectId(id, "Menu Item ID");

    const item = await MenuItem.findOne({
      _id: id,
      restaurantId,
      isDeleted: false,
    });
    if (!item) {
      throw new ApiError("Menu item not found", 404);
    }
    if (!item.stockEnabled) {
      throw new ApiError("Stock tracking is not enabled for this item", 400);
    }
    if (item.baseUnit !== "piece" && item.baseUnit !== "gram") {
      throw new ApiError("Item baseUnit is not configured", 400);
    }

    const { qty, unit } = req.body;
    let delta = Number(qty);
    const receiveUnit = unit || item.baseUnit;

    if (item.baseUnit === "piece") {
      if (receiveUnit !== "piece") {
        throw new ApiError("This item uses piece — send unit piece", 400);
      }
    } else if (item.baseUnit === "gram") {
      if (receiveUnit === "kg") {
        delta = delta * 1000;
      } else if (receiveUnit !== "gram") {
        throw new ApiError("This item uses gram — send unit gram or kg", 400);
      }
    }

    if (!Number.isFinite(delta) || delta <= 0) {
      throw new ApiError("Quantity must be greater than 0", 400);
    }

    const updated = await MenuItem.findOneAndUpdate(
      { _id: id, restaurantId, stockEnabled: true, isDeleted: false },
      { $inc: { stockQty: delta } },
      { returnDocument: "after", runValidators: true },
    );

    if (!updated) {
      throw new ApiError("Menu item not found", 404);
    }

    res.status(200).json({
      success: true,
      message: "Stock updated",
      data: {
        _id: updated._id,
        name: updated.name,
        baseUnit: updated.baseUnit,
        stockQty: updated.stockQty,
        delta,
      },
    });
  } catch (error) {
    next(error);
  }
};
