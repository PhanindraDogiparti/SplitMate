const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../utils/errors');
const transactionController = require('../controllers/transaction.controller');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get all transactions for the authenticated user
router.get('/', asyncHandler(transactionController.getUserTransactions));

module.exports = router;