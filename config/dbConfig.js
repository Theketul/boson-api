const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("MongoDB connection is successful");
  } catch (error) {
    console.log("Error in MongoDB connection", error);
    process.exit(1); 
  }
};

module.exports = connectDB;
