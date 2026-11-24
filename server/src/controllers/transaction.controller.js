const { asyncHandler } = require('../utils/errors');
const transactionService = require('../services/transaction.service');

const getUserTransactions = asyncHandler(async (req, res) => {
  const userEmail = req.user.email;
  const transactions = await transactionService.getUserTransactions(userEmail);

  res.json({
    success: true,
    data: transactions
  });
});

module.exports = {
  getUserTransactions,
};