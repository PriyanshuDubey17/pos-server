const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const corsOptions = require("./src/config/cors");
const errorHandler = require("./src/middlewares/errorHandler");
const ApiError = require("./src/utils/ApiError");
const app = express();
const cookieParser = require("cookie-parser");

app.use(helmet());
app.use(cors(corsOptions));

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

/* ── Routes ── */
const adminLoginRoutes = require("./src/routes/adminLogin.routes");
const restaurantRoutes = require("./src/routes/restaurant.routes");
const menuRoutes = require("./src/routes/menu.routes");
const saleRoutes = require("./src/routes/sale.routes");
const reportRoutes = require("./src/routes/report.routes");
const adminProfileRoutes = require("./src/routes/adminProfile.routes");
const { authGeneralLimiter } = require("./src/middlewares/rateLimiter");
const { protectAdmin, authorizeRole } = require("./src/middlewares/auth.middleware");

app.use("/api/admin-login", authGeneralLimiter, adminLoginRoutes);
app.use(
  "/api/restaurants",
  protectAdmin,
  authorizeRole("super_admin"),
  restaurantRoutes,
);
app.use("/api/menu", protectAdmin, authorizeRole("restaurant_admin"), menuRoutes);
app.use(
  "/api/sales",
  protectAdmin,
  authorizeRole("restaurant_admin"),
  saleRoutes,
);
app.use(
  "/api/reports",
  protectAdmin,
  authorizeRole("restaurant_admin"),
  reportRoutes,
);
app.use("/api/admin/profile", protectAdmin, authorizeRole("super_admin", "restaurant_admin"), adminProfileRoutes);

// 404 handler
app.use((req, res, next) => {
  next(new ApiError("Route not found", 404));
});

// error handler
app.use(errorHandler);

module.exports = app;
