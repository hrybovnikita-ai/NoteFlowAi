const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { migrate } = require("./migrations");

function createDatabase(databasePath) {
  const resolvedPath = databasePath === ":memory:"
    ? databasePath
    : path.resolve(databasePath);

  if (resolvedPath !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

module.exports = { createDatabase };
