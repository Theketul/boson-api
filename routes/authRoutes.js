const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const sanitize = require('../config/sanitizer');
const { protect } = require('../middlewares/authMiddleware');
const { upload } = require('../utils/awsbucket');

router.post('/signup',sanitize(),  upload.single("profilePicture"), authController.signup);
router.post('/login',sanitize(), authController.login);
router.post('/verify-otp',sanitize(), authController.verifyOTP);
router.get('/get-user-profile', sanitize(), protect, authController.getUserProfile);
router.put("/edit-email", sanitize(), protect, authController.editEmail);
router.put("/edit-phone", sanitize(), protect, authController.editPhoneNumber);

module.exports = router;
