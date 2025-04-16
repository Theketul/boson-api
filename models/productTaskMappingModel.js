const mongoose = require("mongoose");

const ProductTaskMappingSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  stages: [
    {
      name: { type: String, required: true }, // e.g., "Pre-requisites", "Installation & Commissioning"
      tasks: [
        {
          name: { type: String, required: true }, // e.g., "Check the site pre-condition"
          form: { type: mongoose.Schema.Types.ObjectId, ref: "Forms" }, // Optional: Form ID
        },
      ],
    },
  ],
});

const ProductTaskMapping = mongoose.model("ProductTaskMapping", ProductTaskMappingSchema);

module.exports = ProductTaskMapping;
