require('dotenv').config();

const express = require('express');
const logger = require('morgan');
const cors = require('cors');
const config = require('./config');
const { errorHandler } = require('./utils/errors');
const { initializeDatabase } = require('./config/database');
const apiRouter = require('./routes');

const app = express();

const normalizeOrigin = (origin) => origin.trim().replace(/\/+$/, '');

const configuredOrigins = (config.clientWebUrl || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const developmentOrigins = config.nodeEnv === 'production'
  ? []
  : [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
  ].map(normalizeOrigin);

const allowedOrigins = [...new Set([...configuredOrigins, ...developmentOrigins])];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.locals.initializeDatabase = initializeDatabase;

app.use(logger('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use('/api/v1', apiRouter);
app.use('/api/v1', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

app.use(errorHandler);

module.exports = app;