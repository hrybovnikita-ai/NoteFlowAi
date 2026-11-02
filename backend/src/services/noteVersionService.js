const { randomUUID } = require("node:crypto");
const { HttpError } = require("../utils/httpError");
const { diffWords, isMeaningfulChange, summarizeChange } = require("../utils/textDiff");

const MAX_VERSIONS_PER_NOTE = Number(process.env.NOTE_VERSION_LIMIT || 40);

async function getLatestVersionNumber(client, uid, noteId) {
  const result = await client.query(
    "SELECT version_number FROM note_versions WHERE user_id = $1 AND note_id = $2 ORDER BY version_number DESC LIMIT 1",
    [uid, noteId],
  );
  return result.rows[0]?.version_number ?? 0;
}

async function maybeSaveNoteVersion(client, uid, snapshot) {
  const latest = await client.query(
    "SELECT title, content FROM note_versions WHERE user_id = $1 AND note_id = $2 ORDER BY version_number DESC LIMIT 1",
    [uid, snapshot.id],
  );
  const previous = latest.rows[0];
  if (previous && previous.title === snapshot.title && previous.content === snapshot.content) return;
  if (!previous && !isMeaningfulChange("", snapshot.content) && !snapshot.title.trim()) return;
  if (previous && !isMeaningfulChange(`${previous.title}\n${previous.content}`, `${snapshot.title}\n${snapshot.content}`)) return;

  const count = Number((await client.query(
    "SELECT count(*)::int AS count FROM note_versions WHERE user_id = $1 AND note_id = $2",
    [uid, snapshot.id],
  )).rows[0].count);
  if (count >= MAX_VERSIONS_PER_NOTE) {
    await client.query(
      `DELETE FROM note_versions WHERE id IN (
         SELECT id FROM note_versions WHERE user_id = $1 AND note_id = $2
         ORDER BY version_number ASC LIMIT 1
       )`,
      [uid, snapshot.id],
    );
  }

  const versionNumber = (await getLatestVersionNumber(client, uid, snapshot.id)) + 1;
  const changeSummary = previous
    ? summarizeChange(`${previous.title}\n${previous.content}`, `${snapshot.title}\n${snapshot.content}`)
    : "Initial saved version";
  await client.query(
    `INSERT INTO note_versions (id, note_id, user_id, version_number, title, content, change_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), snapshot.id, uid, versionNumber, snapshot.title, snapshot.content, changeSummary],
  );
}

function createNoteVersionService(db) {
  if (db.kind !== "postgres") {
    throw new Error("Note version service requires PostgreSQL.");
  }

  return {
    async list(uid, noteId) {
      const result = await db.query(
        `SELECT id, version_number AS "versionNumber", title, change_summary AS "changeSummary", created_at AS "createdAt"
         FROM note_versions WHERE user_id = $1 AND note_id = $2 ORDER BY version_number DESC`,
        [uid, noteId],
      );
      return result.rows;
    },
    async get(uid, noteId, versionId) {
      const result = await db.query(
        `SELECT id, version_number AS "versionNumber", title, content, change_summary AS "changeSummary", created_at AS "createdAt"
         FROM note_versions WHERE user_id = $1 AND note_id = $2 AND id = $3`,
        [uid, noteId, versionId],
      );
      return result.rows[0] || null;
    },
    async compare(uid, noteId, leftId, rightId) {
      const left = await this.get(uid, noteId, leftId);
      const right = await this.get(uid, noteId, rightId);
      if (!left || !right) throw new HttpError(404, "Version not found.", "NOT_FOUND");
      return {
        left,
        right,
        diff: diffWords(`${left.title}\n${left.content}`, `${right.title}\n${right.content}`),
      };
    },
    async restore(uid, noteId, versionId) {
      const version = await this.get(uid, noteId, versionId);
      if (!version) throw new HttpError(404, "Version not found.", "NOT_FOUND");
      const { getNoteSnapshot, applyNoteFields } = db;
      return db.transaction(async client => {
        const current = await getNoteSnapshot(uid, noteId, client.query.bind(client));
        if (!current) throw new HttpError(404, "Note not found.", "NOT_FOUND");
        await maybeSaveNoteVersion(client, uid, current);
        await client.query(
          "UPDATE notes SET title = $1, content = $2, updated_at = now() WHERE id = $3 AND user_id = $4",
          [version.title, version.content, noteId, uid],
        );
        const restored = await getNoteSnapshot(uid, noteId, client.query.bind(client));
        await maybeSaveNoteVersion(client, uid, restored);
        return restored;
      });
    },
    maybeSaveNoteVersion,
  };
}

module.exports = { createNoteVersionService, maybeSaveNoteVersion, MAX_VERSIONS_PER_NOTE };
