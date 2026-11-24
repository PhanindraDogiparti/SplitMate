const jwt = require('jsonwebtoken');
const { getClient } = require('../config/database');
const { ApiError, asyncHandler } = require('../utils/errors');
const config = require('../config');

const authenticateToken = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    throw ApiError.unauthorized('Access token required');
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const db = getClient();

    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [decoded.userId],
    });

    if (result.rows.length === 0) {
      throw ApiError.unauthorized('Invalid token - user not found');
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw ApiError.unauthorized('Invalid token');
    }
    throw error;
  }
});

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  jwt.verify(token, config.jwt.secret, async (err, decoded) => {
    if (err) {
      return next();
    }

    try {
      const db = getClient();
      const result = await db.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [decoded.userId],
      });

      if (result.rows.length > 0) {
        req.user = result.rows[0];
      }
    } catch (error) {
      // Ignore errors for optional auth
    }
    next();
  });
}

module.exports = {
  authenticateToken,
  optionalAuth,
};