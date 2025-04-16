const Project = require("../models/projectModel");
const User = require("../models/userModel");
const Product = require("../models/productModel");
const Forms = require("../models/formModel"); // Adjust the path to your Forms model
const MongoUtils = require("../utils/mongo-utils");

const TASK_TYPES = [
  "Installation",
  "Customer Complaint",
  "Maintenance",
  "Other"
];

const FEEDBACK_FORM_TYPES = [
  "Not Required",
  "Water Softener",
  "Water Treatment Plant",
  "Industrial RO System",
  "STP",
  "BOSON White Water"
];

const handleResponse = (res, data, error = null) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return res.status(500).json({ message: error.message });
  }
  return res.status(200).json(data);
};

exports.getTaskTypes = async (req, res) => {
  handleResponse(res, { taskTypes: TASK_TYPES });
};

exports.getFeedbackFormTypes = async (req, res) => {
  try {
    const feedbackFormTypes = await Forms.find({}, { _id: 1, name: 1 });

    const dropdownOptions = [
      { id: "noData", name: "No Service Form Required" },
      ...feedbackFormTypes.map((form) => ({ id: form._id, name: form.name })),
    ];

    handleResponse(res, { feedbackFormTypes: dropdownOptions });
  } catch (error) {
    console.error("Error fetching feedback form types:", error);
    res.status(500).json({ message: "Failed to fetch feedback form types" });
  }
};

exports.getProjects = async (req, res) => {
  try {
    const filter = {};

    // if (req.user.role === "ProjectManager") {
    //   filter.$or = [
    //     { createdBy: req.user._id },
    //     { "teamMembers.user": req.user._id }
    //   ];
    // }

    const projects = await Project.find(filter)
      .select("name _id")
      .sort({ name: 1 });

    handleResponse(res, { projects });
  } catch (error) {
    handleResponse(res, null, error);
  }
};

exports.getUsers = async (req, res) => {
  try {
    let { role } = req.query;
    const validRoles = ["Admin", "User", "Operations Manager", "ProjectManager", "Technician"];

    let filter = {};

    if (role) {
      const rolesArray = Array.isArray(role) ? role : role.split(",");
      
      const invalidRoles = rolesArray.filter((r) => !validRoles.includes(r));
      if (invalidRoles.length > 0) {
        return res.handler.response(
          STATUS_CODES.BAD_REQUEST,
          `Invalid roles provided: ${invalidRoles.join(", ")}. Allowed roles: ${validRoles.join(", ")}`
        );
      }

      filter.role = { $in: rolesArray };
    }

    const users = await User.find(filter)
      .select("name _id profilePicture role")
      .sort({ name: 1 });
    handleResponse(res, { users });
  } catch (error) {
    handleResponse(res, null, error);
  }
};

exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find({})
      .select("name _id productPicture")
      .sort({ name: 1 });
    handleResponse(res, { products });
  } catch (error) {
    handleResponse(res, null, error);
  }
};

exports.getProductFromProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await Project.findById(projectId).populate('product', 'name productPicture');
    handleResponse(res, { product: project.product });
  } catch (error) {
    handleResponse(res, null, error);
  }
};

exports.getAllStates = async (req, res) => {
  try {
    const states = [
      "Andaman & Nicobar",
      "Andhra Pradesh",
      "Arunachal Pradesh",
      "Assam",
      "Bihar",
      "Chandigarh",
      "Chattisgarh",
      "Dadra & Nagar Haveli",
      "Daman & Diu",
      "Delhi",
      "Goa",
      "Gujarat",
      "Haryana",
      "Himachal Pradesh",
      "Jammu & Kashmir",
      "Jharkhand",
      "Karnataka",
      "Kerala",
      "Lakshadweep",
      "Madhya Pradesh",
      "Maharashtra",
      "Manipur",
      "Meghalaya",
      "Mizoram",
      "Nagaland",
      "Odisha",
      "Pondicherry",
      "Punjab",
      "Rajasthan",
      "Sikkim",
      "Tamil Nadu",
      "Telangana",
      "Tripura",
      "Uttar Pradesh",
      "Uttarakhand",
      "West Bengal",
    ];

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "States retrieved successfully",
      { states }
    );
  } catch (error) {
    console.error("Error fetching states:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      "Error retrieving states"
    );
  }
};

module.exports.resourceConstants = {
  TASK_TYPES,
  FEEDBACK_FORM_TYPES
};