const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { deleteApp } = require("firebase-admin/app");
const { getFirebaseAdminApp } = require("../src/services/firebaseAdmin");

const projectId = "noteflowai-73991";

function saveFirebaseEnvironment() {
  return Object.fromEntries([
    "NODE_ENV",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
  ].map(name => [name, process.env[name]]));
}

function restoreFirebaseEnvironment(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function serviceAccountFor(accountProjectId = projectId) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    type: "service_account",
    project_id: accountProjectId,
    private_key_id: "local-test-key",
    private_key: privateKey,
    client_email: "firebase-admin-test@noteflowai-73991.iam.gserviceaccount.com",
    client_id: "1234567890",
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

function clearCredentialEnvironment() {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

test("production rejects emulator hosts before initializing Firebase", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    projectId: process.env.FIREBASE_PROJECT_ID,
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST,
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  };
  process.env.NODE_ENV = "production";
  process.env.FIREBASE_PROJECT_ID = "noteflowai-73991";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  try {
    assert.throws(() => getFirebaseAdminApp(), /Emulators must not be enabled in production/);
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.projectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previous.projectId;
    if (previous.firestoreHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previous.firestoreHost;
    if (previous.authHost === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous.authHost;
  }
});

test("missing application credentials are reported as a Firebase configuration error", () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    projectId: process.env.FIREBASE_PROJECT_ID,
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST,
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  };
  process.env.NODE_ENV = "test";
  process.env.FIREBASE_PROJECT_ID = "noteflowai-73991";
  process.env.GOOGLE_APPLICATION_CREDENTIALS = `${__filename}.missing`;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  try {
    assert.throws(() => getFirebaseAdminApp(), error => error.code === "FIREBASE_ADMIN_NOT_CONFIGURED");
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.projectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previous.projectId;
    if (previous.credentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = previous.credentials;
    if (previous.serviceAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previous.serviceAccount;
    if (previous.firestoreHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previous.firestoreHost;
    if (previous.authHost === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous.authHost;
  }
});

test("service account JSON initializes Firebase Admin for the frontend project", async () => {
  const previous = saveFirebaseEnvironment();
  const serviceAccount = serviceAccountFor();
  process.env.NODE_ENV = "test";
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(serviceAccount);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  let app;
  try {
    app = getFirebaseAdminApp();
    assert.equal(app.options.projectId, projectId);
  } finally {
    if (app) await deleteApp(app);
    restoreFirebaseEnvironment(previous);
  }
});

test("service account project mismatch is rejected", () => {
  const previous = saveFirebaseEnvironment();
  process.env.NODE_ENV = "test";
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(serviceAccountFor("another-project"));
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  try {
    assert.throws(() => getFirebaseAdminApp(), error => error.code === "FIREBASE_ADMIN_NOT_CONFIGURED");
  } finally {
    restoreFirebaseEnvironment(previous);
  }
});

test("GOOGLE_APPLICATION_CREDENTIALS service account file initializes safely", async () => {
  const previous = saveFirebaseEnvironment();
  const directory = mkdtempSync(join(tmpdir(), "noteflow-firebase-test-"));
  const credentialPath = join(directory, "service-account.json");
  writeFileSync(credentialPath, JSON.stringify(serviceAccountFor()), { mode: 0o600 });
  process.env.NODE_ENV = "test";
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  let app;
  try {
    app = getFirebaseAdminApp();
    assert.equal(app.options.projectId, projectId);
  } finally {
    if (app) await deleteApp(app);
    restoreFirebaseEnvironment(previous);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Auth Emulator initializes without production credentials", async () => {
  const previous = saveFirebaseEnvironment();
  process.env.NODE_ENV = "development";
  process.env.FIREBASE_PROJECT_ID = "demo-noteflow";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIRESTORE_EMULATOR_HOST;

  let app;
  try {
    app = getFirebaseAdminApp();
    assert.equal(app.options.projectId, "demo-noteflow");
  } finally {
    if (app) await deleteApp(app);
    restoreFirebaseEnvironment(previous);
  }
});
