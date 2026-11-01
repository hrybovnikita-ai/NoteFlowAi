const { HttpError } = require("../utils/httpError");
const { requireObject, requireString } = require("../utils/validation");

function createTaxonomyController(db, kind) {
  const isCategory = kind === "categories";
  const table = isCategory ? "categories" : "tags";
  const maxName = isCategory ? 80 : 40;
  const safeId = (value) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "The resource ID is invalid.", "INVALID_ID");
    return id;
  };

  return {
    list(req, res) {
      const items = db.prepare(`SELECT id, name${isCategory ? ", color" : ""} FROM ${table} WHERE user_id = ? ORDER BY name COLLATE NOCASE`)
        .all(req.user.id);
      res.json({ items });
    },
    create(req, res) {
      requireObject(req.body);
      const name = requireString(req.body.name, "name", { min: 1, max: maxName });
      if (isCategory) {
        const color = req.body.color === undefined ? "#A855F7" : requireString(req.body.color, "color", { min: 4, max: 32 });
        if (!/^#[\da-fA-F]{6}$/.test(color)) throw new HttpError(400, "color must be a six-digit hexadecimal color.", "INVALID_INPUT");
        const result = db.prepare("INSERT INTO categories (user_id, name, color) VALUES (?, ?, ?)").run(req.user.id, name, color);
        return res.status(201).json({ item: { id: Number(result.lastInsertRowid), name, color } });
      }
      const result = db.prepare("INSERT INTO tags (user_id, name) VALUES (?, ?)").run(req.user.id, name);
      return res.status(201).json({ item: { id: Number(result.lastInsertRowid), name } });
    },
    update(req, res) {
      requireObject(req.body);
      const id = safeId(req.params.id);
      const name = requireString(req.body.name, "name", { min: 1, max: maxName });
      if (isCategory) {
        const color = req.body.color === undefined ? "#A855F7" : requireString(req.body.color, "color", { min: 4, max: 32 });
        if (!/^#[\da-fA-F]{6}$/.test(color)) throw new HttpError(400, "color must be a six-digit hexadecimal color.", "INVALID_INPUT");
        const result = db.prepare("UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?")
          .run(name, color, id, req.user.id);
        if (!result.changes) throw new HttpError(404, "Category not found.", "NOT_FOUND");
        return res.json({ item: { id, name, color } });
      }
      const result = db.prepare("UPDATE tags SET name = ? WHERE id = ? AND user_id = ?").run(name, id, req.user.id);
      if (!result.changes) throw new HttpError(404, "Tag not found.", "NOT_FOUND");
      return res.json({ item: { id, name } });
    },
    remove(req, res) {
      const id = safeId(req.params.id);
      const result = db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(id, req.user.id);
      if (!result.changes) throw new HttpError(404, `${isCategory ? "Category" : "Tag"} not found.`, "NOT_FOUND");
      res.status(204).end();
    },
  };
}

module.exports = { createTaxonomyController };
