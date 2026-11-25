const { ApiError, asyncHandler } = require('../utils/errors');
const { getClient } = require('../config/database');
const groupService = require('../services/group.service');
const { sendGroupInvitationEmail } = require('../services/notification.service');

const createGroup = asyncHandler(async (req, res) => {
  const creatorEmail = req.user.email.toLowerCase();
  const requestedMembers = Array.isArray(req.body.members) ? req.body.members : [];
  const inviteEmails = [...new Set(requestedMembers
    .map((member) => member.email.trim().toLowerCase())
    .filter((email) => email !== creatorEmail))];
  let invitedMembers = [];

  if (inviteEmails.length > 0) {
    const registeredUsers = await getClient().execute({
      sql: `SELECT email, name, upi_id
        FROM users
        WHERE lower(email) IN (${inviteEmails.map(() => '?').join(', ')})`,
      args: inviteEmails,
    });
    const usersByEmail = new Map(
      registeredUsers.rows.map((user) => [user.email.toLowerCase(), user]),
    );
    const unregisteredEmails = inviteEmails.filter((email) => !usersByEmail.has(email));

    if (unregisteredEmails.length > 0) {
      throw ApiError.badRequest(
        `Unable to add ${unregisteredEmails.join(', ')}. Ask them to register first.`,
      );
    }

    invitedMembers = inviteEmails.map((email) => {
      const user = usersByEmail.get(email);
      return {
        name: user.name,
        email: user.email,
        upiId: user.upi_id,
        role: 'MEMBER',
      };
    });
  }

  const group = await groupService.createGroup({
    ...req.body,
    members: [
      {
        name: req.user.name,
        email: creatorEmail,
        upiId: req.user.upi_id,
        role: 'ADMIN',
      },
      ...invitedMembers,
    ],
  });

  // Send invitation emails to newly added members
  if (inviteEmails.length > 0) {
    for (const email of inviteEmails) {
      const emailResult = await sendGroupInvitationEmail({
        to: email,
        groupName: group.name,
        inviterName: req.user.name,
        groupId: group.id,
        currency: group.currency,
      });
      if (emailResult.success === false) {
        console.error('Group invitation email failed:', emailResult.error);
      }
    }
  }

  res.status(201).json({ success: true, data: group });
});

const getGroups = asyncHandler(async (req, res) => {
  const groups = await groupService.getGroups(req.user.email);
  res.json({ success: true, data: groups });
});

const getGroupById = asyncHandler(async (req, res) => {
  const group = await groupService.getGroupById(req.params.groupId);
  res.json({ success: true, data: group });
});

const updateGroup = asyncHandler(async (req, res) => {
  const group = await groupService.updateGroup(req.params.groupId, req.body);
  res.json({ success: true, data: group });
});

const deleteGroup = asyncHandler(async (req, res) => {
  const result = await groupService.deleteGroup(req.params.groupId);
  res.json(result);
});

const getGroupMembers = asyncHandler(async (req, res) => {
  const members = await groupService.getGroupMembers(req.params.groupId);
  res.json({ success: true, data: members });
});

const addGroupMember = asyncHandler(async (req, res) => {
  const member = await groupService.addGroupMember(req.params.groupId, req.body, req.user.name);
  res.status(201).json({ success: true, data: member });
});

const removeGroupMember = asyncHandler(async (req, res) => {
  const result = await groupService.removeGroupMember(req.params.groupId, req.params.memberId);
  res.json(result);
});

const getGroupExpenses = asyncHandler(async (req, res) => {
  const expenses = await groupService.getGroupExpenses(req.params.groupId);
  res.json({ success: true, data: expenses });
});

const getGroupExpenseVersion = asyncHandler(async (req, res) => {
  const version = await groupService.getGroupExpenseVersion(req.params.groupId);
  res.json({ success: true, data: version });
});

const createExpense = asyncHandler(async (req, res) => {
  const expense = await groupService.createExpense(req.params.groupId, req.body);
  res.status(201).json({ success: true, data: expense });
});

const getExpenseById = asyncHandler(async (req, res) => {
  const expense = await groupService.getExpenseById(req.params.groupId, req.params.expenseId);
  res.json({ success: true, data: expense });
});

const updateExpense = asyncHandler(async (req, res) => {
  const expense = await groupService.updateExpense(req.params.groupId, req.params.expenseId, req.body);
  res.json({ success: true, data: expense });
});

const deleteExpense = asyncHandler(async (req, res) => {
  const result = await groupService.deleteExpense(req.params.groupId, req.params.expenseId);
  res.json(result);
});

const addExpenseComment = asyncHandler(async (req, res) => {
  const comment = await groupService.addExpenseComment(req.params.groupId, req.params.expenseId, req.body);
  res.status(201).json({ success: true, data: comment });
});

const getGroupSettlements = asyncHandler(async (req, res) => {
  const settlements = await groupService.getGroupSettlements(req.params.groupId);
  res.json({ success: true, data: settlements });
});

const createSettlement = asyncHandler(async (req, res) => {
  const settlement = await groupService.createSettlement(req.params.groupId, req.body);
  res.status(201).json({ success: true, data: settlement });
});

const getGroupAnalytics = asyncHandler(async (req, res) => {
  const analytics = await groupService.getGroupAnalytics(req.params.groupId);
  res.json({ success: true, data: analytics });
});

module.exports = {
  createGroup,
  getGroups,
  getGroupById,
  updateGroup,
  deleteGroup,
  getGroupMembers,
  addGroupMember,
  removeGroupMember,
  getGroupExpenses,
  getGroupExpenseVersion,
  createExpense,
  getExpenseById,
  updateExpense,
  deleteExpense,
  addExpenseComment,
  getGroupSettlements,
  createSettlement,
  getGroupAnalytics,
};