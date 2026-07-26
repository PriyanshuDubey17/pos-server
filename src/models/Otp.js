const mongoose = require("mongoose");

/* ==========================================================
 *  OTP Model — Shared admin auth / profile flows
 * ==========================================================
 *
 *  Stores hashed OTP with automatic expiry (TTL index).
 *  userId links to the User who requested this OTP.
 *  purpose differentiates between auth and profile flows.
 *
 *  SECURITY:
 *  - OTP is bcrypt hashed — never stored in plain text
 *  - Max 3 wrong attempts → OTP invalidated
 *  - TTL index auto-deletes document after expiresAt
 *  - Deleted immediately on successful verification
 * ========================================================== */

const otpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    phone: {
      type: String,
      index: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
    },

    otp: {
      type: String, // bcrypt hashed — never plain text
      required: true,
    },

    purpose: {
      type: String,
      enum: [
        "login",
        "signup",
        "profile_update",
        "mobile_verify",
        "mobile_change",
        "email_verify",
        "email_add",
        "email_change",
        "name_change",
      ],
      required: true,
    },

    attempts: {
      type: Number,
      default: 0,
      max: 3,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL — mongo deletes when Date passes
    },
  },
  {
    timestamps: true, // createdAt auto-generated
  },
);

otpSchema.pre("validate", function () {
  if (!this.phone && !this.email) {
    throw new Error("Either phone or email is required for OTP");
  }
});

/* ── Compound index for fast lookup ── */
otpSchema.index({ userId: 1, purpose: 1 });

module.exports = mongoose.model("Otp", otpSchema);
