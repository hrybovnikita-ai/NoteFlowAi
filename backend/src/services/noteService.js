const { randomUUID } = require("node:crypto");
const { HttpError } = require("../utils/httpError");

const SORT_COLUMNS = new Set(["created_at", "updated_at", "title"]);

function getNote(db, userId, id) {
  if (db.kind === "firestore") return db.getNote(userId, id);
  const row = db.prepare(`
    SELECT n.id, n.title, n.content, n.is_favorite, n.is_archived,
      n.created_at, n.updated_at, c.name AS collection
    FROM notes n
    LEFT JOIN categories c ON c.id = n.category_id AND c.user_id = n.user_id
    WHERE n.id = ? AND n.user_id = ?
  `).get(id, userId);

  if (!row) return null;
  const tags = db.prepare(`
    SELECT t.name FROM tags t
    JOIN note_tags nt ON nt.tag_id = t.id
    WHERE nt.note_id = ? AND t.user_id = ?
    ORDER BY t.name COLLATE NOCASE
  `).all(id, userId).map((tag) => tag.name);

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    favorite: Boolean(row.is_favorite),
    archived: Boolean(row.is_archived),
    collection: row.collection || "",
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listNotes(db, userId, { page, limit, sort, order, archived, favorite }) {
  if (db.kind === "firestore") return db.listNotes(userId, { page, limit, sort, order, archived, favorite });
  if (!SORT_COLUMNS.has(sort)) throw new HttpError(400, "Unsupported sort field.", "INVALID_QUERY");
  const conditions = ["n.user_id = ?", "n.is_archived = ?"];
  const values = [userId, Number(archived)];
  if (favorite !== undefined) {
    conditions.push("n.is_favorite = ?");
    values.push(Number(favorite));
  }
  const where = conditions.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS count FROM notes n WHERE ${where}`).get(...values).count;
  const rows = db.prepare(`
    SELECT n.id FROM notes n
    WHERE ${where}
    ORDER BY n.${sort} ${order === "asc" ? "ASC" : "DESC"}
    LIMIT ? OFFSET ?
  `).all(...values, limit, (page - 1) * limit);

  return {
    items: rows.map(({ id }) => getNote(db, userId, id)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

function upsertCategory(db, userId, name) {
  if (!name) return null;
  db.prepare("INSERT INTO categories (user_id, name) VALUES (?, ?) ON CONFLICT(user_id, name) DO NOTHING")
    .run(userId, name);
  return db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = ?").get(userId, name)?.id ?? null;
}

function replaceTags(db, userId, noteId, names) {
  db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(noteId);
  const insertTag = db.prepare("INSERT INTO tags (user_id, name) VALUES (?, ?) ON CONFLICT(user_id, name) DO NOTHING");
  const selectTag = db.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ?");
  const insertLink = db.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)");
  for (const name of names) {
    insertTag.run(userId, name);
    const tag = selectTag.get(userId, name);
    if (tag) insertLink.run(noteId, tag.id);
  }
}

function createNote(db, userId, input, options = {}) {
  if (db.kind === "firestore") return db.createNote(userId, input, options);
  const id = randomUUID();
  const now = new Date().toISOString();
  const create = db.transaction(() => {
    if (Number.isSafeInteger(options.maxNotes)) {
      const count = db.prepare("SELECT COUNT(*) AS count FROM notes WHERE user_id = ?").get(userId).count;
      if (count >= options.maxNotes) {
        throw new HttpError(403, `Your plan allows up to ${options.maxNotes} notes. Upgrade to save more.`, "NOTE_LIMIT_REACHED", {
          limit: options.maxNotes,
          used: count,
        });
      }
    }
    const categoryId = upsertCategory(db, userId, input.collection);
    db.prepare(`
      INSERT INTO notes (id, user_id, category_id, title, content, is_favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, categoryId, input.title, input.content, Number(input.favorite), now, now);
    replaceTags(db, userId, id, input.tags);
  });
  create();
  return getNote(db, userId, id);
}

function updateNote(db, userId, id, changes) {
  if (db.kind === "firestore") return db.updateNote(userId, id, changes);
  const existing = getNote(db, userId, id);
  if (!existing) return null;
  const next = { ...existing, ...changes };
  const update = db.transaction(() => {
    let categoryId;
    if (Object.hasOwn(changes, "collection")) categoryId = upsertCategory(db, userId, changes.collection);
    else categoryId = db.prepare("SELECT category_id FROM notes WHERE id = ? AND user_id = ?").get(id, userId).category_id;

    db.prepare(`
      UPDATE notes SET category_id = ?, title = ?, content = ?, is_favorite = ?, is_archived = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      categoryId,
      next.title,
      next.content,
      Number(next.favorite),
      Number(next.archived),
      new Date().toISOString(),
      id,
      userId,
    );
    if (Object.hasOwn(changes, "tags")) replaceTags(db, userId, id, changes.tags);
  });
  update();
  return getNote(db, userId, id);
}

function deleteNote(db, userId, id) {
  if (db.kind === "firestore") return db.deleteNote(userId, id);
  return db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

function searchNotes(db, userId, query, { page, limit }) {
  if (db.kind === "firestore") return db.searchNotes(userId, query, { page, limit });
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) || [];
  if (!tokens.length) return { items: [], pagination: { page, limit, total: 0, pages: 0 } };
  const match = tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(" OR ");
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM note_search s JOIN notes n ON n.id = s.note_id
    WHERE note_search MATCH ? AND n.user_id = ? AND n.is_archived = 0
  `).get(match, userId).count;
  const rows = db.prepare(`
    SELECT n.id FROM note_search s JOIN notes n ON n.id = s.note_id
    WHERE note_search MATCH ? AND n.user_id = ? AND n.is_archived = 0
    ORDER BY n.updated_at DESC LIMIT ? OFFSET ?
  `).all(match, userId, limit, (page - 1) * limit);

  return {
    items: rows.map(({ id }) => getNote(db, userId, id)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

module.exports = { createNote, deleteNote, getNote, listNotes, searchNotes, updateNote };
