const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getFirebaseAdminApp } = require("../src/services/firebaseAdmin");

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
