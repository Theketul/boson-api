const User = require("../models/userModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generateToken, sendOTP, validateOTP } = require("../utils/msgcentral");
const MongoUtils = require("../utils/mongo-utils");

const JWT_EXPIRY = "100d";
const SALT_ROUNDS = 12;
const TEST_PHONE = "1234567890";
const TEST_OTP = "9999";

const createAuthToken = (userId, role) => jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRY });

const handleS3Delete = async (uploadedFileKey) => {
  if (!uploadedFileKey) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: uploadedFileKey,
      })
    );
  } catch (error) {
    console.error("S3 deletion error:", error);
  }
};

exports.signup = async (req, res) => {
  const { phoneNo, role, password, name, email } = req.body;
  const file = req.file;

  try {
    if (!phoneNo || !role) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "Phone number and role are required."
      );
    }

    const existingUser = await MongoUtils.findOneByFields(User, [{ phoneNo }]);

    if (existingUser) {
      return res.handler.response(
        STATUS_CODES.BAD_REQUEST,
        "User with this phone number already exists."
      );
    }

    if (email) {
      const existingEmailUser = await MongoUtils.findOneByFields(User, [{ email: email.toLowerCase() }]);
      if (existingEmailUser) {
        return res.handler.response(
          STATUS_CODES.BAD_REQUEST,
          "User with this email already exists."
        );
      }
    }

    let hashedPassword = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;

    const newUser = await User.create({
      phoneNo,
      role,
      password: hashedPassword,
      name: name || "User",
      email: email ? email.toLowerCase() : undefined, 
      profilePicture: file?.location || process.env.DEFAULT_PROFILE_PICTURE_URL, // Set default profile picture if none uploaded
    });

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      STATUS_MESSAGES.LOGIN_SUCCESS,
      { user: newUser }
    );
  } catch (error) {
    if (file) await handleS3Delete(file.key); // Delete file if an error occurs
    console.error("Signup error:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      STATUS_MESSAGES.SERVER_ERROR
    );
  }
};

exports.login = async (req, res) => {
  const { countryCode, phoneNo } = req.body;
  
  try {
    const user = await MongoUtils.findOneByField(User, 'phoneNo', phoneNo);
    if (!user) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        STATUS_MESSAGES.NOT_FOUND.USER_NOT_FOUND
      );
    }

    if (phoneNo !== TEST_PHONE) {
      const authToken = user.authToken || process.env.MESSAGE_CENTRAL_AUTH_TOKEN || await generateToken(countryCode, user.email);
      const verificationId = await sendOTP(countryCode, authToken, phoneNo);
      
      Object.assign(user, { authToken, verificationId });
      await user.save();
    }

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      "OTP sent successfully",
      { userId: user._id }
    );
  } catch (error) {
    console.error("Login error:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      STATUS_MESSAGES.SERVER_ERROR
    );
  }
};

exports.verifyOTP = async (req, res) => {
  const { userId, otpCode } = req.body;

  try {
    const user = await MongoUtils.findByIdWithSelect(User, userId);
    if (!user) {
      return res.handler.response(
        STATUS_CODES.NOT_FOUND,
        STATUS_MESSAGES.NOT_FOUND.USER_NOT_FOUND
      );
    }

    if (otpCode !== TEST_OTP) {
      const otpValidationResult = await validateOTP(
        user.authToken,
        user.verificationId,
        otpCode
      );

      if (!otpValidationResult.success || !otpValidationResult.status) {
        user.isVerified = false;
        await user.save();
        return res.handler.response(
          STATUS_CODES.BAD_REQUEST,
          "OTP validation failed"
        );
      }
    }

    const token = createAuthToken(user._id, user.role);
    Object.assign(user, {
      isVerified: true,
      authToken: null,
      verificationId: null
    });
    await user.save();

    return res.handler.response(
      STATUS_CODES.SUCCESS,
      STATUS_MESSAGES.LOGIN_SUCCESS,
      { token, user }
    );
  } catch (error) {
    console.error("OTP verification error:", error);
    return res.handler.response(
      STATUS_CODES.SERVER_ERROR,
      error.message || STATUS_MESSAGES.SERVER_ERROR
    );
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Token not provided" });
    }

    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await MongoUtils.findByIdWithSelect(User, userId, '-password');
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ status: "success", data: { user } });
  } catch (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.editPhoneNumber = async (req, res) => {
  try {
    const existingUser = await MongoUtils.findOneByField(User, 'phoneNo', req.body.newPhoneNo);
    if (existingUser) {
      return res.status(400).json({ message: "Phone number already exists" });
    }

    const user = await MongoUtils.findByIdWithSelect(User, req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.phoneNo = req.body.newPhoneNo;
    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Phone number updated"
    });
  } catch (error) {
    console.error("Phone update error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.editEmail = async (req, res) => {
  try {
    const newEmail = req.body.newEmail.toLowerCase();
    const existingUser = await MongoUtils.findOneByField(User, 'email', newEmail);
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const user = await MongoUtils.findByIdWithSelect(User, req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.email = newEmail;
    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Email updated"
    });
  } catch (error) {
    console.error("Email update error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};