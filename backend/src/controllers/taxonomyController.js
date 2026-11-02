const { HttpError } = require("../utils/httpError");
const { requireObject, requireString } = require("../utils/validation");

function createTaxonomyController(db, kind) {
  const isCategory = kind === "categories";
  const table = isCategory ? "categories" : "tags";
  const maxName = isCategory ? 80 : 40;
  const safeId = (value) => {
    if (db.kind === "firestore") return db.safeId(value);
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "The resource ID is invalid.", "INVALID_ID");
    return id;
  };

  return {
    async list(req, res) {
      if (db.kind === "firestore") return res.json({ items: await db.listTaxonomy(req.user.id, kind) });
      const items = db.prepare(`SELECT id, name${isCategory ? ", color" : ""} FROM ${table} WHERE user_id = ? ORDER BY name COLLATE NOCASE`)
        .all(req.user.id);
      res.json({ items });
    },
    async create(req, res) {
      requireObject(req.body);
      const name = requireString(req.body.name, "name", { min: 1, max: maxName });
      if (isCategory) {
        const color = req.body.color === undefined ? "#A855F7" : requireString(req.body.color, "color", { min: 4, max: 32 });
        if (!/^#[\da-fA-F]{6}$/.test(color)) throw new HttpError(400, "color must be a six-digit hexadecimal color.", "INVALID_INPUT");
        if (db.kind === "firestore") return res.status(201).json({ item: await db.mutateTaxonomy(req.user.id, kind, null, { name, color }) });
        const result = db.prepare("INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)").run(req.user.id, name, color);
        return res.status(201).json({ item: { id: Number(result.lastInsertRowid), name, color } });
      }
      if (db.kind === "firestore") return res.status(201).json({ item: await db.mutateTaxonomy(req.user.id, kind, null, { name }) });
      const result = db.prepare("INSERT INTO tags (user_id, name) VALUES (?, ?)").run(req.user.id, name);
      return res.status(201).json({ item: { id: Number(result.lastInsertRowid), name } });
    },
    async update(req, res) {
      requireObject(req.body);
      const id = safeId(req.params.id);
      const name = requireString(req.body.name, "name", { min: 1, max: maxName });
      if (isCategory) {
        const color = req.body.color === undefined ? "#A855F7" : requireString(req.body.color, "color", { min: 4, max: 32 });
        if (!/^#[\da-fA-F]{6}$/.test(color)) throw new HttpError(400, "color must be a six-digit hexadecimal color.", "INVALID_INPUT");
        if (db.kind === "firestore") return res.json({ item: await db.mutateTaxonomy(req.user.id, kind, id, { name, color }) });
        const result = db.prepare("UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?")
          .run(name, color, id, req.user.id);
        if (!result.changes) throw new HttpError(404, "Category not found.", "NOT_FOUND");
        return res.json({ item: { id, name, color } });
      }
      if (db.kind === "firestore") return res.json({ item: await db.mutateTaxonomy(req.user.id, kind, id, { name }) });
      const result = db.prepare("UPDATE tags SET name = ? WHERE id = ? AND user_id = ?").run(name, id, req.user.id);
      if (!result.changes) throw new HttpError(404, "Tag not found.", "NOT_FOUND");
      return res.json({ item: { id, name } });
    },
    async remove(req, res) {
      const id = safeId(req.params.id);
      if (db.kind === "firestore") { await db.mutateTaxonomy(req.user.id, kind, id, {}, true); return res.status(204).end(); }
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(id, req.user.id);
      if (!result.changes) throw new HttpError(404, `${isCategory ? "Category" : "Tag"} not found.`, "NOT_FOUND");
      res.status(204).end();
    },
  };
}

module.exports = { createTaxonomyController };
