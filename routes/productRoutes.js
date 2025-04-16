const express = require('express');
const router = express.Router();
const sanitize = require('../config/sanitizer');
const productController = require('../controllers/productController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const { upload } = require('../utils/awsbucket');

router.post('/add',sanitize(), protect, restrictTo("addProduct"), upload.single("productPicture"), productController.addProduct);
router.post('/addForm', sanitize(), protect, restrictTo("addForm"), productController.addForm);
router.post('/form/upload', sanitize(), protect, restrictTo("FormImage"), upload.single("formImage"), productController.uploadFormImage);
router.delete('/form/upload', sanitize(), protect, restrictTo("FormImage"), productController.deleteFormImage);

module.exports = router;
