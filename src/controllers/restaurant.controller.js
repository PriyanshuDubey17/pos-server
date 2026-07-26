const mongoose = require("mongoose");

const Restaurant = require("../models/Restaurant");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");

/* ==========================================================
 *  Restaurant — super_admin onboard / manage
 * ========================================================== */

const OWNER_SELECT = "name mobile email status role restaurantId lastLoginAt";

const formatOwner = (owner) => {
  if (!owner) return null;
  return {
    _id: owner._id,
    name: owner.name,
    mobile: owner.mobile,
    email: owner.email || null,
    status: owner.status,
    role: owner.role,
    restaurantId: owner.restaurantId || null,
    lastLoginAt: owner.lastLoginAt || null,
  };
};

const throwDuplicateOwnerError = (err) => {
  if (err?.code !== 11000) return false;
  const field = Object.keys(err.keyValue || {})[0] || "field";
  if (field === "mobile") {
    throw new ApiError(
      "An account with this mobile number already exists.",
      409,
    );
  }
  if (field === "email") {
    throw new ApiError("Owner login email already used.", 409);
  }
  throw new ApiError(`Duplicate value for "${field}".`, 409);
};

/**
 * Create restaurant + restaurant_admin owner, then link ownerUserId.
 * Prefers a Mongo transaction; falls back to compensating delete if
 * the deployment does not support transactions (standalone Mongo).
 */
const createRestaurantWithOwner = async ({
  name,
  accessPlan,
  status,
  phone,
  email,
  owner,
}) => {
  const existingOwner = await User.findOne({ mobile: owner.mobile }).select(
    "_id mobile",
  );
  if (existingOwner) {
    throw new ApiError(
      "An account with this mobile number already exists.",
      409,
    );
  }

  if (owner.email) {
    const existingEmail = await User.findOne({ email: owner.email }).select(
      "_id email",
    );
    if (existingEmail) {
      throw new ApiError("Owner login email already used.", 409);
    }
  }

  const restaurantPayload = {
    name,
    accessPlan,
    status,
    phone: phone || owner.mobile || undefined,
    email: email || owner.email || undefined,
  };

  const ownerPayload = {
    role: "restaurant_admin",
    name: owner.name,
    mobile: owner.mobile,
    email: owner.email || undefined,
    status: "active",
    mobileVerified: true,
  };

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const [restaurant] = await Restaurant.create([restaurantPayload], {
      session,
    });

    const [ownerUser] = await User.create(
      [{ ...ownerPayload, restaurantId: restaurant._id }],
      { session },
    );

    restaurant.ownerUserId = ownerUser._id;
    await restaurant.save({ session });

    await session.commitTransaction();
    return { restaurant, owner: ownerUser };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    const isTxnUnsupported =
      err?.code === 20 ||
      /Transaction numbers are only allowed/i.test(err?.message || "");

    if (!isTxnUnsupported) {
      throwDuplicateOwnerError(err);
      throw err;
    }
  } finally {
    session.endSession();
  }

  // Fallback for standalone Mongo (no replica set)
  const restaurant = await Restaurant.create(restaurantPayload);
  try {
    const ownerUser = await User.create({
      ...ownerPayload,
      restaurantId: restaurant._id,
    });
    restaurant.ownerUserId = ownerUser._id;
    await restaurant.save();
    return { restaurant, owner: ownerUser };
  } catch (err) {
    await Restaurant.deleteOne({ _id: restaurant._id });
    throwDuplicateOwnerError(err);
    throw err;
  }
};

/* ─────────────────────────────────────────────────────────
   POST /api/restaurants
   ───────────────────────────────────────────────────────── */

const createRestaurant = async (req, res, next) => {
  try {
    const { restaurant, owner } = await createRestaurantWithOwner(req.body);

    const response = new ApiResponse(201, "Restaurant onboarded successfully", {
      restaurant,
      owner: formatOwner(owner),
    });
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /api/restaurants
   ───────────────────────────────────────────────────────── */

const listRestaurants = async (req, res, next) => {
  try {
    const { status, accessPlan, search } = req.validatedQuery || {};
    const filter = {};

    if (status) filter.status = status;
    if (accessPlan) filter.accessPlan = accessPlan;
    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    const restaurants = await Restaurant.find(filter)
      .populate("ownerUserId", OWNER_SELECT)
      .sort({ createdAt: -1 })
      .lean();

    const response = new ApiResponse(200, "Restaurants fetched successfully", {
      restaurants: restaurants.map((doc) => ({
        ...doc,
        ownerUserId: formatOwner(doc.ownerUserId),
      })),
    });
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /api/restaurants/stats
   ───────────────────────────────────────────────────────── */

const getRestaurantStats = async (req, res, next) => {
  try {
    const rows = await Restaurant.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const byStatus = Object.fromEntries(
      rows.map((row) => [row._id, Number(row.count) || 0]),
    );

    const active = byStatus.active || 0;
    const suspended = byStatus.suspended || 0;
    const pending = byStatus.pending || 0;
    const total = rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);

    const response = new ApiResponse(200, "Restaurant stats fetched successfully", {
      total,
      active,
      suspended,
      pending,
    });
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /api/restaurants/:restaurantId
   ───────────────────────────────────────────────────────── */

const getRestaurantById = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;

    const restaurant = await Restaurant.findById(restaurantId)
      .populate("ownerUserId", OWNER_SELECT)
      .lean();

    if (!restaurant) {
      return next(new ApiError("Restaurant not found", 404));
    }

    const response = new ApiResponse(200, "Restaurant fetched successfully", {
      restaurant: {
        ...restaurant,
        ownerUserId: formatOwner(restaurant.ownerUserId),
      },
    });
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────
   PATCH /api/restaurants/:restaurantId
   ───────────────────────────────────────────────────────── */

const updateRestaurant = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { owner, ...restaurantUpdates } = req.body;

    const existing = await Restaurant.findById(restaurantId);
    if (!existing) {
      return next(new ApiError("Restaurant not found", 404));
    }

    // Owner first — fail before touching restaurant fields
    if (owner && existing.ownerUserId) {
      const ownerUser = await User.findById(existing.ownerUserId);
      if (!ownerUser) {
        return next(new ApiError("Restaurant owner not found", 404));
      }

      if (owner.mobile && owner.mobile !== ownerUser.mobile) {
        const mobileTaken = await User.findOne({
          mobile: owner.mobile,
          _id: { $ne: ownerUser._id },
        }).select("_id");
        if (mobileTaken) {
          return next(
            new ApiError(
              "An account with this mobile number already exists.",
              409,
            ),
          );
        }
        ownerUser.mobile = owner.mobile;
      }

      if (owner.name) {
        ownerUser.name = owner.name;
      }

      if (Object.prototype.hasOwnProperty.call(owner, "email")) {
        const nextEmail = owner.email || null;
        if (nextEmail && nextEmail !== ownerUser.email) {
          const emailTaken = await User.findOne({
            email: nextEmail,
            _id: { $ne: ownerUser._id },
          }).select("_id");
          if (emailTaken) {
            return next(new ApiError("Owner login email already used.", 409));
          }
        }
        if (nextEmail) {
          ownerUser.email = nextEmail;
        } else {
          ownerUser.email = undefined;
        }
      }

      try {
        await ownerUser.save();
        if (
          owner &&
          Object.prototype.hasOwnProperty.call(owner, "email") &&
          !(owner.email || null)
        ) {
          await User.updateOne(
            { _id: ownerUser._id },
            { $unset: { email: 1 } },
          );
        }
      } catch (err) {
        throwDuplicateOwnerError(err);
        throw err;
      }
    }

    if (Object.keys(restaurantUpdates).length > 0) {
      const unsetFields = {};
      for (const [key, value] of Object.entries(restaurantUpdates)) {
        if (value === null && (key === "phone" || key === "email")) {
          unsetFields[key] = 1;
          existing[key] = undefined;
        } else {
          existing[key] = value;
        }
      }
      await existing.save();
      if (Object.keys(unsetFields).length > 0) {
        await Restaurant.updateOne(
          { _id: existing._id },
          { $unset: unsetFields },
        );
      }
    }

    const restaurant = await Restaurant.findById(restaurantId).populate(
      "ownerUserId",
      OWNER_SELECT,
    );

    const response = new ApiResponse(200, "Restaurant updated successfully", {
      restaurant: {
        ...restaurant.toObject(),
        ownerUserId: formatOwner(restaurant.ownerUserId),
      },
    });
    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 11000) {
      try {
        throwDuplicateOwnerError(error);
      } catch (mapped) {
        return next(mapped);
      }
    }
    next(error);
  }
};

module.exports = {
  createRestaurant,
  listRestaurants,
  getRestaurantStats,
  getRestaurantById,
  updateRestaurant,
};
