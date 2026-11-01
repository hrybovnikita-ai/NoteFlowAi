import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthOperations } from "./authOperations.js";

function createHarness(overrides = {}) {
  const calls = [];
  const user = {
    displayName: "",
    reload: async () => calls.push(["reload"]),
    getIdToken: async (forceRefresh) => calls.push(["getIdToken", forceRefresh]),
  };
  const credential = { user };
  const auth = { currentUser: null };
  const sdk = {
    createUserWithEmailAndPassword: async (...args) => { calls.push(["register", ...args]); return credential; },
    googleProvider: { providerId: "google.com" },
    sendPasswordResetEmail: async (...args) => calls.push(["reset", ...args]),
    setPersistence: async (...args) => calls.push(["persistence", ...args]),
    signInWithEmailAndPassword: async (...args) => { calls.push(["login", ...args]); return credential; },
    signInWithPopup: async (...args) => { calls.push(["google", ...args]); return credential; },
    signOut: async (...args) => calls.push(["logout", ...args]),
    updateProfile: async (...args) => {
      calls.push(["updateProfile", ...args]);
      user.displayName = args[1].displayName;
    },
    ...overrides,
  };
  return {
    calls,
    user,
    auth,
    operations: createAuthOperations({ auth, firebaseError: "", persistence: "local", sdk }),
  };
}

test("registration creates a Firebase account, updates its display name, and persists the session", async () => {
  const { calls, user, operations } = createHarness();
  await operations.register("  Ada Lovelace  ", " ada@example.com ", "strong-password");

  assert.equal(user.displayName, "Ada Lovelace");
  assert.deepEqual(calls.map(([name]) => name), ["persistence", "register", "updateProfile", "reload", "getIdToken"]);
  assert.equal(calls[0][2], "local");
  assert.equal(calls[1][2], "ada@example.com");
  assert.deepEqual(calls[4], ["getIdToken", true]);
});

test("registration validates full name and signs out if profile update fails", async () => {
  const { calls, operations } = createHarness({
    updateProfile: async () => { throw new Error("profile update failed"); },
  });
  await assert.rejects(operations.register(" ", "ada@example.com", "strong-password"), /full name/i);
  await assert.rejects(operations.register("Ada", "ada@example.com", "strong-password"), /profile could not be saved/i);
  assert.equal(calls.some(([name]) => name === "logout"), true);
});

test("email login uses persistent Firebase email/password authentication", async () => {
  const { calls, operations } = createHarness();
  await operations.login(" ada@example.com ", "secret");
  assert.deepEqual(calls.map(([name]) => name), ["persistence", "login"]);
  assert.equal(calls[1][2], "ada@example.com");
});

test("Google login opens the configured provider with persistent auth", async () => {
  const { calls, operations } = createHarness();
  await operations.loginWithGoogle();
  assert.deepEqual(calls.map(([name]) => name), ["persistence", "google"]);
  assert.equal(calls[1][2].providerId, "google.com");
});

test("password reset uses Firebase without exposing account-existence decisions", async () => {
  const { calls, operations } = createHarness();
  await operations.sendPasswordReset(" ada@example.com ");
  assert.deepEqual(calls, [["reset", { currentUser: null }, "ada@example.com"]]);
});

test("logout delegates to Firebase signOut", async () => {
  const { calls, operations } = createHarness();
  await operations.logout();
  assert.deepEqual(calls, [["logout", { currentUser: null }]]);
});

test("operations do not fall back to demo auth when Firebase is unavailable", async () => {
  const operations = createAuthOperations({
    auth: null,
    firebaseError: "Firebase configuration is missing.",
    persistence: "local",
    sdk: {},
  });
  await assert.rejects(operations.login("a@example.com", "secret"), /Firebase configuration is missing/);
});
