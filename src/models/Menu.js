const mongoose = require("mongoose");
const { Schema } = mongoose;

/* =========================================================
   CATEGORY SCHEMA
========================================================= */
const categorySchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    image: String,
    imagePublicId: String,

    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["normal", "recommended", "special"],
      default: "normal",
    },
  },
  { timestamps: true }
);

// Unique category name per restaurant (case-insensitive)
categorySchema.index(
  { restaurantId: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

/* =========================================================
   VARIANTS
========================================================= */
const variantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true }, // Small / Medium / Large

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true }
);

/* =========================================================
   MENU ITEM
========================================================= */
const menuItemSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      maxlength: 2000,
    },

    // Base price (used when no variants)
    price: {
      type: Number,
      min: 0,
    },

    // VARIANTS (if present, price ignored)
    variants: {
      type: [variantSchema],
      default: [],
    },

    image: String,
    imagePublicId: String,

    isVeg: {
      type: Boolean,
      required: true,
      index: true,
    },

    isAvailable: {
      type: Boolean,
      default: true,
      index: true,
    },

    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

/* =========================================================
   INDEXES
========================================================= */

menuItemSchema.index({ restaurantId: 1, category: 1, displayOrder: 1 });
menuItemSchema.index({ restaurantId: 1, isAvailable: 1 });

menuItemSchema.index({
  name: "text",
  description: "text",
});

// Unique item name within restaurant + category (including archived)
menuItemSchema.index(
  { restaurantId: 1, name: 1, category: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
  }
);

/* =========================================================
   VALIDATIONS
   ─────────────────────────────────────────────────────────
   NOTE: All validation (price/variants XOR, default variant
   limit) is now handled at the Zod and
   Controller layers. Mongoose hooks have been removed.
========================================================= */

/* =========================================================
   MODELS
========================================================= */
const Category = mongoose.model("Category", categorySchema);
const MenuItem = mongoose.model("MenuItem", menuItemSchema);

module.exports = { Category, MenuItem };