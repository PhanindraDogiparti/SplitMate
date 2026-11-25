module.exports = [
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    group_type TEXT NOT NULL DEFAULT 'OTHER',
    custom_type_label TEXT,
    currency TEXT NOT NULL DEFAULT 'INR',
    simplify_debts INTEGER NOT NULL DEFAULT 1 CHECK (simplify_debts IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    upi_id TEXT,
    role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')),
    net_balance_minor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (group_id, email)
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    paid_by_member_id TEXT NOT NULL REFERENCES group_members(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    split_type TEXT NOT NULL DEFAULT 'EQUAL',
    payment_method TEXT NOT NULL DEFAULT 'OTHER',
    expense_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    is_settled INTEGER NOT NULL DEFAULT 0 CHECK (is_settled IN (0, 1)),
    settled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS expense_splits (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES group_members(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
    UNIQUE (expense_id, member_id)
  )`,
  `CREATE TABLE IF NOT EXISTS expense_payers (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES group_members(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    UNIQUE (expense_id, member_id)
  )`,
  `CREATE TABLE IF NOT EXISTS expense_comments (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    from_member_id TEXT NOT NULL REFERENCES group_members(id),
    to_member_id TEXT NOT NULL REFERENCES group_members(id),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    payment_method TEXT NOT NULL DEFAULT 'OTHER',
    reference_id TEXT,
    remaining_after_minor INTEGER NOT NULL DEFAULT 0 CHECK (remaining_after_minor >= 0),
    settled_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    upi_id TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id)',
  'CREATE INDEX IF NOT EXISTS idx_group_members_lower_email ON group_members(lower(email))',
  'CREATE INDEX IF NOT EXISTS idx_expenses_group_date ON expenses(group_id, expense_date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_expenses_group_updated_at ON expenses(group_id, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_expense_payers_expense_id ON expense_payers(expense_id)',
  'CREATE INDEX IF NOT EXISTS idx_settlements_group_date ON settlements(group_id, settled_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_expense_comments_expense_id ON expense_comments(expense_id)',
  'CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token)',
  'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_expenses_group_is_settled ON expenses(group_id, is_settled)',
  `CREATE TABLE IF NOT EXISTS group_share_tokens (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_group_share_tokens_group_id ON group_share_tokens(group_id)',
  'CREATE INDEX IF NOT EXISTS idx_group_share_tokens_token ON group_share_tokens(token)',
];
