const { getClient } = require('../config/database');
const { toAmount } = require('../utils/helpers');

/**
 * Optimized: Single query using UNION ALL to get all transaction data
 * (expenses + settlements) in one DB round-trip instead of the original 5+ queries.
 * Sorting is done in JavaScript after combining results.
 */
async function getUserTransactions(userEmail) {
  const db = getClient();

  const allDataResult = await db.execute({
    sql: `
      SELECT
        'expense' AS kind,
        e.id,
        e.title,
        e.category,
        e.expense_date AS date,
        e.payment_method,
        e.is_settled,
        e.notes,
        g.name AS group_name,
        COALESCE(
          (
            SELECT group_concat(payer_member.name, ' + ')
            FROM expense_payers p
            JOIN group_members payer_member ON payer_member.id = p.member_id
            WHERE p.expense_id = e.id
          ),
          paid_by.name
        ) AS paid_by_name,
        paid_by.email AS paid_by_email,
        paid_by.id AS paid_by_member_id,
        e.amount_minor AS amount_minor,
        e.split_type,
        NULL AS from_member_id,
        NULL AS to_member_id,
        NULL AS reference_id,
        NULL AS settlement_payment_method,
        user_split.amount_minor AS user_split_minor,
        user_payer.amount_minor AS user_paid_minor,
        CASE WHEN EXISTS (
          SELECT 1 FROM expense_payers p WHERE p.expense_id = e.id
        ) THEN 1 ELSE 0 END AS has_expense_payers,
        mine.id AS user_member_id
      FROM expenses e
      JOIN groups g ON g.id = e.group_id
      JOIN group_members paid_by ON paid_by.id = e.paid_by_member_id
      JOIN group_members mine ON mine.group_id = e.group_id AND lower(mine.email) = lower(?)
      LEFT JOIN expense_splits user_split
        ON user_split.expense_id = e.id AND user_split.member_id = mine.id
      LEFT JOIN expense_payers user_payer
        ON user_payer.expense_id = e.id AND user_payer.member_id = mine.id
      WHERE e.group_id IN (
        SELECT gm.group_id
        FROM group_members gm
        WHERE lower(gm.email) = lower(?)
      )

      UNION ALL

      SELECT
        'settlement' AS kind,
        s.id,
        CASE
          WHEN s.from_member_id = mine.id THEN
            'Settlement paid to ' || t.name
          ELSE
            'Settlement received from ' || f.name
        END AS title,
        'Settlement' AS category,
        s.settled_at AS date,
        s.payment_method,
        1 AS is_settled,
        NULL AS notes,
        g.name AS group_name,
        CASE
          WHEN s.from_member_id = mine.id THEN 'You'
          ELSE
            f.name
        END AS paid_by_name,
        f.email AS paid_by_email,
        NULL AS paid_by_member_id,
        s.amount_minor AS amount_minor,
        NULL AS split_type,
        s.from_member_id,
        s.to_member_id,
        s.reference_id,
        s.payment_method AS settlement_payment_method,
        NULL AS user_split_minor,
        NULL AS user_paid_minor,
        0 AS has_expense_payers,
        mine.id AS user_member_id
      FROM settlements s
      JOIN groups g ON g.id = s.group_id
      JOIN group_members f ON f.id = s.from_member_id
      JOIN group_members t ON t.id = s.to_member_id
      JOIN group_members mine
        ON mine.group_id = s.group_id AND lower(mine.email) = lower(?)
      WHERE s.from_member_id = mine.id OR s.to_member_id = mine.id
    `,
    args: [userEmail, userEmail, userEmail],
  });

  if (!allDataResult || allDataResult.rows.length === 0) {
    return [];
  }

  const transactions = [];

  for (const row of allDataResult.rows) {
    if (row.kind === 'expense') {
      const totalMinor = Number(row.amount_minor);
      const yourShareMinor = Number(row.user_split_minor || 0);
      const hasExpensePayers = row.has_expense_payers === 1;
      const userPaidMinor = row.user_paid_minor != null
        ? Number(row.user_paid_minor)
        : !hasExpensePayers && row.paid_by_member_id === row.user_member_id
          ? totalMinor
          : 0;
      const totalAmount = toAmount(totalMinor);
      const yourShare = toAmount(yourShareMinor);
      const paidByYouAmount = toAmount(userPaidMinor);

      transactions.push({
        id: row.id,
        kind: 'EXPENSE',
        title: row.title,
        groupName: row.group_name,
        category: row.category,
        paidBy: row.paid_by_name,
        paidByYou: userPaidMinor > 0,
        paidByYouAmount,
        totalAmount,
        yourShare,
        netImpact: paidByYouAmount - yourShare,
        splitType: row.split_type,
        paymentMethod: row.payment_method,
        status: row.is_settled ? 'COMPLETED' : 'ACTIVE',
        date: row.date,
        notes: row.notes,
      });
    } else if (row.kind === 'settlement') {
      const amount = toAmount(row.amount_minor);
      const fromUser = row.from_member_id === row.user_member_id;
      const netImpact = fromUser ? -amount : amount;

      transactions.push({
        id: row.id,
        kind: 'SETTLEMENT',
        title: row.title,
        groupName: row.group_name,
        category: 'Settlement',
        paidBy: row.paid_by_name,
        paidByYou: fromUser,
        totalAmount: amount,
        yourShare: 0,
        netImpact,
        paymentMethod: row.settlement_payment_method,
        referenceId: row.reference_id,
        status: 'COMPLETED',
        date: row.date,
      });
    }
  }

  // Sort by date descending (moved from SQL to JS for compatibility)
  transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return transactions;
}

module.exports = {
  getUserTransactions,
};