const { createClient } = require('@libsql/client');
const config = require('./index');
const schema = require('../../db/schema');

let client = null;

function getClient() {
  if (!client) {
    const { url, authToken } = config.turso;

    if (!url) {
      throw new Error('TURSO_DATABASE_URL is required. See server/.env.example.');
    }

    const isLocalFile = url.startsWith('file:');
    if (!isLocalFile && !authToken) {
      throw new Error('TURSO_AUTH_TOKEN is required for a remote Turso database.');
    }

    client = createClient({
      url,
      ...(authToken ? { authToken } : {}),
    });
  }
  return client;
}

function createTestClient(testDbPath) {
  return createClient({
    url: `file:${testDbPath}`,
  });
}

async function initializeDatabase(db = null) {
  const database = db || getClient();

  // Enable WAL mode for better concurrency with local SQLite
  if (config.turso.url.startsWith('file:')) {
    await database.execute('PRAGMA journal_mode = WAL');
    await database.execute('PRAGMA busy_timeout = 5000');
  }

  await database.execute('PRAGMA foreign_keys = ON');
  for (const statement of schema) {
    await database.execute(statement);
  }

  const expenseColumns = await database.execute('PRAGMA table_info(expenses)');
  if (!expenseColumns.rows.some((column) => column.name === 'updated_at')) {
    await database.execute(
      "ALTER TABLE expenses ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
    );
  }
  await database.execute(
    "UPDATE expenses SET updated_at = created_at WHERE updated_at = ''",
  );

  return database;
}

async function closeDatabase() {
  if (client) {
    await client.close();
    client = null;
  }
}

module.exports = {
  getClient,
  createTestClient,
  initializeDatabase,
  closeDatabase,
};