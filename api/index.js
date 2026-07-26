require("dotenv").config();

const app = require("../app");
const connectDB = require("../src/config/db");

/**
 * Vercel serverless entry — no listen().
 * Connect Mongo (cached), then hand the request to Express.
 * Do not return app(req, res); Express finishes via res, which Vercel tracks.
 */
module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Database unavailable",
    });
    return;
  }

  app(req, res);
};
