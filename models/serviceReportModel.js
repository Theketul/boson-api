const mongoose = require("mongoose");

const ServiceReportSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Task",
    required: true,
    unique: true, // If you only want one report per task
  },
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Forms", // references the 9 form templates
    required: false,
  },
  formName: {
    type: String,
    default: "No Service Form Required",
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  filledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  dateOfVisit: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ServiceReport", ServiceReportSchema);
