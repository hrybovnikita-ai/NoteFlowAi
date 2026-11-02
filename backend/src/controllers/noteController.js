const { HttpError } = require("../utils/httpError");
const { parseInteger, requireId, requireObject, requireString } = require("../utils/validation");
const { createNote, deleteNote, getNote, listNotes, updateNote } = require("../services/noteService");
const { createBillingStore } = require("../database/billingStore");
const { effectivePlan } = require("../services/aiUsageService");

const NOTE_FIELDS = new Set(["title", "content", "favorite", "archived", "collection", "tags"]);

function parseTags(value) {
  if (!Array.isArray(value) || value.length > 30) {
    throw new HttpError(400, "tags must be an array containing no more than 30 tags.", "INVALID_INPUT");
  }
  return [...new Set(value.map((tag) => requireString(tag, "Each tag", { max: 40 })).filter(Boolean))];
}

function parseNoteInput(body, { partial = false } = {}) {
  requireObject(body);
  for (const key of Object.keys(body)) {
    if (!NOTE_FIELDS.has(key)) throw new HttpError(400, `Unsupported note field: ${key}.`, "INVALID_INPUT");
  }
  if (!partial && (!Object.hasOwn(body, "title") || !Object.hasOwn(body, "content"))) {
    throw new HttpError(400, "title and content are required.", "INVALID_INPUT");
  }
  const result = {};
  if (Object.hasOwn(body, "title")) result.title = requireString(body.title, "title", { min: 1, max: 120 });
  if (Object.hasOwn(body, "content")) result.content = requireString(body.content, "content", { max: 50000, trim: false });
  if (Object.hasOwn(body, "favorite")) {
    if (typeof body.favorite !== "boolean") throw new HttpError(400, "favorite must be a boolean.", "INVALID_INPUT");
    result.favorite = body.favorite;
  }
  if (Object.hasOwn(body, "archived")) {
    if (typeof body.archived !== "boolean") throw new HttpError(400, "archived must be a boolean.", "INVALID_INPUT");
    result.archived = body.archived;
  }
  if (Object.hasOwn(body, "collection")) result.collection = requireString(body.collection, "collection", { max: 80 });
  if (Object.hasOwn(body, "tags")) result.tags = parseTags(body.tags);
  if (partial && !Object.keys(result).length) throw new HttpError(400, "At least one supported note field is required.", "INVALID_INPUT");
  if (!partial) {
    result.favorite ??= false;
    result.archived ??= false;
    result.collection ??= "";
    result.tags ??= [];
  }
  return result;
}

function parseListOptions(query) {
  const page = parseInteger(query.page, "page", { fallback: 1, min: 1, max: 100000 });
  const limit = parseInteger(query.limit, "limit", { fallback: 100, min: 1, max: 100 });
  const sort = query.sort || "updated_at";
  if (!["created_at", "updated_at", "title"].includes(sort)) throw new HttpError(400, "sort must be created_at, updated_at, or title.", "INVALID_QUERY");
  const order = query.order || "desc";
  if (!["asc", "desc"].includes(order)) throw new HttpError(400, "order must be asc or desc.", "INVALID_QUERY");
  if (query.archived !== undefined && !["true", "false"].includes(query.archived)) {
    throw new HttpError(400, "archived must be true or false.", "INVALID_QUERY");
  }
  if (query.favorite !== undefined && !["true", "false"].includes(query.favorite)) {
    throw new HttpError(400, "favorite must be true or false.", "INVALID_QUERY");
  }
  return {
    page,
    limit,
    sort,
    order,
    archived: query.archived === "true",
    favorite: query.favorite === undefined ? undefined : query.favorite === "true",
  };
}

function createNoteController(db) {
  const billing = createBillingStore(db);
  const noteLimits = { free: 30, plus: 500, team: null };
  return {
    async list(req, res) {
      res.json(await listNotes(db, req.user.id, parseListOptions(req.query)));
    },
    async create(req, res) {
      const account = await billing.ensure(req.user.firebaseUid);
      const plan = effectivePlan(account, Date.now());
      const note = await createNote(db, req.user.id, parseNoteInput(req.body), {
        maxNotes: noteLimits[plan],
      });
      res.status(201).json({ item: note });
    },
    async get(req, res) {
      const note = await getNote(db, req.user.id, requireId(req.params.id));
      if (!note) throw new HttpError(404, "Note not found.", "NOT_FOUND");
      res.json({ item: note });
    },
    async update(req, res) {
      const note = await updateNote(db, req.user.id, requireId(req.params.id), parseNoteInput(req.body, { partial: true }));
      if (!note) throw new HttpError(404, "Note not found.", "NOT_FOUND");
      res.json({ item: note });
    },
    async remove(req, res) {
      if (!await deleteNote(db, req.user.id, requireId(req.params.id))) throw new HttpError(404, "Note not found.", "NOT_FOUND");
      res.status(204).end();
    },
    async removeAll(req, res) {
      if (db.kind === 'firestore' || db.kind === 'postgres') return res.json({ deleted: await db.removeAllNotes(req.user.id) });
      const result = db.prepare("DELETE FROM notes WHERE user_id = ?").run(req.user.id);
      res.json({ deleted: result.changes });
    },
    async favorite(req, res) {
      requireObject(req.body);
      if (typeof req.body.favorite !== "boolean") throw new HttpError(400, "favorite must be a boolean.", "INVALID_INPUT");
      const note = await updateNote(db, req.user.id, requireId(req.params.id), { favorite: req.body.favorite });
      if (!note) throw new HttpError(404, "Note not found.", "NOT_FOUND");
      res.json({ item: note });
    },
    async archive(req, res) {
      requireObject(req.body);
      if (typeof req.body.archived !== "boolean") throw new HttpError(400, "archived must be a boolean.", "INVALID_INPUT");
      const note = await updateNote(db, req.user.id, requireId(req.params.id), { archived: req.body.archived });
      if (!note) throw new HttpError(404, "Note not found.", "NOT_FOUND");
      res.json({ item: note });
    },
  };
}

module.exports = { createNoteController, parseListOptions, parseNoteInput };
