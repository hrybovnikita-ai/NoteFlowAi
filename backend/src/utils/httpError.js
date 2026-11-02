class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED", details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { HttpError };
