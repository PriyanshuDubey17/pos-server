const twilio = require("twilio");


const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

const sendViaTwilio = async ({ to, message }) => {
  try {
    const phone = to.startsWith("+") ? to : `+91${to}`;

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
  } catch (err) {
    console.error("TWILIO_SMS_FAILED", {
      to,
      error: err.message,
    });
    throw err;
  }
};

module.exports = { sendViaTwilio };
