const crypto = require("crypto");

const resolvePlayReviewPhone = () => (process.env.PLAY_REVIEW_PHONE || "").trim();
const resolvePlayReviewOtp = () => (process.env.PLAY_REVIEW_OTP || "").trim();

const isPlayReviewConfigured = () => {
  const phone = resolvePlayReviewPhone();
  const otp = resolvePlayReviewOtp();
  return /^\d{10}$/.test(phone) && /^\d{6}$/.test(otp);
};

const isPlayReviewPhone = (phone) => {
  if (!isPlayReviewConfigured()) return false;
  return (phone || "").trim() === resolvePlayReviewPhone();
};

const matchesPlayReviewOtp = (otp) => {
  if (!isPlayReviewConfigured()) return false;
  const submitted = (otp || "").trim();
  const expected = resolvePlayReviewOtp();
  if (submitted.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(submitted, "utf8"),
    Buffer.from(expected, "utf8"),
  );
};

module.exports = {
  isPlayReviewConfigured,
  isPlayReviewPhone,
  matchesPlayReviewOtp,
  resolvePlayReviewPhone,
};
