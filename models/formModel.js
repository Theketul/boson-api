const mongoose = require("mongoose");

const FormTemplateSchema = new mongoose.Schema({
  name : { type: String, required: true },
});

const Forms = mongoose.model("Forms", FormTemplateSchema);

module.exports = Forms;
