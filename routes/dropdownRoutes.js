const express = require('express');
const router = express.Router();
const sanitize = require('../config/sanitizer');
const dropdownController = require('../controllers/dropdownController');
const { protect } = require('../middlewares/authMiddleware');

router.get('/task-types',sanitize(), protect, dropdownController.getTaskTypes);
router.get('/projects',sanitize(), protect, dropdownController.getProjects);
router.get('/form-types',sanitize(), protect, dropdownController.getFeedbackFormTypes);
router.get('/users',sanitize(), protect, dropdownController.getUsers);
router.get('/states',sanitize(), protect, dropdownController.getAllStates);
router.get('/products',sanitize(), protect, dropdownController.getProducts);
router.get('/product/:projectId',sanitize(), protect, dropdownController.getProductFromProject);

module.exports = router;
