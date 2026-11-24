const crypto = require('crypto');

function toMinorUnits(amount) {
  const minorUnits = Math.round(amount * 100);
  if (!Number.isSafeInteger(minorUnits)) {
    throw new Error('Amount is outside the supported range.');
  }
  return minorUnits;
}

function toAmount(minorUnits) {
  return Number(minorUnits) / 100;
}

function timestamp() {
  return new Date().toISOString();
}

function generateId() {
  return crypto.randomUUID();
}

function allocateEqualShares(amountMinor, members) {
  const baseShare = Math.floor(amountMinor / members.length);
  const remainder = amountMinor % members.length;
  return members.map((member, index) => ({
    memberId: member.id,
    amountMinor: baseShare + (index < remainder ? 1 : 0),
  }));
}

function generateOTP(length = 6) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

module.exports = {
  toMinorUnits,
  toAmount,
  timestamp,
  generateId,
  allocateEqualShares,
  generateOTP,
};