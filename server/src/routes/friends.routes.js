const express = require('express');
const { asyncHandler } = require('../utils/errors');
const { getClient } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { toAmount } = require('../utils/helpers');

const router = express.Router();

router.use(authenticateToken);

// Get all friends with their balances and shared groups
router.get('/', asyncHandler(async (req, res) => {
  const db = getClient();

  // Get the authenticated user's email
  const userEmail = req.user?.email || '';

  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Get all groups the user is a member of
  const groupsResult = await db.execute({
    sql: `SELECT g.id, g.name, g.currency, gm.role, gm.net_balance_minor
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      WHERE lower(gm.email) = lower(?)
      ORDER BY g.name`,
    args: [userEmail],
  });

  // Build a map of friend balances across all groups
  const friendBalances = {};
  const friendGroups = {};

  for (const group of groupsResult.rows) {
    const memberResult = await db.execute({
      sql: `SELECT id, name, email, upi_id, role, net_balance_minor FROM group_members WHERE group_id = ? AND email != lower(?)`,
      args: [group.id, userEmail],
    });

    for (const member of memberResult.rows) {
      const friendEmail = member.email.toLowerCase();
      const friendName = member.name;
      const friendUpi = member.upi_id || '';
      const friendBalance = toAmount(member.net_balance_minor);
      const friendRole = member.role;

      // Initialize friend entry if not exists
      if (!friendBalances[friendEmail]) {
        friendBalances[friendEmail] = {
          name: friendName,
          email: member.email,
          upiId: friendUpi,
          totalOwedToMe: 0,   // Positive = they owe me
          totalOwedByMe: 0,   // Positive = I owe them
          sharedGroups: [],
        };
      }

      // Add group shared
      if (!friendBalances[friendEmail].sharedGroups.includes(group.name)) {
        friendBalances[friendEmail].sharedGroups.push(group.name);
      }

      // Accumulate balances
      // If friend's net balance is positive, they owe me money
      // If friend's net balance is negative, I owe them money
      if (friendBalance > 0) {
        friendBalances[friendEmail].totalOwedToMe += friendBalance;
      } else if (friendBalance < 0) {
        friendBalances[friendEmail].totalOwedByMe += Math.abs(friendBalance);
      }
    }
  }

  // Convert to array and sort
  const friendsList = Object.entries(friendBalances).map(([email, data]) => ({
    email,
    ...data,
  })).sort((a, b) => b.totalOwedToMe - a.totalOwedToMe);

  // Calculate summary
  const totalOwedToMe = friendsList.reduce((sum, f) => sum + f.totalOwedToMe, 0);
  const totalOwedByMe = friendsList.reduce((sum, f) => sum + f.totalOwedByMe, 0);

  res.json({
    success: true,
    data: {
      friends: friendsList,
      summary: {
        totalOwedToMe: Math.round(totalOwedToMe * 100) / 100,
        totalOwedByMe: Math.round(totalOwedByMe * 100) / 100,
        netPosition: Math.round((totalOwedToMe - totalOwedByMe) * 100) / 100,
      },
    },
  });
}));

module.exports = router;