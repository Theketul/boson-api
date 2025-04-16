const express = require("express");
const router = express.Router();
const projectController = require("../controllers/projectController");
const sanitize = require("../config/sanitizer");
const { upload } = require("../utils/awsbucket");
const { protect, restrictTo } = require("../middlewares/authMiddleware");

router.post("/", sanitize(), protect, restrictTo("createProject"), upload.single("projectPicture"), projectController.createProject);
router.get("/", sanitize(), protect, restrictTo("viewAllProjects"), projectController.getAllProjects);
router.get("/search", sanitize(), protect, restrictTo("searchTasksAndProjects"), projectController.searchTasksAndProjects);
router.get("/:id", sanitize(), protect, restrictTo("projectDetails"), projectController.getProjectById);
router.get("/history/:projectId", sanitize(), protect, restrictTo("projectHistory"), projectController.getProjectHistory);
router.put("/:id", sanitize(), protect, restrictTo("updateProject"), upload.single("projectPicture"), projectController.updateProject);
router.delete("/:id", sanitize(), protect, restrictTo("deleteProject"), projectController.deleteProject);

module.exports = router;
