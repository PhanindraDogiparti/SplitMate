const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getClient } = require('../config/database');
const { ApiError } = require('../utils/errors');
const { generateId, timestamp, generateOTP } = require('../utils/helpers');
const config = require('../config');

const OTP_STORE = new Map(); // In production, use Redis

async function registerUser({ email, password, name, upiId }) {
  const db = getClient();
  const normalizedEmail = email.toLowerCase();

  const existingUser = await db.execute({
    sql: 'SELECT id FROM users WHERE email = ?',
    args: [normalizedEmail],
  });

  if (existingUser.rows.length > 0) {
    throw ApiError.conflict('Email already registered');
  }

  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const userId = generateId();
  const createdAt = timestamp();

  await db.execute({
    sql: `INSERT INTO users (id, email, password_hash, name, upi_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [userId, normalizedEmail, passwordHash, name, upiId?.trim() || null, createdAt, createdAt],
  });

  const token = generateToken({ id: userId, email: normalizedEmail, name });

  return {
    user: {
      id: userId,
      email: normalizedEmail,
      name,
      upiId: upiId?.trim() || null,
    },
    token,
  };
}

async function loginUser({ email, password }) {
  const db = getClient();
  const normalizedEmail = email.toLowerCase();

  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE email = ?',
    args: [normalizedEmail],
  });

  if (result.rows.length === 0) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password_hash);

  if (!validPassword) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const token = generateToken({ id: user.id, email: user.email, name: user.name });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      upiId: user.upi_id,
      avatarUrl: user.avatar_url,
    },
    token,
  };
}

async function getUserById(userId) {
  const db = getClient();

  const result = await db.execute({
    sql: 'SELECT id, email, name, upi_id, avatar_url, created_at, updated_at FROM users WHERE id = ?',
    args: [userId],
  });

  if (result.rows.length === 0) {
    throw ApiError.notFound('User not found');
  }

  return result.rows[0];
}

async function updateUserProfile(userId, updates) {
  const db = getClient();
  const allowedFields = ['name', 'upi_id', 'avatar_url'];
  const setClauses = [];
  const args = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      const dbKey = key === 'upiId' ? 'upi_id' : key === 'avatarUrl' ? 'avatar_url' : key;
      setClauses.push(`${dbKey} = ?`);
      args.push(value);
    }
  }

  if (setClauses.length === 0) {
    throw ApiError.badRequest('No valid fields to update');
  }

  setClauses.push('updated_at = ?');
  args.push(timestamp());
  args.push(userId);

  await db.execute({
    sql: `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
    args,
  });

  return getUserById(userId);
}

async function changePassword(userId, currentPassword, newPassword) {
  const db = getClient();

  const result = await db.execute({
    sql: 'SELECT password_hash FROM users WHERE id = ?',
    args: [userId],
  });

  if (result.rows.length === 0) {
    throw ApiError.notFound('User not found');
  }

  const validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!validPassword) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);

  await db.execute({
    sql: 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    args: [passwordHash, timestamp(), userId],
  });

  return { success: true };
}

function generateToken(payload) {
  return jwt.sign(
    { userId: payload.id, email: payload.email, name: payload.name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

function storeOTP(email, otp, purpose = 'login') {
  const key = `${email}:${purpose}`;
  OTP_STORE.set(key, {
    otp,
    purpose,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
  });
}

function verifyOTP(email, otp, purpose = 'login') {
  const key = `${email}:${purpose}`;
  const stored = OTP_STORE.get(key);

  if (!stored) {
    return { valid: false, error: 'OTP not found or expired' };
  }

  if (Date.now() > stored.expiresAt) {
    OTP_STORE.delete(key);
    return { valid: false, error: 'OTP expired' };
  }

  if (stored.attempts >= 3) {
    OTP_STORE.delete(key);
    return { valid: false, error: 'Too many attempts' };
  }

  stored.attempts += 1;
  OTP_STORE.set(key, stored);

  if (stored.otp !== otp) {
    return { valid: false, error: 'Invalid OTP' };
  }

  OTP_STORE.delete(key);
  return { valid: true };
}

async function requestOTP({ email, purpose = 'login' }) {
  const otp = generateOTP(config.otp.length);
  storeOTP(email, otp, purpose);

  return { success: true, message: 'OTP sent to email', otp };
}

async function verifyOTPAndAuth({ email, otp, purpose = 'login', name, password, upiId }) {
  const verification = verifyOTP(email, otp, purpose);

  if (!verification.valid) {
    throw ApiError.badRequest(verification.error);
  }

  if (purpose === 'register') {
    return registerUser({ email, password, name, upiId });
  }

  if (purpose === 'login') {
    return loginUser({ email, password: '' }); // Password not needed for OTP login
  }

  if (purpose === 'reset-password') {
    return resetPasswordWithOTP({ email, otp, password });
  }

  throw ApiError.badRequest('Invalid OTP purpose');
}

async function resetPasswordWithOTP({ email, otp, password }) {
  const verification = verifyOTP(email, otp, 'reset-password');

  if (!verification.valid) {
    throw ApiError.badRequest(verification.error);
  }

  const db = getClient();
  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);

  const result = await db.execute({
    sql: 'UPDATE users SET password_hash = ?, updated_at = ? WHERE email = ?',
    args: [passwordHash, timestamp(), email.toLowerCase()],
  });

  if (result.rowsAffected === 0) {
    throw ApiError.notFound('User not found');
  }

  return { success: true, message: 'Password reset successful' };
}

module.exports = {
  registerUser,
  loginUser,
  getUserById,
  updateUserProfile,
  changePassword,
  generateToken,
  verifyToken,
  requestOTP,
  verifyOTPAndAuth,
  resetPasswordWithOTP,
};