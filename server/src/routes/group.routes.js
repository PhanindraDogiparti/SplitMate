const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { validateBody } = require('../validators/schemas');
const z = require('zod');
const {
  createGroupSchema,
  addGroupMemberSchema,
  updateGroupSchema,
  expenseSchema,
  expenseUpdateSchema,
  settlementSchema,
  shareTokenSchema,
  commentSchema,
} = require('../validators/schemas');
const groupController = require('../controllers/group.controller');
const groupService = require('../services/group.service');
const { asyncHandler, ApiError } = require('../utils/errors');
const { getClient } = require('../config/database');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Group CRUD
router.post('/', validateBody(createGroupSchema), groupController.createGroup);
router.get('/', groupController.getGroups);

router.post('/join', asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) {
    throw ApiError.badRequest('Token is required.');
  }
  const member = await groupService.joinGroupByToken(token, req.user.email);
  res.status(201).json({ success: true, data: member });
}));

router.use('/:groupId', asyncHandler(async (req, res, next) => {
  const result = await getClient().execute({
    sql: `SELECT id FROM group_members
      WHERE group_id = ? AND lower(email) = lower(?)`,
    args: [req.params.groupId, req.user.email],
  });
  if (result.rows.length === 0) {
    throw ApiError.forbidden('You are not a member of this group.');
  }
  next();
}));

const requireGroupCreator = asyncHandler(async (req, res, next) => {
  const result = await getClient().execute({
    sql: `SELECT id FROM group_members
      WHERE group_id = ? AND lower(email) = lower(?) AND role = 'ADMIN'`,
    args: [req.params.groupId, req.user.email],
  });
  if (result.rows.length === 0) {
    throw ApiError.forbidden('Only the group creator can manage group members.');
  }
  next();
});

router.get('/:groupId', groupController.getGroupById);
router.patch('/:groupId', validateBody(updateGroupSchema), groupController.updateGroup);
router.delete('/:groupId', groupController.deleteGroup);

// Group Members
router.get('/:groupId/members', groupController.getGroupMembers);
router.post(
  '/:groupId/members',
  requireGroupCreator,
  validateBody(addGroupMemberSchema),
  groupController.addGroupMember,
);
router.delete('/:groupId/members/:memberId', requireGroupCreator, groupController.removeGroupMember);

// Group Expenses
router.get('/:groupId/expenses', groupController.getGroupExpenses);
router.post('/:groupId/expenses', validateBody(expenseSchema), groupController.createExpense);
router.get('/:groupId/expenses/:expenseId', groupController.getExpenseById);
router.patch(
  '/:groupId/expenses/:expenseId',
  validateBody(expenseUpdateSchema),
  groupController.updateExpense,
);
router.delete('/:groupId/expenses/:expenseId', groupController.deleteExpense);
router.post('/:groupId/expenses/:expenseId/comments', validateBody(commentSchema), groupController.addExpenseComment);

// Group Settlements
router.get('/:groupId/settlements', groupController.getGroupSettlements);
router.post('/:groupId/settlements', validateBody(settlementSchema), groupController.createSettlement);

// Group Analytics
router.get('/:groupId/analytics', groupController.getGroupAnalytics);

// Share Token Routes
router.post('/:groupId/share-token', validateBody(shareTokenSchema), asyncHandler(async (req, res) => {
  const groupId = req.params.groupId;
  const shareToken = await groupService.createShareToken(groupId, req.body.ttlHours);
  res.status(201).json({ success: true, data: shareToken });
}));

module.exports = router;