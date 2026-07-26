const mongoose = require("mongoose");
const { Schema } = mongoose;
const { ACCESS_PLANS } = require("../constants/accessPlans");

const printerSettingsSchema = new Schema(
  {
    paperWidth: {
      type: String,
      enum: ["58", "80"],
      default: "58",
    },
    autoPrintOnConfirm: {
      type: Boolean,
      default: true,
    },
    isPaired: {
      type: Boolean,
      default: false,
    },
    deviceLabel: {
      type: String,
      trim: true,
      default: null,
    },
    /** How many identical receipt slips to show/print per sale (same token) */
    receiptCopies: {
      type: Number,
      enum: [1, 2],
      default: 1,
    },
  },
  { _id: false }
);

const restaurantSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
    },

    accessPlan: {
      type: String,
      enum: ACCESS_PLANS,
      default: "full",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "active", "suspended"],
      default: "active",
      index: true,
    },

    /** Business day key YYYY-MM-DD for daily token reset */
    tokenDate: {
      type: String,
      default: null,
    },

    lastTokenNo: {
      type: Number,
      default: 0,
      min: 0,
    },

    printerSettings: {
      type: printerSettingsSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

restaurantSchema.index({ name: 1 });

module.exports = mongoose.model("Restaurant", restaurantSchema);
