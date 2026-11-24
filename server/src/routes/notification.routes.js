const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const notificationController = require('../controllers/notification.controller');

const router = express.Router();

router.use(authenticateToken);
router.get('/', notificationController.getNotifications);

module.exports = router;
