const express = require("express");
const router = express.Router();

const {
  getReportSummary,
  getSetupStatus,
} = require("../controllers/report.controller");
const {
  reportSummaryQuerySchema,
  validateQuery,
} = require("../validators/report.validator");
const { requireReportsAccess } = require("../middlewares/requireReportsAccess");

router.use(requireReportsAccess);

router.get(
  "/summary",
  validateQuery(reportSummaryQuerySchema),
  getReportSummary,
);

router.get("/setup-status", getSetupStatus);

module.exports = router;
