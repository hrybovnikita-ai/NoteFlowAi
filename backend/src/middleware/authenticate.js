const { HttpError } = require("../utils/httpError");

function createAuthenticate({ db, verifyIdToken }) {
  return async function authenticate(req, res, next) {
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return next(new HttpError(401, "A Firebase ID token is required.", "UNAUTHENTICATED"));
    }

    let verified = false;
    try {
      const claims = await verifyIdToken(match[1]);
      if (!claims?.uid || typeof claims.email !== "string" || !claims.email) {
        throw new HttpError(401, "The Firebase ID token has no valid user identity.", "INVALID_TOKEN");
      }

      verified = true;
      if (db.kind === 'firestore' || db.kind === "postgres") {
        req.user = await db.profile(claims);
        return next();
      }
      const upsert = db.prepare(`
        INSERT INTO users (firebase_uid, email, display_name, avatar_url)
        VALUES (@uid, @email, @displayName, @avatarUrl)
        ON CONFLICT(firebase_uid) DO UPDATE SET
          email = excluded.email,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url
      `);
      upsert.run({
        uid: claims.uid,
        email: claims.email,
        displayName: claims.name || "",
        avatarUrl: claims.picture || "",
      });

      const user = db.prepare("SELECT id, firebase_uid, email, display_name, avatar_url FROM users WHERE firebase_uid = ?")
        .get(claims.uid);
      req.user = {
        id: user.id,
        firebaseUid: user.firebase_uid,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        provider: claims.firebase?.sign_in_provider || "unknown",
      };
      return next();
    } catch (error) {
      if (error.code === "FIREBASE_ADMIN_NOT_CONFIGURED") {
        return next(new HttpError(503, "Firebase Admin authentication is not configured on the server.", "AUTH_NOT_CONFIGURED"));
      }
      if (error instanceof HttpError) return next(error);
      if (verified) return next(new HttpError(503, 'Your account could not be synchronized. Please retry.', 'PROFILE_SYNC_FAILED'));
      return next(new HttpError(401, "The Firebase ID token is invalid or expired.", "INVALID_TOKEN"));
    }
  };
}

module.exports = { createAuthenticate };
