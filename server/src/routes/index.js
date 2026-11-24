const express = require('express');
const { asyncHandler } = require('../utils/errors');
const { getClient } = require('../config/database');

const router = express.Router();

// Health check (no auth required)
router.get('/health', asyncHandler(async (req, res) => {
  const db = getClient();
  await db.execute('SELECT 1');
  res.json({ success: true, service: 'SplitMate API', status: 'ok' });
}));

// Auth routes (no auth required for register/login/otp)
const authRoutes = require('./auth.routes');
router.use('/auth', authRoutes);

// Protected routes
const notificationRoutes = require('./notification.routes');
router.use('/notifications', notificationRoutes);

const groupRoutes = require('./group.routes');
router.use('/groups', groupRoutes);

const transactionRoutes = require('./transaction.routes');
router.use('/transactions', transactionRoutes);

const friendsRoutes = require('./friends.routes');
router.use('/friends', friendsRoutes);

// 404 handler for API routes
router.use((req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

module.exports = router;