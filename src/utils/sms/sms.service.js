const ApiError = require("../ApiError");

const sendSMS = async ({ to, message, otp, templateName }) => {
  const provider = process.env.SMS_PROVIDER;

  if (provider === "twilio") {
    const { sendViaTwilio } = require("./twilio.provider");

    // Twilio ko sirf message chahiye
    return sendViaTwilio({ to, message });
  }

  if (provider === "dlt") {
    const { sendViaDLT } = require("./dlt.provider");

    // DLT ko otp chahiye
    return sendViaDLT({ to, otp, templateName });
  }

  throw new ApiError("Invalid SMS_PROVIDER configuration", 500);
};

module.exports = { sendSMS };
