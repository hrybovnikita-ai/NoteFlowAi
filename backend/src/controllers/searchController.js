const { HttpError } = require("../utils/httpError");
const { parseInteger, requireString } = require("../utils/validation");
const { searchNotes } = require("../services/noteService");

function createSearchController(db) {
  return function search(req, res) {
    const query = requireString(req.query.q || "", "q", { max: 200 });
    const page = parseInteger(req.query.page, "page", { fallback: 1, min: 1, max: 100000 });
    const limit = parseInteger(req.query.limit, "limit", { fallback: 100, min: 1, max: 100 });
    if (!query) throw new HttpError(400, "Provide a search query in q.", "INVALID_QUERY");
    res.json(searchNotes(db, req.user.id, query, { page, limit }));
  };
}

module.exports = { createSearchController };
