const mongoose = require("mongoose");

const DailyUpdateSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    photos: [{
      type: String,
      match: [
        /^https?:\/\/.*\.(jpg|jpeg|png|gif|mp4|mov|avi)$/,
        "Please enter a valid image URL",
      ],
    }],
    distanceTraveled: {
      type: Number,
    },
    manHours: {
      noOfPerson: { type: Number },
      noOfHours: { type: Number },
      totalHours: { type: Number },
    },
  },
  { timestamps: true }
);

const DailyUpdate = mongoose.model("DailyUpdate", DailyUpdateSchema);

module.exports = DailyUpdate;
