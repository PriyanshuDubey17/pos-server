const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.ADMIN_URL
];

const corsOptions = {
  origin: function (origin, callback) {
    // Postman / server-to-server requests (no origin)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
};

module.exports = corsOptions;
