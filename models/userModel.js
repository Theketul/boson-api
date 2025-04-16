const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    profilePicture: {
      type: String,
      default: process.env.DEFAULT_PROFILE_PICTURE_URL,
      match: [
        /^https?:\/\/.*\.(jpg|jpeg|png|gif)$/,
        "Please enter a valid image URL",
      ],
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
    },
    phoneNo: {
      type: String,
      required: true,
      unique: true,
      match: [/^\d{10}$/, "Please enter a valid 10-digit phone number"],
    },
    password: {
      type: String,
    },
    role: {
      type: String,
      enum: ["Admin", "User", "Operations Manager", "ProjectManager","Technician"],
      default: "Technician",
    },
    projectRole: {
      type: String,
      enum: ["Admin", "User", "Operations Manager", "ProjectManager", "Technician"],
      default: null,
    },
    authToken: {
      type: String,
      default: null,
    },
    verificationId: {
      type: String,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    seenNotifications: {
      type: Array,
      default: [],
    },
    unseenNotifications: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
