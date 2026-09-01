const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
});
const mongoose = require("mongoose");

const User = require("../src/models/User");
const Restaurant = require("../src/models/Restaurant");
const { Category, MenuItem } = require("../src/models/Menu");
const { resolvePlayReviewPhone } = require("../src/utils/playReviewLogin");

const PLAY_REVIEW_MOBILE = resolvePlayReviewPhone() || "9999999999";

const seedMenu = async (restaurantId) => {
  const existingCategory = await Category.findOne({
    restaurantId,
    name: "Snacks",
  });
  if (existingCategory) {
    console.log("Play review menu already exists");
    return;
  }

  const category = await Category.create({
    restaurantId,
    name: "Snacks",
    displayOrder: 0,
    isActive: true,
    type: "normal",
  });

  await MenuItem.create([
    {
      restaurantId,
      category: category._id,
      name: "Masala Tea",
      price: 20,
      isVeg: true,
      isAvailable: true,
      displayOrder: 0,
      stockEnabled: false,
    },
    {
      restaurantId,
      category: category._id,
      name: "Samosa",
      price: 25,
      isVeg: true,
      isAvailable: true,
      displayOrder: 1,
      stockEnabled: false,
    },
    {
      restaurantId,
      category: category._id,
      name: "Veg Puff",
      price: 30,
      isVeg: true,
      isAvailable: true,
      displayOrder: 2,
      stockEnabled: false,
    },
  ]);

  console.log("Play review menu seeded");
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const existingOwner = await User.findOne({ mobile: PLAY_REVIEW_MOBILE });
  if (existingOwner) {
    if (existingOwner.role === "restaurant_admin" && existingOwner.restaurantId) {
      await seedMenu(existingOwner.restaurantId);
      console.log("Play review restaurant already exists");
      await mongoose.disconnect();
      process.exit(0);
    }
    console.error(
      "Mobile",
      PLAY_REVIEW_MOBILE,
      "is already used by a non-review account. Pick another PLAY_REVIEW_PHONE.",
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const restaurant = await Restaurant.create({
    name: "Play Review Demo",
    accessPlan: "full",
    status: "active",
    phone: PLAY_REVIEW_MOBILE,
  });

  try {
    const ownerUser = await User.create({
      role: "restaurant_admin",
      name: "Play Reviewer",
      mobile: PLAY_REVIEW_MOBILE,
      restaurantId: restaurant._id,
      status: "active",
      mobileVerified: true,
    });
    restaurant.ownerUserId = ownerUser._id;
    await restaurant.save();
  } catch (err) {
    await Restaurant.deleteOne({ _id: restaurant._id });
    throw err;
  }

  await seedMenu(restaurant._id);
  console.log("Play review restaurant created for", PLAY_REVIEW_MOBILE);
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_disconnectErr) {
    /* ignore */
  }
  process.exit(1);
});
