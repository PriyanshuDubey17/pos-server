// scripts/script.js — seed first super_admin
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});
const mongoose = require("mongoose");
const User = require("../src/models/User");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const exists = await User.findOne({
    role: { $in: ["super_admin", "admin"] },
  });
  if (exists) {
    if (exists.role === "admin") {
      exists.role = "super_admin";
      exists.restaurantId = null;
      await exists.save();
      console.log("Legacy admin upgraded to super_admin");
    } else {
      console.log("Super admin already exists");
    }
    process.exit(0);
  }

  await User.create({
    name: "Super Admin",
    email: "pd@orangecapmedia.com",
    mobile: "6204239578",
    role: "super_admin",
    restaurantId: null,
    status: "active",
    emailVerified: true,
    mobileVerified: true,
  });

  console.log("Super admin created");
  process.exit(0);
})();
