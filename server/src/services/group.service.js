const { getClient } = require('../config/database');
const { ApiError } = require('../utils/errors');
const {
  generateId,
  timestamp,
  toMinorUnits,
  toAmount,
  allocateEqualShares,
} = require('../utils/helpers');
const { sendGroupInvitationEmail } = require('./notification.service');

async function withWriteTransaction(db, work) {
  const transaction = await db.transaction('write');
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function normalizePayers(amountMinor, payers, paidByMemberId, memberIds) {
  if (payers?.length > 1) {
    throw ApiError.badRequest('An expense can only have one payer.');
  }

  const payer = payers?.[0]
    ? { memberId: payers[0].memberId, amountMinor: toMinorUnits(payers[0].amount) }
    : { memberId: paidByMemberId, amountMinor };

  if (!memberIds.has(payer.memberId)) {
    throw ApiError.badRequest('The payer must be a member of this group.');
  }
  if (payer.amountMinor !== amountMinor) {
    throw ApiError.badRequest('Payer amounts must add up to the total expense amount.');
  }

  return [payer];
}

async function createGroup({ name, description, type, customTypeLabel, currency, simplifyDebts, members }) {
  const db = getClient();
  const groupId = generateId();
  const createdAt = timestamp();
  const memberIds = members.map(() => generateId());

  await withWriteTransaction(db, async (transaction) => {
    await transaction.execute({
      sql: `INSERT INTO groups
        (id, name, description, group_type, custom_type_label, currency, simplify_debts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        groupId,
        name,
        description || '',
        type || 'OTHER',
        customTypeLabel || null,
        currency || 'INR',
        simplifyDebts !== false ? 1 : 0,
        createdAt,
        createdAt,
      ],
    });

    for (let index = 0; index < members.length; index++) {
      const member = members[index];
      await transaction.execute({
        sql: `INSERT INTO group_members
          (id, group_id, name, email, upi_id, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          memberIds[index],
          groupId,
          member.name,
          member.email?.trim().toLowerCase() || null,
          member.upiId?.trim() || null,
          member.role || 'MEMBER',
          createdAt,
        ],
      });
    }
  });

  return {
    id: groupId,
    name,
    description: description || '',
    type: type || 'OTHER',
    customTypeLabel,
    currency: currency || 'INR',
    simplifyDebts: simplifyDebts !== false,
    createdAt,
    members: members.map((member, index) => ({
      id: memberIds[index],
      name: member.name,
      email: member.email?.trim().toLowerCase() || null,
      upiId: member.upiId?.trim() || null,
      role: member.role || 'MEMBER',
      netBalance: 0,
      createdAt,
    })),
  };
}

async function getGroups(userEmail) {
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT g.*,
      COUNT(m.id) AS member_count,
      COALESCE((
        SELECT SUM(e.amount_minor)
        FROM expenses e
        WHERE e.group_id = g.id
      ), 0) AS total_spend_minor,
      COALESCE((
        SELECT SUM(s.amount_minor)
        FROM expense_splits s
        JOIN expenses e ON e.id = s.expense_id
        JOIN group_members split_member ON split_member.id = s.member_id
        WHERE e.group_id = g.id AND lower(split_member.email) = lower(?)
      ), 0) AS my_share_minor,
      COALESCE((
        SELECT mine.net_balance_minor
        FROM group_members mine
        WHERE mine.group_id = g.id AND lower(mine.email) = lower(?)
      ), 0) AS my_net_balance_minor
    FROM groups g
    LEFT JOIN group_members m ON m.group_id = g.id
    WHERE EXISTS (
      SELECT 1 FROM group_members mine
      WHERE mine.group_id = g.id AND lower(mine.email) = lower(?)
    )
    GROUP BY g.id
    ORDER BY g.created_at DESC`,
    args: [userEmail, userEmail, userEmail],
  });

  if (result.rows.length === 0) {
    return [];
  }

  const membersResult = await db.execute({
    sql: `SELECT m.*
      FROM group_members m
      WHERE EXISTS (
        SELECT 1 FROM group_members mine
        WHERE mine.group_id = m.group_id AND lower(mine.email) = lower(?)
      )
      ORDER BY m.group_id, m.created_at, m.name`,
    args: [userEmail],
  });
  const membersByGroup = new Map();
  for (const member of membersResult.rows) {
    const members = membersByGroup.get(member.group_id) || [];
    members.push({
      id: member.id,
      name: member.name,
      email: member.email,
      upiId: member.upi_id,
      role: member.role,
      netBalance: toAmount(member.net_balance_minor),
      createdAt: member.created_at,
    });
    membersByGroup.set(member.group_id, members);
  }

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.group_type,
    customTypeLabel: row.custom_type_label,
    currency: row.currency,
    simplifyDebts: Boolean(row.simplify_debts),
    memberCount: Number(row.member_count),
    totalSpend: toAmount(row.total_spend_minor),
    myTotalShare: toAmount(row.my_share_minor),
    netBalance: toAmount(row.my_net_balance_minor),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members: membersByGroup.get(row.id) || [],
  }));
}

async function getGroupById(groupId) {
  const db = getClient();

  const groupResult = await db.execute({
    sql: 'SELECT * FROM groups WHERE id = ?',
    args: [groupId],
  });

  if (groupResult.rows.length === 0) {
    throw ApiError.notFound('Group not found');
  }

  const group = groupResult.rows[0];
  const [members, expenses, settlements] = await Promise.all([
    getGroupMembers(groupId),
    getGroupExpenses(groupId),
    getGroupSettlements(groupId),
  ]);

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.group_type,
    customTypeLabel: group.custom_type_label,
    currency: group.currency,
    simplifyDebts: Boolean(group.simplify_debts),
    createdAt: group.created_at,
    updatedAt: group.updated_at,
    members,
    expenses,
    settlements,
  };
}

async function updateGroup(groupId, updates) {
  const db = getClient();

  await getGroupById(groupId); // Validates existence

  const allowedFields = ['name', 'description', 'type', 'customTypeLabel', 'currency', 'simplifyDebts'];
  const setClauses = [];
  const args = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      const dbKey = key === 'customTypeLabel' ? 'custom_type_label' :
                    key === 'simplifyDebts' ? 'simplify_debts' :
                    key === 'type' ? 'group_type' : key;
      setClauses.push(`${dbKey} = ?`);
      if (key === 'simplifyDebts') {
        args.push(value ? 1 : 0);
      } else {
        args.push(value);
      }
    }
  }

  if (setClauses.length === 0) {
    throw ApiError.badRequest('No valid fields to update');
  }

  setClauses.push('updated_at = ?');
  args.push(timestamp());
  args.push(groupId);

  await db.execute({
    sql: `UPDATE groups SET ${setClauses.join(', ')} WHERE id = ?`,
    args,
  });

  return getGroupById(groupId);
}

async function deleteGroup(groupId) {
  const db = getClient();

  await getGroupById(groupId); // Validates existence

  await withWriteTransaction(db, async (transaction) => {
    await transaction.execute({
      sql: 'DELETE FROM groups WHERE id = ?',
      args: [groupId],
    });
  });

  return { success: true, message: 'Group deleted successfully' };
}

async function getGroupMembers(groupId) {
  const db = getClient();

  const result = await db.execute({
    sql: 'SELECT * FROM group_members WHERE group_id = ? ORDER BY created_at, name',
    args: [groupId],
  });

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    upiId: row.upi_id,
    role: row.role,
    netBalance: toAmount(row.net_balance_minor),
    createdAt: row.created_at,
  }));
}

async function addGroupMember(groupId, { email }, inviterName = 'Group Admin') {
  const db = getClient();

  const group = await getGroupById(groupId);

  const normalizedEmail = email?.trim().toLowerCase() || null;
  if (!normalizedEmail) {
    throw ApiError.badRequest('Enter the email address of a registered user.');
  }

  const registeredUser = await db.execute({
    sql: 'SELECT name, email, upi_id FROM users WHERE lower(email) = ?',
    args: [normalizedEmail],
  });
  if (registeredUser.rows.length === 0) {
    throw ApiError.badRequest(
      `Unable to add ${normalizedEmail}. Ask them to register first.`,
    );
  }

  const existing = await db.execute({
    sql: 'SELECT id FROM group_members WHERE group_id = ? AND email = ?',
    args: [groupId, normalizedEmail],
  });
  if (existing.rows.length > 0) {
    throw ApiError.conflict('This registered user is already a member of the group.');
  }

  const user = registeredUser.rows[0];
  const id = generateId();
  const createdAt = timestamp();

  await db.execute({
    sql: `INSERT INTO group_members (id, group_id, name, email, upi_id, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, groupId, user.name, user.email, user.upi_id, 'MEMBER', createdAt],
  });

  const emailResult = await sendGroupInvitationEmail({
    to: normalizedEmail,
    groupName: group.name,
    inviterName,
    groupId,
    currency: group.currency,
  });
  if (emailResult.success === false) {
    console.error('Group invitation email failed:', emailResult.error);
  }

  return {
    id,
    name: user.name,
    email: user.email,
    upiId: user.upi_id,
    role: 'MEMBER',
    netBalance: 0,
    createdAt,
  };
}

async function removeGroupMember(groupId, memberId) {
  const db = getClient();

  await getGroupById(groupId); // Validates existence

  const member = await db.execute({
    sql: 'SELECT * FROM group_members WHERE id = ? AND group_id = ?',
    args: [memberId, groupId],
  });

  if (member.rows.length === 0) {
    throw ApiError.notFound('Member not found');
  }

  const memberDetails = member.rows[0];
  if (memberDetails.role === 'ADMIN') {
    throw ApiError.conflict('The group creator cannot be removed.');
  }

  if (memberDetails.net_balance_minor !== 0) {
    throw ApiError.conflict('Cannot remove member with non-zero balance. Settle up first.');
  }

  const references = await db.execute({
    sql: `SELECT
      EXISTS (SELECT 1 FROM expenses WHERE paid_by_member_id = ?) AS paid_expenses,
      EXISTS (SELECT 1 FROM expense_payers WHERE member_id = ?) AS payer_allocations,
      EXISTS (SELECT 1 FROM expense_splits WHERE member_id = ?) AS expense_splits,
      EXISTS (SELECT 1 FROM settlements WHERE from_member_id = ? OR to_member_id = ?) AS settlements`,
    args: [memberId, memberId, memberId, memberId, memberId],
  });
  const hasFinancialHistory = Object.values(references.rows[0]).some(Boolean);
  if (hasFinancialHistory) {
    throw ApiError.conflict(
      'Cannot remove a member with recorded expenses or settlements.',
    );
  }

  await db.execute({
    sql: 'DELETE FROM group_members WHERE id = ? AND group_id = ?',
    args: [memberId, groupId],
  });

  return { success: true, message: 'Member removed successfully' };
}

async function getGroupExpenses(groupId) {
  const db = getClient();

  const expensesResult = await db.execute({
    sql: `SELECT e.*, m.name AS paid_by_name
      FROM expenses e
      JOIN group_members m ON m.id = e.paid_by_member_id
      WHERE e.group_id = ?
      ORDER BY e.expense_date DESC, e.created_at DESC`,
    args: [groupId],
  });
  if (expensesResult.rows.length === 0) {
    return [];
  }

  const [splitsResult, commentsResult, payersResult] = await Promise.all([
    db.execute({
      sql: `SELECT s.expense_id, s.member_id, s.amount_minor, m.name AS member_name
        FROM expense_splits s
        JOIN group_members m ON m.id = s.member_id
        WHERE s.expense_id IN (
          SELECT id FROM expenses WHERE group_id = ?
        )
        ORDER BY m.name`,
      args: [groupId],
    }),
    db.execute({
      sql: `SELECT c.*
        FROM expense_comments c
        JOIN expenses e ON e.id = c.expense_id
        WHERE e.group_id = ?
        ORDER BY c.created_at ASC`,
      args: [groupId],
    }),
    db.execute({
      sql: `SELECT p.expense_id, p.member_id, p.amount_minor, m.name AS member_name
        FROM expense_payers p
        JOIN group_members m ON m.id = p.member_id
        WHERE p.expense_id IN (
          SELECT id FROM expenses WHERE group_id = ?
        )
        ORDER BY m.name`,
      args: [groupId],
    }),
  ]);

  const splitsByExpense = new Map();
  for (const split of splitsResult.rows) {
    const splits = splitsByExpense.get(split.expense_id) || [];
    splits.push(split);
    splitsByExpense.set(split.expense_id, splits);
  }

  const commentsByExpense = new Map();
  for (const comment of commentsResult.rows) {
    const comments = commentsByExpense.get(comment.expense_id) || [];
    comments.push(comment);
    commentsByExpense.set(comment.expense_id, comments);
  }

  const payersByExpense = new Map();
  for (const payer of payersResult.rows) {
    const payers = payersByExpense.get(payer.expense_id) || [];
    payers.push(payer);
    payersByExpense.set(payer.expense_id, payers);
  }

  return expensesResult.rows.map((row) =>
    formatExpense(
      row,
      splitsByExpense.get(row.id) || [],
      commentsByExpense.get(row.id) || [],
      payersByExpense.get(row.id) || [],
    ),
  );
}

async function getGroupSettlements(groupId) {
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT s.*, f.name AS from_member_name, t.name AS to_member_name
      FROM settlements s
      JOIN group_members f ON f.id = s.from_member_id
      JOIN group_members t ON t.id = s.to_member_id
      WHERE s.group_id = ?
      ORDER BY s.settled_at DESC`,
    args: [groupId],
  });

  return result.rows.map(formatSettlement);
}

async function createExpense(groupId, {
  title,
  amount,
  category,
  paidByMemberId,
  payers,
  splitType,
  paymentMethod,
  date,
  notes,
  splits,
}) {
  const db = getClient();

  const membersResult = await db.execute({
    sql: `SELECT m.id
      FROM groups g
      LEFT JOIN group_members m ON m.group_id = g.id
      WHERE g.id = ?
      ORDER BY m.id`,
    args: [groupId],
  });
  if (membersResult.rows.length === 0) {
    throw ApiError.notFound('Group not found');
  }
  const members = membersResult.rows.filter((member) => member.id !== null);

  if (members.length === 0) {
    throw ApiError.conflict('Add at least one member before creating an expense.');
  }

  const amountMinor = toMinorUnits(amount);
  const memberIds = new Set(members.map((member) => member.id));
  const payerAllocations = normalizePayers(amountMinor, payers, paidByMemberId, memberIds);
  const primaryPayerId = payerAllocations[0].memberId;

  let expenseSplits;
  if (splits) {
    const seenMemberIds = new Set();
    expenseSplits = splits.map((split) => {
      if (!memberIds.has(split.memberId)) {
        throw ApiError.badRequest('Every expense split must belong to a group member.');
      }
      if (seenMemberIds.has(split.memberId)) {
        throw ApiError.badRequest('A member can only have one split per expense.');
      }
      seenMemberIds.add(split.memberId);
      return { memberId: split.memberId, amountMinor: toMinorUnits(split.amount) };
    });
    if (expenseSplits.reduce((total, split) => total + split.amountMinor, 0) !== amountMinor) {
      throw ApiError.badRequest('Expense splits must add up to the total amount.');
    }
  } else {
    expenseSplits = allocateEqualShares(amountMinor, members);
  }

  const expenseId = generateId();
  const createdAt = timestamp();
  const expenseDate = date || createdAt;

  await withWriteTransaction(db, async (transaction) => {
    await transaction.execute({
      sql: `INSERT INTO expenses
        (id, group_id, title, category, paid_by_member_id, amount_minor, split_type,
         payment_method, expense_date, notes, is_settled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        expenseId,
        groupId,
        title,
        category || 'Other',
        primaryPayerId,
        amountMinor,
        splitType || 'EQUAL',
        paymentMethod || 'OTHER',
        expenseDate,
        notes || '',
        0,
        createdAt,
        createdAt,
      ],
    });

    for (const split of expenseSplits) {
      await transaction.execute({
        sql: `INSERT INTO expense_splits (id, expense_id, member_id, amount_minor)
          VALUES (?, ?, ?, ?)`,
        args: [generateId(), expenseId, split.memberId, split.amountMinor],
      });
    }
    for (const payer of payerAllocations) {
      await transaction.execute({
        sql: `INSERT INTO expense_payers (id, expense_id, member_id, amount_minor)
          VALUES (?, ?, ?, ?)`,
        args: [generateId(), expenseId, payer.memberId, payer.amountMinor],
      });
      await transaction.execute({
        sql: `UPDATE group_members
          SET net_balance_minor = net_balance_minor + ?
          WHERE id = ? AND group_id = ?`,
        args: [payer.amountMinor, payer.memberId, groupId],
      });
    }
    for (const split of expenseSplits) {
      if (split.amountMinor !== 0) {
        await transaction.execute({
          sql: `UPDATE group_members
            SET net_balance_minor = net_balance_minor - ?
            WHERE id = ? AND group_id = ?`,
          args: [split.amountMinor, split.memberId, groupId],
        });
      }
    }
  });

  return getExpenseById(groupId, expenseId);
}

async function getExpenseById(groupId, expenseId) {
  const db = getClient();

  const expenseResult = await db.execute({
    sql: `SELECT e.*, m.name AS paid_by_name
      FROM expenses e JOIN group_members m ON m.id = e.paid_by_member_id
      WHERE e.id = ? AND e.group_id = ?`,
    args: [expenseId, groupId],
  });

  if (expenseResult.rows.length === 0) {
    throw ApiError.notFound('Expense not found');
  }

  const [splitResult, commentsResult, payerResult] = await Promise.all([
    db.execute({
      sql: `SELECT s.expense_id, s.member_id, s.amount_minor, m.name AS member_name
        FROM expense_splits s JOIN group_members m ON m.id = s.member_id
        WHERE s.expense_id = ? ORDER BY m.name`,
      args: [expenseId],
    }),
    db.execute({
      sql: 'SELECT * FROM expense_comments WHERE expense_id = ? ORDER BY created_at ASC',
      args: [expenseId],
    }),
    db.execute({
      sql: `SELECT p.expense_id, p.member_id, p.amount_minor, m.name AS member_name
        FROM expense_payers p
        JOIN group_members m ON m.id = p.member_id
        WHERE p.expense_id = ?
        ORDER BY m.name`,
      args: [expenseId],
    }),
  ]);

  return formatExpense(
    expenseResult.rows[0],
    splitResult.rows,
    commentsResult.rows,
    payerResult.rows,
  );
}

async function updateExpense(groupId, expenseId, updates) {
  const db = getClient();

  const existing = await db.execute({
    sql: 'SELECT * FROM expenses WHERE id = ? AND group_id = ?',
    args: [expenseId, groupId],
  });

  if (existing.rows.length === 0) {
    throw ApiError.notFound('Expense not found');
  }

  const oldExpense = existing.rows[0];

  const expenseFields = [
    'title',
    'amount',
    'category',
    'paidByMemberId',
    'payers',
    'splitType',
    'paymentMethod',
    'date',
    'notes',
    'splits',
  ];
  const hasExpenseDetails = expenseFields.some((field) => updates[field] !== undefined);
  if (!hasExpenseDetails) {
    if (typeof updates.isSettled !== 'boolean') {
      throw ApiError.badRequest('Provide expense details or a settlement status.');
    }

    if (!updates.isSettled && oldExpense.is_settled && oldExpense.settled_at) {
      const settledAt = new Date(oldExpense.settled_at).getTime();
      if (Number.isFinite(settledAt) && Date.now() - settledAt >= 24 * 60 * 60 * 1000) {
        throw ApiError.conflict('This expense can no longer be reopened.');
      }
    }

    const settledAt = updates.isSettled ? timestamp() : null;
    await db.execute({
      sql: 'UPDATE expenses SET is_settled = ?, settled_at = ? WHERE id = ? AND group_id = ?',
      args: [
        updates.isSettled ? 1 : 0,
        settledAt,
        expenseId,
        groupId,
      ],
    });
    return {
      id: expenseId,
      isSettled: updates.isSettled,
      settledAt: settledAt ? new Date(settledAt).getTime() : null,
    };
  }

  if (oldExpense.is_settled) {
    throw ApiError.conflict('Reopen the expense before editing it.');
  }

  const {
    title,
    amount,
    category,
    paidByMemberId,
    payers,
    splitType,
    paymentMethod,
    date,
    notes,
    splits,
  } = updates;

  const previousUpdatedAt = new Date(
    oldExpense.updated_at || oldExpense.created_at,
  ).getTime();
  const updatedAt = new Date(
    Math.max(Date.now(), Number.isFinite(previousUpdatedAt) ? previousUpdatedAt + 1 : 0),
  ).toISOString();

  const effectiveAmount = amount !== undefined ? amount : toAmount(oldExpense.amount_minor);
  const amountMinor = toMinorUnits(effectiveAmount);

  const membersResult = await db.execute({
    sql: 'SELECT id FROM group_members WHERE group_id = ? ORDER BY id',
    args: [groupId],
  });
  const members = membersResult.rows;

  const memberIds = new Set(members.map((member) => member.id));
  const payerAllocations = normalizePayers(
    amountMinor,
    payers,
    paidByMemberId || oldExpense.paid_by_member_id,
    memberIds,
  );
  const primaryPayerId = payerAllocations[0].memberId;

  let expenseSplits;
  if (splits) {
    const seenMemberIds = new Set();
    expenseSplits = splits.map((split) => {
      if (!memberIds.has(split.memberId)) {
        throw ApiError.badRequest('Every expense split must belong to a group member.');
      }
      if (seenMemberIds.has(split.memberId)) {
        throw ApiError.badRequest('A member can only have one split per expense.');
      }
      seenMemberIds.add(split.memberId);
      return { memberId: split.memberId, amountMinor: toMinorUnits(split.amount) };
    });
    if (expenseSplits.reduce((total, split) => total + split.amountMinor, 0) !== amountMinor) {
      throw ApiError.badRequest('Expense splits must add up to the total amount.');
    }
  } else {
    expenseSplits = allocateEqualShares(amountMinor, members);
  }

  const nextTitle = title !== undefined ? title : oldExpense.title;
  const nextCategory = category !== undefined ? category : oldExpense.category || 'Other';
  const nextSplitType = splitType !== undefined ? splitType : oldExpense.split_type || 'EQUAL';
  const nextPaymentMethod =
    paymentMethod !== undefined ? paymentMethod : oldExpense.payment_method || 'OTHER';
  const nextDate = date !== undefined ? date : oldExpense.expense_date || timestamp();
  const nextNotes = notes !== undefined ? notes : oldExpense.notes || '';

  await withWriteTransaction(db, async (transaction) => {
    const oldPayers = await transaction.execute({
      sql: 'SELECT member_id, amount_minor FROM expense_payers WHERE expense_id = ?',
      args: [expenseId],
    });
    if (oldPayers.rows.length > 0) {
      for (const payer of oldPayers.rows) {
        await transaction.execute({
          sql: `UPDATE group_members
            SET net_balance_minor = net_balance_minor - ?
            WHERE id = ? AND group_id = ?`,
          args: [payer.amount_minor, payer.member_id, groupId],
        });
      }
    } else {
      await transaction.execute({
        sql: `UPDATE group_members
          SET net_balance_minor = net_balance_minor - ?
          WHERE id = ? AND group_id = ?`,
        args: [oldExpense.amount_minor, oldExpense.paid_by_member_id, groupId],
      });
    }

    const oldSplits = await transaction.execute({
      sql: 'SELECT member_id, amount_minor FROM expense_splits WHERE expense_id = ?',
      args: [expenseId],
    });

    for (const split of oldSplits.rows) {
      if (split.amount_minor !== 0) {
        await transaction.execute({
          sql: `UPDATE group_members
            SET net_balance_minor = net_balance_minor + ?
            WHERE id = ? AND group_id = ?`,
          args: [split.amount_minor, split.member_id, groupId],
        });
      }
    }

    await transaction.execute({
      sql: `UPDATE expenses SET
        title = ?, category = ?, paid_by_member_id = ?, amount_minor = ?,
        split_type = ?, payment_method = ?, expense_date = ?, notes = ?,
        is_settled = 0, settled_at = NULL, updated_at = ?
        WHERE id = ?`,
      args: [
        nextTitle,
        nextCategory,
        primaryPayerId,
        amountMinor,
        nextSplitType,
        nextPaymentMethod,
        nextDate,
        nextNotes,
        updatedAt,
        expenseId,
      ],
    });

    await transaction.execute({
      sql: 'DELETE FROM expense_splits WHERE expense_id = ?',
      args: [expenseId],
    });
    await transaction.execute({
      sql: 'DELETE FROM expense_payers WHERE expense_id = ?',
      args: [expenseId],
    });

    for (const split of expenseSplits) {
      await transaction.execute({
        sql: `INSERT INTO expense_splits (id, expense_id, member_id, amount_minor)
          VALUES (?, ?, ?, ?)`,
        args: [generateId(), expenseId, split.memberId, split.amountMinor],
      });
    }

    for (const payer of payerAllocations) {
      await transaction.execute({
        sql: `INSERT INTO expense_payers (id, expense_id, member_id, amount_minor)
          VALUES (?, ?, ?, ?)`,
        args: [generateId(), expenseId, payer.memberId, payer.amountMinor],
      });
      await transaction.execute({
        sql: `UPDATE group_members
          SET net_balance_minor = net_balance_minor + ?
          WHERE id = ? AND group_id = ?`,
        args: [payer.amountMinor, payer.memberId, groupId],
      });
    }

    for (const split of expenseSplits) {
      if (split.amountMinor !== 0) {
        await transaction.execute({
          sql: `UPDATE group_members
            SET net_balance_minor = net_balance_minor - ?
            WHERE id = ? AND group_id = ?`,
          args: [split.amountMinor, split.memberId, groupId],
        });
      }
    }
  });

  return getExpenseById(groupId, expenseId);
}

async function deleteExpense(groupId, expenseId) {
  const db = getClient();

  await getGroupById(groupId); // Validates existence

  const existing = await db.execute({
    sql: 'SELECT * FROM expenses WHERE id = ? AND group_id = ?',
    args: [expenseId, groupId],
  });

  if (existing.rows.length === 0) {
    throw ApiError.notFound('Expense not found');
  }

  await withWriteTransaction(db, async (transaction) => {
    const oldExpense = existing.rows[0];
    const oldPayers = await transaction.execute({
      sql: 'SELECT member_id, amount_minor FROM expense_payers WHERE expense_id = ?',
      args: [expenseId],
    });
    if (oldPayers.rows.length > 0) {
      for (const payer of oldPayers.rows) {
        await transaction.execute({
          sql: `UPDATE group_members
            SET net_balance_minor = net_balance_minor - ?
            WHERE id = ? AND group_id = ?`,
          args: [payer.amount_minor, payer.member_id, groupId],
        });
      }
    } else {
      await transaction.execute({
        sql: `UPDATE group_members
          SET net_balance_minor = net_balance_minor - ?
          WHERE id = ? AND group_id = ?`,
        args: [oldExpense.amount_minor, oldExpense.paid_by_member_id, groupId],
      });
    }

    const oldSplits = await transaction.execute({
      sql: 'SELECT member_id, amount_minor FROM expense_splits WHERE expense_id = ?',
      args: [expenseId],
    });

    for (const split of oldSplits.rows) {
      if (split.amount_minor !== 0) {
        await transaction.execute({
          sql: `UPDATE group_members
            SET net_balance_minor = net_balance_minor + ?
            WHERE id = ? AND group_id = ?`,
          args: [split.amount_minor, split.member_id, groupId],
        });
      }
    }

    await transaction.execute({
      sql: 'DELETE FROM expenses WHERE id = ?',
      args: [expenseId],
    });
  });

  return { success: true, message: 'Expense deleted successfully' };
}

async function addExpenseComment(groupId, expenseId, { author, text }) {
  const db = getClient();

  await getGroupById(groupId); // Validates existence

  const expense = await db.execute({
    sql: 'SELECT id FROM expenses WHERE id = ? AND group_id = ?',
    args: [expenseId, groupId],
  });

  if (expense.rows.length === 0) {
    throw ApiError.notFound('Expense not found');
  }

  const commentId = generateId();
  const createdAt = timestamp();

  await db.execute({
    sql: `INSERT INTO expense_comments (id, expense_id, author, text, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    args: [commentId, expenseId, author, text, createdAt],
  });

  return {
    id: commentId,
    author,
    text,
    time: createdAt,
  };
}

async function getGroupAnalytics(groupId) {
  const db = getClient();

  await getGroupById(groupId); // Validates existence

  const [members, expenses, settlements] = await Promise.all([
    getGroupMembers(groupId),
    getGroupExpenses(groupId),
    getGroupSettlements(groupId),
  ]);

  const totalSpend = expenses.reduce((sum, e) => sum + e.totalAmount, 0);
  const categoryBreakdown = {};
  const monthlyBreakdown = {};
  const memberStats = {};

  members.forEach((m) => {
    memberStats[m.id] = {
      name: m.name,
      paid: 0,
      owes: 0,
      netBalance: m.netBalance,
      transactionCount: 0,
    };
  });

  expenses.forEach((expense) => {
    if (!categoryBreakdown[expense.category]) {
      categoryBreakdown[expense.category] = 0;
    }
    categoryBreakdown[expense.category] += expense.totalAmount;

    const month = expense.date.substring(0, 7);
    if (!monthlyBreakdown[month]) {
      monthlyBreakdown[month] = 0;
    }
    monthlyBreakdown[month] += expense.totalAmount;

    const payerAllocations = expense.payers?.length
      ? expense.payers
      : [{
        memberId: expense.paidByMemberId,
        amount: expense.totalAmount,
      }];
    payerAllocations.forEach((payerAllocation) => {
      const payer = memberStats[payerAllocation.memberId];
      if (payer) {
        payer.paid += payerAllocation.amount;
        payer.transactionCount += 1;
      }
    });

    expense.splits.forEach((split) => {
      const member = memberStats[split.memberId];
      if (member) {
        member.owes += split.amount;
      }
    });
  });

  const topPayers = Object.values(memberStats)
    .sort((a, b) => b.paid - a.paid)
    .slice(0, 5);

  const recentActivity = [
    ...expenses.map((e) => ({ ...e, type: 'expense' })),
    ...settlements.map((s) => ({ ...s, type: 'settlement' })),
  ]
    .sort((a, b) => new Date(b.createdAt || b.settledAt || 0) - new Date(a.createdAt || a.settledAt || 0))
    .slice(0, 10);

  return {
    groupId,
    totalSpend,
    totalExpenses: expenses.length,
    totalSettlements: settlements.length,
    categoryBreakdown,
    monthlyBreakdown,
    memberStats: Object.values(memberStats),
    topPayers,
    recentActivity,
    currency: 'INR',
  };
}

function formatExpense(row, splits = [], comments = [], payers = []) {
  const yourSplit = splits.find((s) => s.member_id === 'you');
  const formattedPayers = payers.length > 0
    ? payers.map((payer) => ({
      memberId: payer.member_id,
      memberName: payer.member_name,
      amount: toAmount(payer.amount_minor),
    }))
    : [{
      memberId: row.paid_by_member_id,
      memberName: row.paid_by_name,
      amount: toAmount(row.amount_minor),
    }];
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    category: row.category,
    paidByMemberId: row.paid_by_member_id,
    paidByName: row.paid_by_name,
    payers: formattedPayers,
    totalAmount: toAmount(row.amount_minor),
    yourShare: yourSplit ? toAmount(yourSplit.amount_minor) : 0,
    splitType: row.split_type,
    paymentMethod: row.payment_method,
    date: row.expense_date,
    notes: row.notes,
    isSettled: Boolean(row.is_settled),
    settledAt: row.settled_at ? new Date(row.settled_at).getTime() : null,
    createdAt: row.created_at,
    splits: splits.map((split) => ({
      memberId: split.member_id,
      memberName: split.member_name,
      amount: toAmount(split.amount_minor),
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.author,
      text: comment.text,
      time: comment.created_at,
    })),
  };
}

function formatSettlement(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    fromMemberId: row.from_member_id,
    from: row.from_member_name,
    toMemberId: row.to_member_id,
    to: row.to_member_name,
    amount: toAmount(row.amount_minor),
    remainingAfter: toAmount(row.remaining_after_minor || 0),
    method: row.payment_method,
    referenceId: row.reference_id,
    completedAt: row.settled_at,
  };
}

async function createShareToken(groupId, ttlHours = 24) {
  const db = getClient();
  await getGroupById(groupId); // Validates existence

  const tokenId = generateId();
  const token = `${groupId}_${Date.now()}_${Math.random().toString(36).slice(2, 15)}`;
  const createdAt = timestamp();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  await db.execute({
    sql: `INSERT INTO group_share_tokens
      (id, group_id, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    args: [tokenId, groupId, token, expiresAt, createdAt],
  });

  return {
    id: tokenId,
    groupId,
    token,
    expiresAt,
    createdAt,
  };
}

async function validateShareToken(token) {
  const db = getClient();

  const result = await db.execute({
    sql: `SELECT id, group_id, expires_at
      FROM group_share_tokens
      WHERE token = ?`,
    args: [token],
  });

  if (result.rows.length === 0) {
    throw ApiError.notFound('Invitation link not found.');
  }

  const row = result.rows[0];
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw ApiError.conflict('Invitation link has expired.');
  }

  return {
    id: row.id,
    groupId: row.group_id,
    expiresAt: row.expires_at,
  };
}

async function joinGroupByToken(token, email) {
  const db = getClient();
  const validation = await validateShareToken(token);

  const normalizedEmail = email?.trim().toLowerCase() || null;
  if (!normalizedEmail) {
    throw ApiError.badRequest('Email address is required.');
  }

  const groupResult = await db.execute({
    sql: 'SELECT id FROM groups WHERE id = ?',
    args: [validation.groupId],
  });
  if (groupResult.rows.length === 0) {
    throw ApiError.notFound('Group not found.');
  }

  const registeredUser = await db.execute({
    sql: 'SELECT name, email, upi_id FROM users WHERE lower(email) = ?',
    args: [normalizedEmail],
  });
  if (registeredUser.rows.length === 0) {
    throw ApiError.badRequest('User is not registered.');
  }

  const existing = await db.execute({
    sql: 'SELECT id FROM group_members WHERE group_id = ? AND email = ?',
    args: [validation.groupId, normalizedEmail],
  });
  if (existing.rows.length > 0) {
    throw ApiError.conflict('You are already a member of this group.');
  }

  const user = registeredUser.rows[0];
  const id = generateId();
  const createdAt = timestamp();

  await db.execute({
    sql: `INSERT INTO group_members (id, group_id, name, email, upi_id, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, validation.groupId, user.name, user.email, user.upi_id, 'MEMBER', createdAt],
  });

  return {
    id,
    groupId: validation.groupId,
    name: user.name,
    email: user.email,
    upiId: user.upi_id,
    role: 'MEMBER',
    netBalance: 0,
    createdAt,
  };
}

async function createSettlement(groupId, { fromMemberId, toMemberId, amount, paymentMethod, referenceId }) {
  const db = getClient();

  await getGroupById(groupId); // Validates existence

  if (fromMemberId === toMemberId) {
    throw ApiError.badRequest('A member cannot settle a balance with themselves.');
  }

  const amountMinor = toMinorUnits(amount);
  const settlementId = generateId();
  const settledAt = timestamp();

  await withWriteTransaction(db, async (transaction) => {
    const balancesResult = await transaction.execute({
      sql: `SELECT id, net_balance_minor FROM group_members
        WHERE group_id = ? AND id IN (?, ?)`,
      args: [groupId, fromMemberId, toMemberId],
    });
    const balances = new Map(
      balancesResult.rows.map((row) => [row.id, Number(row.net_balance_minor)]),
    );
    if (balances.size !== 2) {
      throw ApiError.badRequest('Both settlement members must belong to this group.');
    }
    const fromBalance = balances.get(fromMemberId);
    const toBalance = balances.get(toMemberId);
    if (fromBalance >= 0 || toBalance <= 0) {
      throw ApiError.conflict('Settlement direction does not match the current balances.');
    }
    if (amountMinor > Math.min(-fromBalance, toBalance)) {
      throw ApiError.conflict('Settlement amount exceeds the outstanding balance.');
    }

    const remainingAfterMinor = Math.min(-fromBalance, toBalance) - amountMinor;

    await transaction.execute({
      sql: `INSERT INTO settlements
        (id, group_id, from_member_id, to_member_id, amount_minor, payment_method, reference_id, remaining_after_minor, settled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        settlementId,
        groupId,
        fromMemberId,
        toMemberId,
        amountMinor,
        paymentMethod || 'OTHER',
        referenceId || null,
        remainingAfterMinor,
        settledAt,
      ],
    });
    await transaction.execute({
      sql: `UPDATE group_members
        SET net_balance_minor = net_balance_minor + ?
        WHERE id = ? AND group_id = ?`,
      args: [amountMinor, fromMemberId, groupId],
    });
    await transaction.execute({
      sql: `UPDATE group_members
        SET net_balance_minor = net_balance_minor - ?
        WHERE id = ? AND group_id = ?`,
      args: [amountMinor, toMemberId, groupId],
    });
  });

  const result = await db.execute({
    sql: `SELECT s.*, f.name AS from_member_name, t.name AS to_member_name
      FROM settlements s
      JOIN group_members f ON f.id = s.from_member_id
      JOIN group_members t ON t.id = s.to_member_id
      WHERE s.id = ?`,
    args: [settlementId],
  });

  return formatSettlement(result.rows[0]);
}

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
  getGroupSettlements,
  createExpense,
  getExpenseById,
  updateExpense,
  deleteExpense,
  addExpenseComment,
  getGroupAnalytics,
  createSettlement,
  createShareToken,
  validateShareToken,
  joinGroupByToken,
};