require('dotenv').config();

const express = require('express');
const logger = require('morgan');
const cors = require('cors');
const config = require('./config');
const { errorHandler } = require('./utils/errors');
const { initializeDatabase } = require('./config/database');
const apiRouter = require('./routes');

const app = express();
const configuredOrigins = config.clientWebUrl
  .split(',')
  .map((origin) => origin.trim())
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
  ];
const allowedOrigins = [...new Set([...configuredOrigins, ...developmentOrigins])];

app.locals.initializeDatabase = initializeDatabase;

app.use(logger('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cors({ origin: allowedOrigins }));

app.use('/api/v1', apiRouter);
app.use('/api/v1', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

app.use(errorHandler);

module.exports = app;