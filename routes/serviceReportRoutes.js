const express = require("express");
const router = express.Router();
const serviceReportController = require("../controllers/serviceReportController");
const sanitize = require("../config/sanitizer");
const { upload } = require("../utils/awsbucket");
const { protect, restrictTo } = require("../middlewares/authMiddleware");

router.get("/:reportId", sanitize(), protect, restrictTo("serviceReport"), serviceReportController.getFullServiceReport);
router.post("/:reportId", sanitize(), protect, restrictTo("serviceReport"), serviceReportController.updateServiceReport);

module.exports = router;
