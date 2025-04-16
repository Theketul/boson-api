const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    contactNumber: {
      type: String,
      unique: true,
      match: [/^\d{10}$/, "Please enter a valid 10-digit contact number"],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Client", clientSchema);
