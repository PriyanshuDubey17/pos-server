const express = require("express");
const router = express.Router();

const {
  getPosMenu,
  confirmSale,
  updateReceiptCopies,
  listSales,
  getSaleReceipt,
  voidSale,
} = require("../controllers/sale.controller");
const {
  validate,
  validateQuery,
  validateParams,
  confirmSaleSchema,
  updateReceiptCopiesSchema,
  listSalesQuerySchema,
  saleIdParamSchema,
} = require("../validators/sale.validator");
const { authGeneralLimiter } = require("../middlewares/rateLimiter");
const { requirePosAccess } = require("../middlewares/requirePosAccess");

router.use(requirePosAccess);

router.get("/pos-menu", getPosMenu);
router.get("/", validateQuery(listSalesQuerySchema), listSales);
router.get(
  "/:id/receipt",
  validateParams(saleIdParamSchema),
  getSaleReceipt,
);
router.post(
  "/:id/void",
  authGeneralLimiter,
  validateParams(saleIdParamSchema),
  voidSale,
);
router.patch(
  "/receipt-copies",
  authGeneralLimiter,
  validate(updateReceiptCopiesSchema),
  updateReceiptCopies,
);
router.post(
  "/confirm",
  authGeneralLimiter,
  validate(confirmSaleSchema),
  confirmSale,
);

module.exports = router;
