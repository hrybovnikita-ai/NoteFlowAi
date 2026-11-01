const { HttpError } = require("./httpError");

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "A JSON object is required.", "INVALID_BODY");
  }
  return value;
}

function requireString(value, name, { min = 0, max = 1000, trim = true } = {}) {
  if (typeof value !== "string") {
    throw new HttpError(400, `${name} must be a string.`, "INVALID_INPUT");
  }
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) {
    throw new HttpError(400, `${name} must be between ${min} and ${max} characters.`, "INVALID_INPUT");
  }
  return result;
}

function optionalBoolean(value, name) {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${name} must be a boolean.`, "INVALID_INPUT");
  }
  return value;
}

function requireId(value) {
  if (typeof value !== "string" || value.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new HttpError(400, "The resource ID is invalid.", "INVALID_ID");
  }
  return value;
}

function parseInteger(value, name, { fallback, min, max }) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${name} must be an integer between ${min} and ${max}.`, "INVALID_QUERY");
  }
  return parsed;
}

module.exports = { optionalBoolean, parseInteger, requireId, requireObject, requireString };
