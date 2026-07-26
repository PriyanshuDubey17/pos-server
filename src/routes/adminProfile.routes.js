const express = require("express");
const router = express.Router();

const {
  getCloudinarySignature,
  sendUpdateOtp,
  verifyAndUpdateProfile,
  updateProfilePic
} = require("../controllers/adminProfile.controller");

const { authGeneralLimiter } = require("../middlewares/rateLimiter");

// All routes are protected and authorized to panel roles in app.js mounting

// Cloudinary signature for profile pic upload
router.get("/signature", getCloudinarySignature);

// Update profile pic URL after Cloudinary upload
router.put("/update-profile-pic", updateProfilePic);

// OTP Flow for profile info update
router.post("/send-update-otp", authGeneralLimiter, sendUpdateOtp);
router.put("/update-profile", authGeneralLimiter, verifyAndUpdateProfile);

module.exports = router;
