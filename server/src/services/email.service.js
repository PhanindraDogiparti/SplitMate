const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    const emailCfg = config.email || {};
    console.info(
      `[EMAIL] Initializing SMTP (${emailCfg.host || 'localhost'}:${emailCfg.port || 587}, secure=${Boolean(emailCfg.secure)}), from=${emailCfg.from || 'noreply@splitmate.app'}`
    );

    const hasAuthUser = Boolean(emailCfg.auth && emailCfg.auth.user);

    transporter = nodemailer.createTransport({
      host: emailCfg.host,
      port: Number(emailCfg.port) || 587,
      secure: Boolean(emailCfg.secure),
      ...(hasAuthUser
        ? {
            auth: {
              user: emailCfg.auth.user,
              pass: emailCfg.auth.pass || '',
            },
          }
        : {}),
    });
  }
  return transporter;
}

function formatINR(value, currency = 'INR') {
  const safeCurrency = currency || 'INR';
  const num = Number(value);
  const safeNum = Number.isFinite(num) ? num : 0;

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safeNum);
  } catch {
    return `${safeCurrency} ${safeNum.toFixed(2)}`;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveParticipantAmounts(totalAmount, splitMethod, participants = [], currency = 'INR') {
  const list = Array.isArray(participants) ? participants : [];
  if (list.length === 0) return [];

  const totalPaise = Math.max(0, Math.round((Number(totalAmount) || 0) * 100));
  const mode = String(splitMethod || 'EQUAL').toUpperCase();

  if (mode === 'EQUAL') {
    const basePaise = Math.floor(totalPaise / list.length);
    let remainderPaise = totalPaise - basePaise * list.length;

    return list.map((p) => {
      const extra = remainderPaise > 0 ? 1 : 0;
      if (remainderPaise > 0) remainderPaise -= 1;
      return {
        name: p.name || 'Member',
        amount: (basePaise + extra) / 100,
        metaLabel: 'Equal split',
      };
    });
  }

  if (mode === 'EXACT') {
    return list.map((p) => {
      const rawRupees = Number(p.owed ?? p.amount ?? 0);
      const paise = Math.max(
        0,
        Math.round((Number.isFinite(rawRupees) ? rawRupees : 0) * 100)
      );
      return {
        name: p.name || 'Member',
        amount: paise / 100,
        metaLabel: 'Exact amount',
      };
    });
  }

  if (mode === 'PERCENTAGE') {
    const pcts = list.map((p) => {
      const rawPct = Number(p.percentage ?? p.percent ?? p.owed ?? 0);
      return Number.isFinite(rawPct) && rawPct > 0 ? rawPct : 0;
    });

    const rawPaise = pcts.map((pct) => Math.floor((totalPaise * pct) / 100));
    let remainderPaise = totalPaise - rawPaise.reduce((sum, val) => sum + val, 0);

    return list.map((p, idx) => {
      const extra = remainderPaise > 0 ? 1 : 0;
      if (remainderPaise > 0) remainderPaise -= 1;
      return {
        name: p.name || 'Member',
        amount: (rawPaise[idx] + extra) / 100,
        metaLabel: `${pcts[idx]}%`,
      };
    });
  }

  // SHARES (with optional +/- adjustment in rupees)
  const adjustmentsPaise = list.map((p) => {
    const adjRupees = Number(p.adjustment ?? p.adjust ?? 0);
    return Number.isFinite(adjRupees) ? Math.round(adjRupees * 100) : 0;
  });

  const shareWeights = list.map((p) => {
    const rawShare = Number(p.shares ?? p.share ?? p.owed ?? 1);
    return Number.isFinite(rawShare) && rawShare >= 0 ? rawShare : 1;
  });

  const totalAdjustPaise = adjustmentsPaise.reduce((sum, val) => sum + val, 0);
  const poolPaise = Math.max(0, totalPaise - totalAdjustPaise);
  const totalShares = shareWeights.reduce((sum, val) => sum + val, 0);

  if (totalShares <= 0) {
    return list.map((p, idx) => ({
      name: p.name || 'Member',
      amount: Math.max(0, adjustmentsPaise[idx]) / 100,
      metaLabel: '0 shares',
    }));
  }

  const rawPoolPaise = shareWeights.map((weight) =>
    Math.floor((poolPaise * weight) / totalShares)
  );
  let remainderPaise = poolPaise - rawPoolPaise.reduce((sum, val) => sum + val, 0);

  return list.map((p, idx) => {
    const extra = remainderPaise > 0 ? 1 : 0;
    if (remainderPaise > 0) remainderPaise -= 1;
    const finalPaise = Math.max(0, adjustmentsPaise[idx] + rawPoolPaise[idx] + extra);
    const adjRupees = adjustmentsPaise[idx] / 100;
    const adjText =
      adjRupees > 0
        ? ` + ${formatINR(adjRupees, currency)}`
        : adjRupees < 0
          ? ` - ${formatINR(Math.abs(adjRupees), currency)}`
          : '';

    return {
      name: p.name || 'Member',
      amount: finalPaise / 100,
      metaLabel: `${shareWeights[idx]} ${shareWeights[idx] === 1 ? 'share' : 'shares'}${adjText}`,
    };
  });
}

async function sendOTPEmail({ to, otp, purpose = 'login', name }) {
  if (!to) {
    return { success: false, error: 'Recipient email ("to") is missing.' };
  }

  const mailClient = getTransporter();
  const purposes = {
    login: { subject: 'Your SplitMate Login OTP', action: 'sign in' },
    register: { subject: 'Your SplitMate Registration OTP', action: 'complete registration' },
    'reset-password': { subject: 'Your SplitMate Password Reset OTP', action: 'reset your password' },
  };

  const { subject, action } = purposes[purpose] || purposes.login;
  const expiryMinutes = config.otp?.expiryMinutes || 10;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; background: #f4f3ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(79, 70, 229, 0.08);">
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 24px 16px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700;">SplitMate</h1>
              <p style="margin: 4px 0 0; color: #e0e7ff; font-size: 12px;">One-Time Verification Code</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 20px; text-align: center;">
              <p style="margin: 0 0 12px; color: #4b5563; font-size: 14px;">
                ${name ? `Hi ${escapeHtml(name)}, use` : 'Use'} this OTP to ${escapeHtml(action)}:
              </p>
              <div style="background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 12px; padding: 18px; margin: 16px 0;">
                <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; font-family: monospace;">${escapeHtml(otp)}</span>
              </div>
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                This OTP expires in ${escapeHtml(expiryMinutes)} minutes. If you didn&apos;t request this, ignore this email.
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

  const text = `SplitMate - Your One-Time Password\n\nYour OTP: ${otp}\n\nUse this OTP to ${action}.\nThis OTP expires in ${expiryMinutes} minutes.\n\nIf you didn't request this, please ignore this email.`;

  try {
    const info = await mailClient.sendMail({
      from: config.email?.from,
      to,
      subject,
      text,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] OTP send error:', {
      to,
      code: error.code,
      response: error.response,
      message: error.message,
    });
    return { success: false, error: error.message };
  }
}

async function sendSplitSummaryEmail({
  to,
  name,
  expenseTitle,
  totalAmount,
  payerName,
  splitMethod,
  participants,
  currency,
  expenseId,
  groupId,
}) {
  if (!to) {
    return { success: false, error: 'Recipient email ("to") is missing.' };
  }

  const mailClient = getTransporter();
  const activeCurrency = currency || 'INR';
  const numericTotal = Number(totalAmount) || 0;
  const normalizedMethod = String(splitMethod || 'EQUAL').toUpperCase();

  const baseUrl = (config.clientWebUrl || 'http://localhost:5173').replace(/\/+$/, '');
  const reportUrl = groupId
    ? `${baseUrl}/groups/${groupId}`
    : `${baseUrl}/transactions`;

  const computedSplits = resolveParticipantAmounts(
    numericTotal,
    normalizedMethod,
    participants,
    activeCurrency
  );

  const participantRowsHtml = computedSplits
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; text-align: left;">
          <div style="font-weight: 600; color: #1f2937; font-size: 13px;">${escapeHtml(item.name)}</div>
          <div style="color: #6b7280; font-size: 11px;">${escapeHtml(item.metaLabel)}</div>
        </td>
        <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 700; color: #4f46e5; white-space: nowrap; font-size: 13px;">
          ${escapeHtml(formatINR(item.amount, activeCurrency))}
        </td>
      </tr>
    `
    )
    .join('');

  const participantLinesText = computedSplits
    .map(
      (item) =>
        `• ${item.name} (${item.metaLabel}): ${formatINR(item.amount, activeCurrency)}`
    )
    .join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SplitMate - Expense Split Summary</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="min-width: 100%; background: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 20px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(79, 70, 229, 0.08);">
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 24px 16px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">SplitMate</h1>
              <p style="margin: 4px 0 0; color: #e0e7ff; font-size: 12px;">Expense Split Summary</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding: 0 0 12px 0;">
                    <h2 style="margin: 0 0 4px 0; font-size: 16px; color: #1f2937; font-weight: 700;">${escapeHtml(expenseTitle)}</h2>
                    <p style="margin: 0; color: #6b7280; font-size: 12px;">Hi ${escapeHtml(name || 'there')}, here is how this bill was split.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 12px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 12px; text-align: center;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding: 2px 0;">
                          <span style="color: #1f2937; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">${escapeHtml(formatINR(numericTotal, activeCurrency))}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0 0 0;">
                          <p style="margin: 0; color: #4b5563; font-size: 12px;"><strong>Paid by:</strong> ${escapeHtml(payerName)}</p>
                          <p style="margin: 2px 0 0; color: #4b5563; font-size: 12px;"><strong>Split mode:</strong> ${escapeHtml(normalizedMethod)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 0 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td colspan="2" style="padding: 0 0 6px 0;">
                          <p style="margin: 0; color: #374151; font-size: 12px; font-weight: 700;">Split among ${computedSplits.length} people:</p>
                        </td>
                      </tr>
                      ${participantRowsHtml}
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 20px 0 6px 0; text-align: center;">
                    <a href="${escapeHtml(reportUrl)}" style="display: inline-block; padding: 11px 24px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 13px; font-weight: 600;">
                      View Full Details
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding: 14px 0 0 0; font-size: 11px;">
                    <p style="margin: 0; color: #9ca3af;">If you didn&apos;t participate in this expense, please ignore this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `SplitMate - Expense Split Summary\n\nExpense: ${expenseTitle}\nTotal Amount: ${formatINR(numericTotal, activeCurrency)}\nPaid by: ${payerName}\nSplit mode: ${normalizedMethod}\n\nSplit among ${computedSplits.length} people:\n${participantLinesText}\n\nView full details: ${reportUrl}\n\nIf you didn't participate in this expense, please ignore this email.`;

  try {
    const info = await mailClient.sendMail({
      from: config.email?.from,
      to,
      subject: `SplitMate: ${expenseTitle} (${formatINR(numericTotal, activeCurrency)})`,
      text,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Split summary send error:', {
      to,
      expenseId,
      code: error.code,
      response: error.response,
      message: error.message,
    });
    return { success: false, error: error.message };
  }
}

async function sendWelcomeEmail({ to, name }) {
  if (!to) {
    return { success: false, error: 'Recipient email ("to") is missing.' };
  }

  const mailClient = getTransporter();
  const baseUrl = (config.clientWebUrl || 'http://localhost:5173').replace(/\/+$/, '');
  const safeName = escapeHtml(name || 'there');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; background: #f4f3ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 560px; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(79, 70, 229, 0.08);">
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 28px 16px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700;">Welcome to SplitMate, ${safeName}!</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 20px; text-align: center;">
              <p style="margin: 0 0 20px; color: #4b5563; font-size: 14px;">
                Start splitting bills effortlessly with friends, roommates, and trip groups.
              </p>
              <a href="${escapeHtml(baseUrl)}" style="display: inline-block; background: #4f46e5; color: #ffffff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-size: 13px; font-weight: 600;">
                Get Started
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `Welcome to SplitMate, ${name || 'there'}!\n\nStart splitting bills effortlessly with friends and family.\n\nGet started: ${baseUrl}`;

  try {
    const info = await mailClient.sendMail({
      from: config.email?.from,
      to,
      subject: 'Welcome to SplitMate!',
      text,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Welcome send error:', {
      to,
      code: error.code,
      response: error.response,
      message: error.message,
    });
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendSplitSummaryEmail,
};