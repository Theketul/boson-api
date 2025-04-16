const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");
const sanitize = require("../config/sanitizer");
const { protect, restrictTo } = require("../middlewares/authMiddleware");

router.patch("/add/:projectId",sanitize(),protect,restrictTo("addClient"),clientController.addClientToProject);
router.put("/:clientId",sanitize(),protect,restrictTo("updateClient"),clientController.updateClient);
router.delete("/:clientId",sanitize(),protect,restrictTo("deleteClient"),clientController.deleteClient);

module.exports = router;
