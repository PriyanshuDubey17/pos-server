const sgMail = require("@sendgrid/mail");


sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendViaSendgrid = async ({ to, subject, text, html }) => {
  try {
    await sgMail.send({
      to,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject,
      text,
      html
    });
  } catch (err) {
    console.error("SENDGRID_EMAIL_FAILED", {
      to,
      subject,
      error: err.message
    });
    throw err;
  }
};

module.exports = { sendViaSendgrid };
