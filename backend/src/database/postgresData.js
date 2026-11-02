const { randomUUID } = require("node:crypto");
const { HttpError } = require("../utils/httpError");
const { maybeSaveNoteVersion } = require("../services/noteVersionService");

const COLLECTION_DEFAULT = "#A855F7";
const DEFAULT_SETTINGS = Object.freeze({ defaultSort: "updated_at", compactNotes: false });

async function getNote(db, uid, id, query = db.query) {
  const result = await query(
    `SELECT n.id, n.title, n.content, n.is_favorite AS favorite, n.is_archived AS archived,
      n.created_at AS "createdAt", n.updated_at AS "updatedAt",
      coalesce(c.name, '') AS collection,
      coalesce(array_agg(DISTINCT t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
    FROM notes n
    LEFT JOIN collections c ON c.id = n.collection_id AND c.user_id = n.user_id
    LEFT JOIN note_tags nt ON nt.note_id = n.id AND nt.user_id = n.user_id
    LEFT JOIN tags t ON t.id = nt.tag_id AND t.user_id = n.user_id
    WHERE n.id = $1 AND n.user_id = $2
    GROUP BY n.id, c.name`,
    [id, uid],
  );
  return result.rows[0] || null;
}

async function upsertCollection(client, uid, name) {
  if (!name) return null;
  const result = await client.query(
    `INSERT INTO collections (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, name) DO UPDATE SET name = excluded.name
     RETURNING id`,
    [uid, name],
  );
  return result.rows[0].id;
}

async function replaceTags(client, uid, noteId, names) {
  await client.query("DELETE FROM note_tags WHERE note_id = $1 AND user_id = $2", [noteId, uid]);
  for (const name of names) {
    const tag = await client.query(
      `INSERT INTO tags (user_id, name) VALUES ($1, $2)
       ON CONFLICT (user_id, name) DO UPDATE SET name = excluded.name
       RETURNING id`,
      [uid, name],
    );
    await client.query(
      "INSERT INTO note_tags (user_id, note_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [uid, noteId, tag.rows[0].id],
    );
  }
}

async function createNote(db, uid, input, { maxNotes } = {}) {
  const id = randomUUID();
  return db.transaction(async client => {
    if (Number.isSafeInteger(maxNotes)) {
      const count = Number((await client.query("SELECT count(*)::int AS count FROM notes WHERE user_id = $1", [uid])).rows[0].count);
      if (count >= maxNotes) {
        throw new HttpError(403, `Your plan allows up to ${maxNotes} notes. Upgrade to save more.`, "NOTE_LIMIT_REACHED", { limit: maxNotes, used: count });
      }
    }
    const collectionId = await upsertCollection(client, uid, input.collection);
    await client.query(
      `INSERT INTO notes (id, user_id, collection_id, title, content, is_favorite, is_archived)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, uid, collectionId, input.title, input.content, input.favorite, input.archived],
    );
    await replaceTags(client, uid, id, input.tags);
    return getNote(db, uid, id, client.query.bind(client));
  });
}

async function updateNote(db, uid, id, changes) {
  return db.transaction(async client => {
    const existing = await getNote(db, uid, id, client.query.bind(client));
    if (!existing) return null;
    await maybeSaveNoteVersion(client, uid, existing);
    const next = { ...existing, ...changes };
    const collectionId = Object.hasOwn(changes, "collection")
      ? await upsertCollection(client, uid, changes.collection)
      : (await client.query("SELECT collection_id FROM notes WHERE id = $1 AND user_id = $2", [id, uid])).rows[0].collection_id;
    await client.query(
      `UPDATE notes SET collection_id = $1, title = $2, content = $3, is_favorite = $4,
       is_archived = $5, updated_at = now() WHERE id = $6 AND user_id = $7`,
      [collectionId, next.title, next.content, next.favorite, next.archived, id, uid],
    );
    if (Object.hasOwn(changes, "tags")) await replaceTags(client, uid, id, changes.tags);
    return getNote(db, uid, id, client.query.bind(client));
  });
}

async function getNoteSnapshot(db, uid, id, query = db.query) {
  return getNote(db, uid, id, query);
}

async function applyNoteFields(client, uid, id, fields) {
  await client.query(
    `UPDATE notes SET title = $1, content = $2, updated_at = now() WHERE id = $3 AND user_id = $4`,
    [fields.title, fields.content, id, uid],
  );
  return getNote({ query: client.query.bind(client) }, uid, id, client.query.bind(client));
}

function createPostgresData(db) {
  return {
    async profile(claims) {
      const result = await db.query(
        `INSERT INTO users (firebase_uid, email, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (firebase_uid) DO UPDATE SET email = excluded.email,
           display_name = excluded.display_name, avatar_url = excluded.avatar_url, updated_at = now()
         RETURNING firebase_uid, email, display_name, avatar_url`,
        [claims.uid, claims.email, claims.name || "", claims.picture || ""],
      );
      const user = result.rows[0];
      return {
        id: user.firebase_uid,
        firebaseUid: user.firebase_uid,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        provider: claims.firebase?.sign_in_provider || "unknown",
      };
    },
    getNote: (uid, id) => getNote(db, uid, id),
    async listNotes(uid, { page, limit, sort, order, archived, favorite }) {
      if (!["created_at", "updated_at", "title"].includes(sort)) throw new HttpError(400, "Unsupported sort field.", "INVALID_QUERY");
      const conditions = ["n.user_id = $1", `n.is_archived = $${favorite === undefined ? 2 : 3}`];
      const params = [uid];
      if (favorite !== undefined) {
        params.push(favorite);
        conditions.push(`n.is_favorite = $2`);
      }
      params.push(archived);
      const where = conditions.join(" AND ");
      const total = Number((await db.query(`SELECT count(*)::int AS count FROM notes n WHERE ${where}`, params)).rows[0].count);
      const offset = (page - 1) * limit;
      params.push(limit, offset);
      const rows = await db.query(
        `SELECT n.id FROM notes n WHERE ${where}
         ORDER BY n.${sort} ${order === "asc" ? "ASC" : "DESC"} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: await Promise.all(rows.rows.map(row => getNote(db, uid, row.id))),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    },
    createNote: (uid, input, options) => createNote(db, uid, input, options),
    updateNote: (uid, id, changes) => updateNote(db, uid, id, changes),
    getNoteSnapshot: (uid, id) => getNoteSnapshot(db, uid, id),
    applyNoteFields: (uid, id, fields) => db.transaction(client => applyNoteFields(client, uid, id, fields)),
    async deleteNote(uid, id) {
      return (await db.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [id, uid])).rowCount > 0;
    },
    async removeAllNotes(uid) {
      return (await db.query("DELETE FROM notes WHERE user_id = $1", [uid])).rowCount;
    },
    async searchNotes(uid, query, { page, limit }) {
      const terms = query.match(/[\p{L}\p{N}_]+/gu) || [];
      if (!terms.length) return { items: [], pagination: { page, limit, total: 0, pages: 0 } };
      const expression = terms.map(term => `'${term.replace(/'/g, "''")}':*`).join(" | ");
      const total = Number((await db.query(
        "SELECT count(*)::int AS count FROM notes WHERE user_id = $1 AND is_archived = false AND to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')) @@ to_tsquery('simple', $2)",
        [uid, expression],
      )).rows[0].count);
      const rows = await db.query(
        `SELECT id FROM notes WHERE user_id = $1 AND is_archived = false
         AND to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')) @@ to_tsquery('simple', $2)
         ORDER BY updated_at DESC LIMIT $3 OFFSET $4`,
        [uid, expression, limit, (page - 1) * limit],
      );
      return {
        items: await Promise.all(rows.rows.map(row => getNote(db, uid, row.id))),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      };
    },
    async listTaxonomy(uid, kind) {
      const table = kind === "categories" ? "collections" : "tags";
      const result = await db.query(
        `SELECT id, name${kind === "categories" ? ", color" : ""} FROM ${table} WHERE user_id = $1 ORDER BY lower(name)`,
        [uid],
      );
      return result.rows;
    },
    async mutateTaxonomy(uid, kind, id, value, remove = false) {
      const collection = kind === "categories";
      const table = collection ? "collections" : "tags";
      const idValue = id === null ? null : Number(id);
      return db.transaction(async client => {
        const existing = idValue === null
          ? null
          : (await client.query(`SELECT id, name FROM ${table} WHERE id = $1 AND user_id = $2`, [idValue, uid])).rows[0];
        if (idValue !== null && !existing) throw new HttpError(404, "Resource not found.", "NOT_FOUND");
        if (remove) {
          await client.query(`DELETE FROM ${table} WHERE id = $1 AND user_id = $2`, [idValue, uid]);
          return null;
        }
        const result = idValue === null
          ? await client.query(
            `INSERT INTO ${table} (user_id, name${collection ? ", color" : ""}) VALUES ($1, $2${collection ? ", $3" : ""}) RETURNING id`,
            collection ? [uid, value.name, value.color || COLLECTION_DEFAULT] : [uid, value.name],
          )
          : await client.query(
            `UPDATE ${table} SET name = $1${collection ? ", color = $2" : ""} WHERE id = $${collection ? 3 : 2} AND user_id = $${collection ? 4 : 3} RETURNING id`,
            collection ? [value.name, value.color || COLLECTION_DEFAULT, idValue, uid] : [value.name, idValue, uid],
          );
        return { id: result.rows[0].id, ...value };
      });
    },
    async getSettings(uid) {
      const result = await db.query("SELECT preferences FROM user_settings WHERE user_id = $1", [uid]);
      return result.rows[0]?.preferences || { ...DEFAULT_SETTINGS };
    },
    async saveSettings(uid, value) {
      await db.query(
        `INSERT INTO user_settings (user_id, preferences) VALUES ($1, $2::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET preferences = user_settings.preferences || excluded.preferences, updated_at = now()`,
        [uid, JSON.stringify(value)],
      );
      return this.getSettings(uid);
    },
  };
}

module.exports = { createPostgresData };
