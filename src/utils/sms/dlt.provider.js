const axios = require("axios");

const ApiError = require("../ApiError");

const sendViaDLT = async ({ to, otp, templateName = "OTPNew" }) => {
  try {
    const mobile = to.startsWith("+91") ? to : `+91${to}`;

    const url =
      `https://2factor.in/API/V1/${process.env.DLT_API_KEY}` +
      `/SMS/${mobile}/${otp}/${templateName}`;

    console.log("DLT URL:", url); // ⭐ debug once

    const response = await axios.get(url);

    if (!response.data || response.data.Status !== "Success") {
      throw new ApiError("DLT SMS delivery failed", 502);
    }

    console.info("OTP sent", { mobile });

    return response.data;
  } catch (error) {
    console.log("DLT STATUS:", error.response?.status);
    console.log("DLT ERROR DATA:", error.response?.data);
    throw error;
  }
};

module.exports = { sendViaDLT };
