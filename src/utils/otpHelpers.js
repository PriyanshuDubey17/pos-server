const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Otp = require("../models/Otp");
const ApiError = require("./ApiError");

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 3;

const generateOtp = () => crypto.randomInt(100000, 999999).toString();
const hashOtp = async (otp) => bcrypt.hash(otp, 10);
const compareOtp = async (plainOtp, hashedOtp) => bcrypt.compare(plainOtp, hashedOtp);

const checkCooldownAndReplaceOtp = async ({ userId, purpose, phone, email }) => {
  if (!phone && !email) {
    throw new ApiError("Phone or email is required for OTP", 400);
  }

  const existingOtp = await Otp.findOne({ userId, purpose });

  if (existingOtp) {
    const secondsSinceCreated =
      (Date.now() - new Date(existingOtp.createdAt).getTime()) / 1000;
    if (secondsSinceCreated < COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(COOLDOWN_SECONDS - secondsSinceCreated);
      throw new ApiError(
        `Please wait ${waitSeconds} seconds before requesting a new OTP.`,
        429,
      );
    }
    await Otp.deleteOne({ _id: existingOtp._id });
  }

  const plainOtp = generateOtp();
  const hashedOtp = await hashOtp(plainOtp);

  await Otp.create({
    userId,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    otp: hashedOtp,
    purpose,
    attempts: 0,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
  });

  return plainOtp;
};

const verifyOtpDoc = async ({ userId, purpose, otp }) => {
  const otpDoc = await Otp.findOne({ userId, purpose });

  if (!otpDoc) {
    throw new ApiError("No OTP found. Please request a new one.", 400);
  }

  if (new Date() > new Date(otpDoc.expiresAt)) {
    await Otp.deleteOne({ _id: otpDoc._id });
    throw new ApiError("OTP has expired. Please request a new one.", 410);
  }

  if (otpDoc.attempts >= MAX_ATTEMPTS) {
    await Otp.deleteOne({ _id: otpDoc._id });
    throw new ApiError("Too many wrong attempts. OTP invalidated.", 429);
  }

  const isMatch = await compareOtp(otp, otpDoc.otp);

  if (!isMatch) {
    const updatedOtpDoc = await Otp.findOneAndUpdate(
      { _id: otpDoc._id },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );

    if (!updatedOtpDoc) {
      throw new ApiError("OTP session expired. Request a new OTP.", 401);
    }

    const remaining = MAX_ATTEMPTS - updatedOtpDoc.attempts;
    if (remaining <= 0) {
      await Otp.deleteOne({ _id: otpDoc._id });
      throw new ApiError("Invalid OTP. All attempts used. Request a new OTP.", 401);
    }
    throw new ApiError(`Invalid OTP. ${remaining} attempt(s) remaining.`, 401);
  }

  await Otp.deleteOne({ _id: otpDoc._id });
  return otpDoc;
};

module.exports = {
  generateOtp,
  hashOtp,
  compareOtp,
  checkCooldownAndReplaceOtp,
  verifyOtpDoc,
  OTP_EXPIRY_MS,
  COOLDOWN_SECONDS,
};
