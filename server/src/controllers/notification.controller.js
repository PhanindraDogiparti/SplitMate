const { asyncHandler } = require('../utils/errors');
const notificationService = require('../services/notification.service');

const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await notificationService.getNotifications(req.user.email);
  res.json({ success: true, data: notifications });
});

module.exports = { getNotifications };
