const express = require("express");
const authRoutes = require("./authRoutes");
const projectRoutes = require("./projectRoutes");
const taskRoutes = require("./taskRoutes");
const dropdownRoutes = require("./dropdownRoutes");
const productRoutes = require("./productRoutes");
const clientRoutes = require("./clientRoutes");
const serviceReportRoutes = require("./serviceReportRoutes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/projects", projectRoutes);
router.use("/tasks", taskRoutes);
router.use("/dropdowns", dropdownRoutes); 
router.use("/product", productRoutes); 
router.use("/client", clientRoutes); 
router.use("/report", serviceReportRoutes); 

module.exports = router;