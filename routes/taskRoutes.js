const express = require('express');
const router = express.Router();
const sanitize = require('../config/sanitizer');
const taskController = require('../controllers/taskController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');
const { upload } = require('../utils/awsbucket');

router.post('/create', sanitize(), protect, restrictTo("createTask"), taskController.createTask);
router.get('/', sanitize(), protect, restrictTo("viewAllTasks"), taskController.listTasks);
router.put('/edit/:taskId', sanitize(), protect, restrictTo("viewAllTasks"), taskController.editTask);
router.get('/count', sanitize(), protect, restrictTo("viewAllTasks"), taskController.getTaskCountByStatus);
router.get('/list', sanitize(), protect, restrictTo("viewProjectTasks"), taskController.listTasksByProjectStage);
router.get('/list/calendar', sanitize(), protect, restrictTo("viewAllTasks"), taskController.listTasksForMonth);
router.get('/list/calendar/day', sanitize(), protect, restrictTo("viewAllTasks"), taskController.listTasksByDate);
router.get('/dailyUpdates', sanitize(), protect, restrictTo("viewAllTasks"), taskController.listDailyUpdates);
router.patch('/updateTimeline/:taskId', sanitize(), protect, restrictTo("updateTaskTime"), taskController.updateTaskTimeline);
router.patch('/updateManHours/:updateId', sanitize(), protect, restrictTo("updateManHours"), taskController.updateManHours);
router.patch('/updateDistance/:updateId', sanitize(), protect, restrictTo("updateDistance"), taskController.updateDistance);
router.post('/uploadPhotos/:updateId', sanitize(), protect, restrictTo("uploadPhotos"), upload.array('photos'), taskController.uploadPhotos);
router.post('/deletePhotos/:updateId', sanitize(), protect, restrictTo("deletePhotos"), upload.array('photos'), taskController.deletePhotos);
router.put('/review/:taskId', sanitize(), protect, restrictTo("submitForReview"), taskController.submitForReview);
router.put('/resubmit/:taskId', sanitize(), protect, restrictTo("submitForReview"), taskController.resubmitTask);
router.put('/markAsDone/:taskId', sanitize(), protect, restrictTo("markAsDone"), taskController.markAsDone);
router.put("/:taskId/assign", sanitize(), protect, restrictTo("assignTask"), taskController.assignTask);
router.post('/schedule', sanitize(), protect, restrictTo("createTaskOnSchedule"), taskController.createTasksOnSchedule);
router.post('/schedule/create', sanitize(), protect, restrictTo("createTaskOnSchedule"), taskController.createScheduledTasks);
router.get('/:taskId', sanitize(), protect, restrictTo("viewTaskDetails"), taskController.getTaskById);
router.delete('/:taskId', sanitize(), protect, restrictTo("deleteTask"), taskController.deleteTask);


module.exports = router;
