const schema = `
  CREATE TABLE IF NOT EXISTS billing_accounts (
    firebase_uid TEXT PRIMARY KEY,
    customer_id TEXT UNIQUE,
    subscription_id TEXT UNIQUE,
    plan TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'free',
    period_start INTEGER,
    period_end INTEGER,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT,
    checkout_id TEXT,
    checkout_plan TEXT,
    checkout_key TEXT,
    checkout_started INTEGER,
    lock_owner TEXT,
    lock_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS billing_events (id TEXT PRIMARY KEY, processed_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ai_usage_daily (
    firebase_uid TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (firebase_uid, usage_date)
  );
  CREATE TABLE IF NOT EXISTS ai_usage_requests (
    firebase_uid TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    request_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (firebase_uid, usage_date, request_id)
  );
  CREATE TABLE IF NOT EXISTS ai_usage_global_daily (
    usage_date TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    firebase_uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#A855F7',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, name)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, name)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New chat',
    message_count INTEGER NOT NULL DEFAULT 0,
    active_turn_id TEXT,
    lock_until INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'failed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (conversation_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_updated
    ON chat_conversations(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_seq
    ON chat_messages(conversation_id, seq);

  CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_user_favorite ON notes(user_id, is_favorite);
  CREATE INDEX IF NOT EXISTS idx_notes_user_archived ON notes(user_id, is_archived);
  CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
  CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
  CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(
    note_id UNINDEXED,
    user_id UNINDEXED,
    title,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS notes_search_insert AFTER INSERT ON notes BEGIN
    INSERT INTO note_search(note_id, user_id, title, content)
    VALUES (new.id, new.user_id, new.title, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS notes_search_update AFTER UPDATE OF title, content, user_id ON notes BEGIN
    DELETE FROM note_search WHERE note_id = old.id;
    INSERT INTO note_search(note_id, user_id, title, content)
    VALUES (new.id, new.user_id, new.title, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS notes_search_delete AFTER DELETE ON notes BEGIN
    DELETE FROM note_search WHERE note_id = old.id;
  END;
`;

function migrate(db) {
  const currentVersion = db.pragma("user_version", { simple: true });
  if (currentVersion > 4) {
    throw new Error(`Database schema version ${currentVersion} is newer than this API supports.`);
  }
  db.transaction(() => {
    db.exec(schema);
    if (currentVersion < 4) db.pragma("user_version = 4");
  })();
}

module.exports = { migrate };
