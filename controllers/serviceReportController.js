const ServiceReport = require("../models/serviceReportModel");

exports.updateServiceReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const formData = req.body.formData || req.body;
    const dateOfVisit = req.body.dateOfVisit ? new Date(req.body.dateOfVisit) : new Date();
    const filledBy = req.body.filledBy || req.user._id;

    const report = await ServiceReport.findById(reportId);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    report.data = formData;
    report.updatedBy = req.user._id;
    report.filledBy = filledBy;
    report.dateOfVisit = dateOfVisit;
    report.updatedAt = new Date();

    await report.save();

    return res.status(200).json({
      success: true,
      message: "Service report updated",
      data: report,
    });
  } catch (error) {
    console.error("Error updating service report:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getFullServiceReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await ServiceReport.findById(reportId)
      .populate("filledBy", "name profilePicture")
      .populate({
        path: "task",
        select: "name projectStage status primaryOwner startDate endDate project",
        populate: [
          { path: "primaryOwner", select: "name email phone" },
          { path: "updatedBy", select: "name" },
          { 
            path: "project", 
            select: "name product clients", // include clients in the select
            populate: [
              { path: "product", select: "name productPicture" },
              { path: "clients", select: "name contactNumber" }
            ]
          }
        ]
      })
      .lean();

    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Service report fetched successfully",
      data: report,
    });
  } catch (error) {
    console.error("Error fetching service report:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
