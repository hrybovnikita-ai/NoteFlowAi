const { HttpError } = require("../utils/httpError");

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "BODY_TOO_LARGE", message: "Request body exceeds the allowed size." } });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must contain valid JSON." } });
  }
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: { code: "DUPLICATE_RESOURCE", message: "A resource with that name already exists." } });
  }

  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof HttpError ? error.message : "An unexpected server error occurred.";
  if (status >= 500) console.error("API request failed with internal error code:", error.code || "UNKNOWN");
  return res.status(status).json({ error: { code, message } });
}

module.exports = { errorHandler };
