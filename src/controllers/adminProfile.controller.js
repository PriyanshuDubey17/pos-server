const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { sendSMS } = require("../utils/sms/sms.service");
const { cloudinary, deleteImageFromCloudinary } = require("../utils/cloudinary");
const {
  checkCooldownAndReplaceOtp,
  verifyOtpDoc,
} = require("../utils/otpHelpers");

/* ==========================================================
 *  Cloudinary Signature for Profile Pictures
 * ========================================================== */
exports.getCloudinarySignature = (req, res, next) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = "restaurant/admin/profile_pics";

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
 *  Update Profile Picture
 * ========================================================== */
exports.updateProfilePic = async (req, res, next) => {
  try {
    const { url, publicId } = req.body;
    const userId = req.user._id; 

    if (!url) {
      return next(new ApiError("Image URL is required", 400));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new ApiError("User not found", 404));
    }

    // Delete old profile pic from Cloudinary if exists
    // The current User schema just stores `profilePic` as String url
    // If they were storing publicId, we'd delete it. We'll try to extract it from URL.
    if (user.profilePic) {
      try {
        const oldUrl = user.profilePic;
        const matches = oldUrl.match(/\/v\d+\/([^/]+\/[^/]+)\.\w+$/);
        if (matches && matches[1]) {
           await deleteImageFromCloudinary(matches[1]);
        }
      } catch (e) {
        console.warn("Failed to delete old profile pic from Cloudinary:", e);
      }
    }

    user.profilePic = url;
    await user.save();

    const response = new ApiResponse(200, "Profile picture updated successfully", {
      profilePic: url
    });
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Send OTP for Profile Update
 * ========================================================== */
exports.sendUpdateOtp = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Use current user's active mobile number to send OTP
    const user = await User.findById(userId);
    if (!user) {
      return next(new ApiError("User not found", 404));
    }
    const phone = user.mobile;

    const plainOtp = await checkCooldownAndReplaceOtp({
      userId: user._id,
      purpose: "profile_update",
      phone,
    });

    // Send SMS
    if (process.env.NODE_ENV === "development") {
      console.log(`\n🔑 [DEV] PROFILE UPDATE OTP for ${phone}: ${plainOtp}\n`);
    }

    try {
      await sendSMS({
        to: phone,
        otp: plainOtp,
        message: `Your OTP to update your profile is: ${plainOtp}. Valid for 10 minutes.`,
        templateName: "OTPNew", // adjust template as needed
      });
    } catch (smsError) {
      if (process.env.NODE_ENV !== "development") {
        return next(new ApiError("Failed to send OTP. Try again later.", 502));
      }
      console.warn("⚠️ SMS send failed (dev mode, proceeding):", smsError.message);
    }

    res.status(200).json(new ApiResponse(200, "OTP sent successfully to registered mobile number"));
  } catch (error) {
    next(error);
  }
};

/* ==========================================================
 *  Verify OTP & Update Profile
 * ========================================================== */
exports.verifyAndUpdateProfile = async (req, res, next) => {
  try {
    const { otp, name, email, mobile } = req.body;
    const userId = req.user._id;

    if (!otp) {
      return next(new ApiError("OTP is required", 400));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new ApiError("User not found", 404));
    }

    await verifyOtpDoc({
      userId: user._id,
      purpose: "profile_update",
      otp,
    });

    // Check uniqueness for email and mobile if changed
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: userId } });
      if (emailExists) return next(new ApiError("Email already in use", 400));
      user.email = email;
    }

    if (mobile && mobile !== user.mobile) {
      const mobileExists = await User.findOne({ mobile, _id: { $ne: userId } });
      if (mobileExists) return next(new ApiError("Mobile number already in use", 400));
      user.mobile = mobile;
    }

    if (name) {
      user.name = name;
    }

    await user.save();

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      profilePic: user.profilePic,
    };

    res.status(200).json(new ApiResponse(200, "Profile updated successfully", { user: userData }));
  } catch (error) {
    next(error);
  }
};
