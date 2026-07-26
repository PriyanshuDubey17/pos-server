const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["super_admin", "restaurant_admin"],
      required: true,
      index: true,
    },

    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      default: null,
      index: true,
    },

    profilePic: {
      type: String,
      default: null,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      lowercase: true,
      unique: true,
      sparse: true,
      index: true,
    },

    mobile: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },

    mobileVerified: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },

    reasonForRejection: {
      type: String,
    },

    lastLoginAt: {
      type: Date,
    },

    fcmToken: {
      type: String,
    },

    googleId: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("validate", function validateRoleRestaurantLink() {
  if (this.role === "restaurant_admin" && !this.restaurantId) {
    this.invalidate(
      "restaurantId",
      "restaurantId is required for restaurant_admin"
    );
  }
  if (this.role === "super_admin" && this.restaurantId) {
    this.invalidate(
      "restaurantId",
      "restaurantId must be null for super_admin"
    );
  }
});

module.exports = mongoose.model("User", userSchema);
