const { HttpError } = require("../utils/httpError");
const { requireObject } = require("../utils/validation");

function publicProfile(user) {
  const provider = user.provider === "google.com"
    ? "Google"
    : user.provider === "password"
      ? "Email/password"
      : user.provider;
  return {
    uid: user.firebaseUid,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    provider,
  };
}

function createAuthController() {
  return {
    me(req, res) {
      res.json({ user: publicProfile(req.user) });
    },
    sync(req, res) {
      if (req.body !== undefined) {
        requireObject(req.body);
        if (Object.keys(req.body).length) {
          throw new HttpError(400, "The sync request must not contain profile or user identity fields.", "INVALID_INPUT");
        }
      }
      res.json({ synced: true, user: publicProfile(req.user) });
    },
  };
}

module.exports = { createAuthController };
