const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Project name is required"],
      trim: true,
    },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    stages: [
      {
        name: { type: String, enum: ["Pre-requisites", "Installation & Commissioning", "Maintenance"] },
        totalTasks: { type: Number, default: 0 },
        completedTasks: { type: Number, default: 0 },
        status: { type: String, enum: ["Pending", "Completed"], default: "Pending" }, 
        tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
      },
    ],
    typeOfSite: {
      type: String,
      enum: ["Residential", "Commercial", "Industrial"],
      required: [true, "Type of project is required"],
    },
    typeOfHandover: {
      type: String,
      enum: ["Opex", "Capex"],
      required: [true, "Type of project is required"],
    },
    status: {
      type: String,
      enum: ["To-start", "On-going", "Maintenance", "Archive"],
      default: "To-start",
      required: [true, "Project stage is required"],
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    handoverDate: {
      type: Date,
      validate: {
        validator: function (value) {
          return value > this.startDate;
        },
        message: "Handover date must be after the start date",
      },
    },
    completedDate: {
      type: Date,
    },
    capacity: {
      type: Number,
      min: [0, "Capacity must be a positive number"],
      max: [100000, "Capacity is too large"],
    },
    projectPicture: {
      type: String,
      default: process.env.DEFAULT_PROJECT_PICTURE_URL,
      match: [
        /^https?:\/\/.*\.(jpg|jpeg|png|gif)$/,
        "Please enter a valid image URL",
      ],
    },
    clients: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Client",
        required: true,
      },
    ],
    location: {
      address: { type: String, required: true },
      pinCode: { type: String, required: true },
      city: { type: String },
      state: { type: String },
      googleMapLink: { type: String },
    },
    teamMembers: [
      {
        role: {
          type: String,
          enum: [
            "primaryProjectManager",
            "secondaryProjectManager",
            "installationManager",
            "maintenanceManager",
            "Technician",
          ],
          required: true,
        },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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
    ClientFeedbackForm: {
      type: String,
      default: "https://www.google.com/forms/about/",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for frequently queried fields
projectSchema.index({ status: 1 });
projectSchema.index({ startDate: 1 });
projectSchema.index({ handoverDate: 1 });
projectSchema.index({ "teamMembers.user": 1 });
projectSchema.index({ createdBy: 1 });

module.exports = mongoose.model("Project", projectSchema);