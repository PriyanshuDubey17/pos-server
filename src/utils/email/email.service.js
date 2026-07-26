const ApiError = require("../../utils/ApiError");

const sendEmail = async ({ to, subject, text, html }) => {
  const provider = process.env.EMAIL_PROVIDER;

  if (provider === "gmail") {
    const { sendViaGmail } = require("./gmail.provider");
    return sendViaGmail({ to, subject, text, html });
  }

  if (provider === "sendgrid") {
    const { sendViaSendgrid } = require("./sendgrid.provider");
    return sendViaSendgrid({ to, subject, text, html });
  }

  throw new ApiError("Invalid EMAIL_PROVIDER configuration", 500);
};

module.exports = { sendEmail };
 