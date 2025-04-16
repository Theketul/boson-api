const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    projectStage: {
      type: String,
      enum: ["Pre-requisites", "Installation & Commissioning", "Maintenance"],
      required: true,
    },
    status: {
      type: String,
      enum: ["To-do", "On-going", "Delayed", "To-review", "Completed"],
      default: "To-do",
    },
    name: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
      validate: {
        validator: function (value) {
          return value >= this.startDate; // Allow same day
        },
        message: 'End date must be after or equal to the start date',
      },
    },
    reviewDate: {
      type: Date,
    },
    completedDate: {
      type: Date,
    },
    primaryOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    secondaryOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    serviceReport: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceReport",
    },
    remarks: {
      type: String,
    },
    dailyUpdates: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DailyUpdate",
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for frequently queried fields
TaskSchema.index({ project: 1 });
TaskSchema.index({ status: 1 });
TaskSchema.index({ projectStage: 1 });

const Task = mongoose.model("Task", TaskSchema);

module.exports = Task;
