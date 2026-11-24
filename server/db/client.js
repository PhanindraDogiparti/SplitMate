const { createClient } = require('@libsql/client');
const schema = require('./schema');

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  throw new Error('TURSO_DATABASE_URL is required. See server/.env.example.');
}

const isLocalFile = url.startsWith('file:');
if (!isLocalFile && !process.env.TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_AUTH_TOKEN is required for a remote Turso database.');
}

const client = createClient({
  url,
  ...(process.env.TURSO_AUTH_TOKEN
    ? { authToken: process.env.TURSO_AUTH_TOKEN }
    : {}),
});

async function initializeDatabase() {
  await client.execute('PRAGMA foreign_keys = ON');
  for (const statement of schema) {
    await client.execute(statement);
  }
}

module.exports = { client, initializeDatabase };
