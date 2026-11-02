const { HttpError } = require("../utils/httpError");

function requirePostgres(db) {
  return (req, res, next) => {
    if (db?.kind === "postgres") return next();
    return next(new HttpError(503, "This feature requires PostgreSQL storage (STORAGE_DRIVER=postgres).", "POSTGRES_REQUIRED"));
  };
}

module.exports = { requirePostgres };
