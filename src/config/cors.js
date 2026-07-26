const normalizeOrigin = (url) => {
  if (!url || typeof url !== "string") return null;
  return url.replace(/\/$/, "");
};

const allowedOrigins = [process.env.CLIENT_URL, process.env.ADMIN_URL]
  .map(normalizeOrigin)
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Postman / server-to-server / mobile clients (no Origin header)
    if (!origin) return callback(null, true);

    const requestOrigin = normalizeOrigin(origin);

    if (allowedOrigins.includes(requestOrigin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

module.exports = corsOptions;
