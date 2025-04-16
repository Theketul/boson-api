const Product = require("../models/productModel");
const Form = require("../models/formModel");
const MongoUtils = require("../utils/mongo-utils");
const { deleteFileFromS3 } = require("../utils/awsbucket");

const validateProduct = (name, file) => {
  const errors = [];
  if (!name?.trim()) errors.push("Product name is required");
  if (!file) errors.push("Product image is required");
  return errors;
};

exports.addProduct = async (req, res) => {
  const { name, description } = req.body;
  const file = req.file;
  
  try {
    const validationErrors = validateProduct(name, file);
    if (validationErrors.length) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        validationErrors.join(", ")
      );
    }

    const product = await MongoUtils.findOneByField(Product, 'name', name?.trim());
    if (product) {
      await deleteFileFromS3(file.location);
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Product already exists"
      );
    }

    const newProduct = await Product.create({
      name: name.trim(),
      productPicture: file.location,
      description: description?.trim()
    });

    return res.handler.response(
      STATUS_CODES.CREATED,
      "Product added successfully",
      newProduct
    );
  } catch (error) {
    if (file?.location) {
      await deleteFileFromS3(file.location);
    }
    console.error("Product creation error:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      error.message
    );
  }
};

exports.addForm = async (req, res) => {
  const { name } = req.body;
  try {
    const form = await MongoUtils.findOneByField(Form, 'name', name?.trim());
    if (form) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Form already exists"
      );
    }

    const newForm = await Form.create({
      name: name.trim(),
    });

    return res.handler.response(
      STATUS_CODES.CREATED,
      "Form added successfully",
      newForm
    );

  } catch (error) {
    console.error("Product search error:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      error.message
    );
  }  
};

exports.uploadFormImage = async (req, res) => {
  const file = req.file;
  try {
    return res.handler.response(
      STATUS_CODES.CREATED,
      "Form image uploaded successfully", 
      { imageUrl: file.location }
    );
  } catch (error) {
    console.error("Form image upload error:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      error.message
    );
  }
};

exports.deleteFormImage = async (req, res) => {
  const { imageUrl } = req.body;
  try {
    await deleteFileFromS3(imageUrl);
    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "Form image deleted successfully"
    );
  } catch (error) {
    console.error("Form image delete error:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      error.message
    );
  }
};