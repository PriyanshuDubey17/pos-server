const mongoose = require("mongoose");
const { Schema } = mongoose;

const SALE_STATUSES = ["completed", "voided"];

const saleLineItemSchema = new Schema(
  {
    menuItemId: {
      type: Schema.Types.ObjectId,
      ref: "MenuItem",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

/** Snapshot of base units deducted — used to restore stock on void */
const stockAdjustmentSchema = new Schema(
  {
    menuItemId: {
      type: Schema.Types.ObjectId,
      ref: "MenuItem",
      required: true,
    },
    baseQty: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const saleSchema = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },

    tokenNo: {
      type: Number,
      required: true,
      min: 1,
    },

    soldAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    items: {
      type: [saleLineItemSchema],
      required: true,
      validate: {
        validator(items) {
          return Array.isArray(items) && items.length > 0;
        },
        message: "Sale must have at least one line item",
      },
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: ["Cash", "UPI"],
      required: true,
    },

    status: {
      type: String,
      enum: SALE_STATUSES,
      required: true,
      default: "completed",
      index: true,
    },

    stockAdjustments: {
      type: [stockAdjustmentSchema],
      default: [],
    },

    voidedAt: {
      type: Date,
      default: null,
    },

    voidedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

saleSchema.index({ restaurantId: 1, soldAt: -1 });
saleSchema.index({ restaurantId: 1, tokenNo: 1, soldAt: 1 });

module.exports = mongoose.model("Sale", saleSchema);
module.exports.SALE_STATUSES = SALE_STATUSES;
