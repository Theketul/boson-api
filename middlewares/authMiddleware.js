const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const ROLE_PERMISSIONS = require("../config/permissions");


exports.protect = async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.handler.response(
      STATUS_CODES.UNAUTHORIZED,
      "Not authorized, no token"
    );
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Check for deleted users explicitly by bypassing the middleware
    req.user = await User.findOne({ _id: decoded.userId, isDeleted: { $ne: true } }).select('-password');
    if (!req.user) {
      return res.handler.response(STATUS_CODES.NOT_FOUND, "User not found");
    }

    // Check if user is soft-deleted
    if (req.user.isDeleted) {
      return res.handler.response(
        STATUS_CODES.FORBIDDEN, "This account has been deactivated. Please contact administrator."
      );
    }

    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    return res.handler.response(
      STATUS_CODES.UNAUTHORIZED,
      "Not authorized, no token"
    );
  }
};

const validateAction = (action) => {
  const allActions = Object.values(ROLE_PERMISSIONS).flat();
  if (!allActions.includes(action)) {
    throw new Error(`Invalid action: ${action}. Make sure it's defined in ROLE_PERMISSIONS.`);
  }
};

exports.restrictTo = (action) => {
  validateAction(action); // Ensure the action is valid
  return (req, res, next) => {
    const userRole = req.user.role;
    if (!ROLE_PERMISSIONS[userRole]?.includes(action)) {
      return res.handler.response(
        STATUS_CODES.FORBIDDEN,
        `Access denied. The ${userRole} role cannot perform the ${action} action.`
      );
    }
    next();
  };
};
