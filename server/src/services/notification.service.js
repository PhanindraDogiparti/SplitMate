const nodemailer = require('nodemailer');
const config = require('../config');
const { getClient } = require('../config/database');
const { toAmount } = require('../utils/helpers');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    console.info(`[NOTIFICATION-EMAIL] Configured sender: ${config.email.from}`);
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.auth,
    });
  }
  return transporter;
}

async function sendGroupInvitationEmail({ to, groupName, inviterName, groupId, currency }) {
  const transporter = getTransporter();
  const groupUrl = `${config.clientWebUrl}/groups/${groupId}`;

const safeGroupName = String(groupName || 'SplitMate Group').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeInviterName = String(inviterName || 'A friend').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeCurrency = currency ? ` • ${String(currency).replace(/</g, '&lt;').replace(/>/g, '&gt;')}` : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>You've been added to ${safeGroupName} on SplitMate</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f3ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e1b4b; -webkit-text-size-adjust: 100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f4f3ff; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e0e7ff; border-radius: 24px; overflow: hidden; box-shadow: 0 12px 32px rgba(79, 70, 229, 0.08);">
          <!-- Top Violet / Indigo Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #6d28d9 100%); padding: 28px 20px; text-align: center;">
              <div style="display: inline-block; background-color: rgba(255, 255, 255, 0.16); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 14px; padding: 8px 16px; margin-bottom: 12px;">
                <span style="color: #ffffff; font-size: 18px; font-weight: 800; letter-spacing: -0.02em;">SplitMate</span>
              </div>
              <p style="margin: 0; color: #e0e7ff; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">
                Group Invitation
              </p>
              <h1 style="margin: 6px 0 0; color: #ffffff; font-size: 22px; font-weight: 800; line-height: 1.3;">
                You&apos;ve been added to a group
              </h1>
            </td>
          </tr>

          <!-- Main Body -->
          <tr>
            <td style="padding: 24px 20px;">
              <p style="margin: 0 0 18px; color: #475569; font-size: 14px;">
                <strong style="color: #1e1b4b;">${safeInviterName}</strong> added you to a shared group on SplitMate so you can track expenses and settle up easily.
              </p>

              <!-- Group Highlight Card -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 16px; margin: 0 0 22px;">
                <tr>
                  <td style="padding: 18px;">
                    <p style="margin: 0 0 4px; color: #6d28d9; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">
                      Group Name${safeCurrency}
                    </p>
                    <h2 style="margin: 0 0 8px; color: #1e1b4b; font-size: 18px; font-weight: 800; word-break: break-word;">
                      ${safeGroupName}
                    </h2>
                    <p style="margin: 0; color: #5b21b6; font-size: 13px;">
                      Added by <strong>${safeInviterName}</strong>
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 22px; color: #64748b; font-size: 13px;">
                Open the group to view shared bills, check balances, and settle up in fewer transfers.
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${groupUrl}" style="display: block; width: 100%; max-width: 260px; background-color: #4f46e5; color: #ffffff; text-align: center; padding: 14px 24px; border-radius: 12px; text-decoration: none; font-size: 14px; font-weight: 700; box-sizing: border-box;">
                      Open Group
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback Link -->
              <p style="margin: 18px 0 0; color: #94a3b8; font-size: 11px; text-align: center; word-break: break-all;">
                Button not working? Copy this link:<br>
                <a href="${groupUrl}" style="color: #6d28d9; text-decoration: underline;">${groupUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #faf8ff; border-top: 1px solid #ede9fe; padding: 16px 20px; text-align: center;">
              <p style="margin: 0; color: #6d28d9; font-size: 12px; font-weight: 700;">
                SplitMate • Smart Expense Splitting
              </p>
              <p style="margin: 4px 0 0; color: #64748b; font-size: 11px;">
                If you didn&apos;t expect this invite, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`; 

  const text = `
SplitMate - You've been added to a group

You've been added to the group: ${groupName}
Added by: ${inviterName}

Open the group:
${groupUrl}

If you didn't request this invitation, please ignore this email.
`;

  try {
    await transporter.sendMail({
      from: config.email.from,
      to,
      subject: `You've been added to ${groupName} on SplitMate`,
      text,
      html,
    });
    return { success: true };
  } catch (error) {
    console.error('Group invitation email send error:', error);
    return { success: false, error: error.message };
  }
}

async function getNotifications(userEmail) {
  const db = getClient();
  const [expensesResult, settlementsResult] = await Promise.all([
    db.execute({
      sql: `SELECT e.id, e.group_id, g.name AS group_name, g.currency, e.title,
          e.amount_minor, e.created_at, e.updated_at
        FROM expenses e
        JOIN groups g ON g.id = e.group_id
        WHERE EXISTS (
          SELECT 1 FROM group_members mine
          WHERE mine.group_id = e.group_id
            AND lower(mine.email) = lower(?)
            AND (
              EXISTS (
                SELECT 1 FROM expense_splits s
                WHERE s.expense_id = e.id AND s.member_id = mine.id
              )
              OR EXISTS (
                SELECT 1 FROM expense_payers p
                WHERE p.expense_id = e.id AND p.member_id = mine.id
              )
              OR (
                NOT EXISTS (
                  SELECT 1 FROM expense_payers p WHERE p.expense_id = e.id
                )
                AND e.paid_by_member_id = mine.id
              )
            )
        )
        ORDER BY e.updated_at DESC
        LIMIT 25`,
      args: [userEmail],
    }),
    db.execute({
      sql: `SELECT s.id, s.group_id, g.name AS group_name, g.currency,
          f.name AS from_name, t.name AS to_name,
          s.amount_minor, s.settled_at
        FROM settlements s
        JOIN groups g ON g.id = s.group_id
        JOIN group_members f ON f.id = s.from_member_id
        JOIN group_members t ON t.id = s.to_member_id
        WHERE EXISTS (
          SELECT 1 FROM group_members mine
          WHERE mine.group_id = s.group_id
            AND lower(mine.email) = lower(?)
            AND (mine.id = s.from_member_id OR mine.id = s.to_member_id)
        )
        ORDER BY s.settled_at DESC
        LIMIT 25`,
      args: [userEmail],
    }),
  ]);

  const notifications = [
    ...expensesResult.rows.map((row) => {
      const updatedAt = row.updated_at || row.created_at;
      const edited = updatedAt !== row.created_at;
      return {
        id: `expense:${row.id}:${updatedAt}`,
        type: edited ? 'EXPENSE_UPDATED' : 'EXPENSE_CREATED',
        title: edited ? 'Expense updated' : 'New expense',
        message: row.title,
        groupId: row.group_id,
        groupName: row.group_name,
        currency: row.currency,
        amount: toAmount(row.amount_minor),
        createdAt: updatedAt,
      };
    }),
    ...settlementsResult.rows.map((row) => ({
      id: `settlement:${row.id}`,
      type: 'SETTLEMENT',
      title: 'Settlement recorded',
      message: `${row.from_name} paid ${row.to_name}`,
      groupId: row.group_id,
      groupName: row.group_name,
      currency: row.currency,
      amount: toAmount(row.amount_minor),
      createdAt: row.settled_at,
    })),
  ];

  return notifications
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);
}

module.exports = { getNotifications, sendGroupInvitationEmail };
