// const nodemailer = require("nodemailer");


// const transporter = nodemailer.createTransport({
//   host: "smtp.gmail.com",
//   port: 465,
//   secure: true,
//   auth: {
//     type: "OAuth2",
//     user: process.env.SENDER_EMAIL_ADDRESS,
//     clientId: process.env.CLIENT_ID,
//     clientSecret: process.env.CLIENT_SECRET,
//     refreshToken: process.env.GMAIL_REFRESH_TOKEN
//   }
// });

// const sendViaGmail = async ({ to, subject, text, html }) => {
//   try {
//     await transporter.sendMail({
//       from: `"Flat X" <${process.env.SENDER_EMAIL_ADDRESS}>`,
//       to,
//       subject,
//       text,
//       html
//     });
//   } catch (err) {
//     console.error("GMAIL_EMAIL_FAILED", {
//       to,
//       subject,
//       error: err.message
//     });
//     throw err;
//   }
// };

// module.exports = { sendViaGmail };




const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail", // Direct 'gmail' likhna behtar hai
  host: "smtp.gmail.com",
  port: 465,        // Port 465 secure connection ke liye best hai
  secure: true,      // 465 ke liye true rakhein
  auth: {
    user: "priyanshudubey551@gmail.com",
    pass: "vpwt hmtu yidb zlvo", // Aapka 16-digit App Password
  },
});

async function sendViaGmail({ to, subject, text, html }) {
  try {
    const info = await transporter.sendMail({
      from: '"Flat X" <priyanshudubey551@gmail.com>',
      to,
      subject,
      text,
      html,
    });
    return info;
  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
}

module.exports = { sendViaGmail };