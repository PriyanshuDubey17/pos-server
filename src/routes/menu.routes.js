const express = require("express");
const router = express.Router();

const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getMenuItems,
  getMenuItemStats,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  restoreMenuItem,
  getCloudinarySignature,
} = require("../controllers/menu.controller");

const {
  validate,
  validateQuery,
  createCategorySchema,
  updateCategorySchema,
  createMenuItemSchema,
  updateMenuItemSchema,
  listMenuItemsQuerySchema,
} = require("../validators/menu.validator");

const { authGeneralLimiter } = require("../middlewares/rateLimiter");
const { requireMenuWrite } = require("../middlewares/requireMenuWrite");

router.get("/upload/signature", getCloudinarySignature);

/* ==========================================================
 *  Categories
 * ========================================================== */

router
  .route("/categories")
  .get(getCategories)
  .post(
    authGeneralLimiter,
    requireMenuWrite,
    validate(createCategorySchema),
    createCategory,
  );

router
  .route("/categories/:id")
  .put(
    authGeneralLimiter,
    requireMenuWrite,
    validate(updateCategorySchema),
    updateCategory,
  )
  .delete(authGeneralLimiter, requireMenuWrite, deleteCategory);

/* ==========================================================
 *  Menu Items
 * ========================================================== */

router.get(
  "/items/stats",
  validateQuery(listMenuItemsQuerySchema),
  getMenuItemStats,
);

router
  .route("/items")
  .get(validateQuery(listMenuItemsQuerySchema), getMenuItems)
  .post(
    authGeneralLimiter,
    requireMenuWrite,
    validate(createMenuItemSchema),
    createMenuItem,
  );

router.post(
  "/items/:id/restore",
  authGeneralLimiter,
  requireMenuWrite,
  restoreMenuItem,
);

router
  .route("/items/:id")
  .put(
    authGeneralLimiter,
    requireMenuWrite,
    validate(updateMenuItemSchema),
    updateMenuItem,
  )
  .delete(authGeneralLimiter, requireMenuWrite, deleteMenuItem);

module.exports = router;
