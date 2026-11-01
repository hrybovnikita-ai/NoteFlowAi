const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function createFirebaseTokenVerifier() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    const error = new Error("FIREBASE_PROJECT_ID is not configured.");
    error.code = "FIREBASE_ADMIN_NOT_CONFIGURED";
    throw error;
  }

  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
      error.code = "FIREBASE_ADMIN_NOT_CONFIGURED";
      throw error;
    }

    credential = cert({
      ...serviceAccount,
      private_key: serviceAccount.private_key?.replace(/\\n/g, "\n"),
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credential = applicationDefault();
  } else {
    const error = new Error("Configure Firebase Admin credentials using FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.");
    error.code = "FIREBASE_ADMIN_NOT_CONFIGURED";
    throw error;
  }

  const app = getApps().find((candidate) => candidate.name === "noteflow-api")
    ?? initializeApp({ credential, projectId }, "noteflow-api");
  const auth = getAuth(app);
  return (token) => auth.verifyIdToken(token, true);
}

module.exports = { createFirebaseTokenVerifier };
