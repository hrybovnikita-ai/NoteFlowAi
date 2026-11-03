const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const EXPECTED_FIREBASE_PROJECT_ID = "noteflowai-73991";

function configurationError(message) {
  return Object.assign(new Error(message), { code: "FIREBASE_ADMIN_NOT_CONFIGURED" });
}

function parseServiceAccount(json, projectId) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(json);
  } catch {
    throw configurationError("Firebase Admin service account JSON is invalid.");
  }
  if (
    !serviceAccount
    || typeof serviceAccount !== "object"
    || typeof serviceAccount.client_email !== "string"
    || typeof serviceAccount.private_key !== "string"
    || !serviceAccount.private_key
  ) {
    throw configurationError("Firebase Admin credentials must be a service account JSON object.");
  }
  if (serviceAccount.project_id !== projectId) {
    throw configurationError("Firebase Admin service account project_id must match FIREBASE_PROJECT_ID.");
  }
  return {
    ...serviceAccount,
    private_key: serviceAccount.private_key.replace(/\\n/g, "\n"),
  };
}

function getFirebaseAdminApp() {
  const emulatorEnabled = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (process.env.NODE_ENV === "production" && emulatorEnabled) {
    throw configurationError("Emulators must not be enabled in production.");
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw configurationError("FIREBASE_PROJECT_ID is not configured.");
  }
  if (!emulatorEnabled && projectId !== EXPECTED_FIREBASE_PROJECT_ID) {
    throw configurationError(`FIREBASE_PROJECT_ID must match the frontend Firebase project (${EXPECTED_FIREBASE_PROJECT_ID}).`);
  }

  const existing = getApps().find(candidate => candidate.name === "noteflow-api");
  if (existing) {
    if (existing.options.projectId !== projectId) {
      throw configurationError("The existing Firebase Admin app is initialized for a different project.");
    }
    return existing;
  }
  if (emulatorEnabled) {
    return initializeApp({ projectId }, 'noteflow-api');
  }
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    credential = cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, projectId));
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credentialsPath = resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!existsSync(credentialsPath)) {
      throw configurationError("The file configured by GOOGLE_APPLICATION_CREDENTIALS was not found.");
    }
    let credentialsJson;
    try {
      credentialsJson = readFileSync(credentialsPath, "utf8");
    } catch {
      throw configurationError("The file configured by GOOGLE_APPLICATION_CREDENTIALS could not be read.");
    }
    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      throw configurationError("GOOGLE_APPLICATION_CREDENTIALS must point to a valid credentials JSON file.");
    }
    if (credentials?.type === "service_account") {
      credential = cert(parseServiceAccount(credentialsJson, projectId));
    } else {
      if (credentials?.project_id && credentials.project_id !== projectId) {
        throw configurationError("The GOOGLE_APPLICATION_CREDENTIALS project_id must match FIREBASE_PROJECT_ID.");
      }
      credential = applicationDefault();
    }
  } else {
    credential = applicationDefault();
  }

  const app = getApps().find((candidate) => candidate.name === "noteflow-api")
    ?? initializeApp({ credential, projectId }, "noteflow-api");
  return app;
}

function createFirebaseTokenVerifier() {
  const auth = getAuth(getFirebaseAdminApp());
  return (token) => auth.verifyIdToken(token, true);
}

module.exports = { createFirebaseTokenVerifier, getFirebaseAdminApp };
