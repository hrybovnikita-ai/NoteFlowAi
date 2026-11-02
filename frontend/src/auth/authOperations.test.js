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
    emailCredential: (...args) => ({ providerId: "password", args }),
    linkWithCredential: async (...args) => {
      calls.push(["linkGoogle", ...args]);
      return { user: args[0] };
    },
    sendPasswordResetEmail: async (...args) => calls.push(["reset", ...args]),
    setPersistence: async (...args) => calls.push(["persistence", ...args]),
    signInWithEmailAndPassword: async (...args) => { calls.push(["login", ...args]); return credential; },
    signInWithPopup: async (...args) => { calls.push(["google", ...args]); return credential; },
    signInWithRedirect: async (...args) => { calls.push(["googleRedirect", ...args]); },
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
  assert.equal(calls.some(([name]) => name === "register"), false);
});

test("Google login falls back to redirect when the popup is blocked", async () => {
  const { calls, operations } = createHarness({
    signInWithPopup: async () => { throw Object.assign(new Error("blocked"), { code: "auth/popup-blocked" }); },
  });
  const result = await operations.loginWithGoogle();
  assert.deepEqual(result, { redirecting: true });
  assert.deepEqual(calls.map(([name]) => name), ["persistence", "googleRedirect"]);
});

test("existing password accounts can link a pending Google credential without creating another user", async () => {
  const { calls, auth, operations } = createHarness();
  auth.currentUser = { uid: "existing-user" };
  const googleCredential = { providerId: "google.com" };
  const result = await operations.linkPendingGoogleAccount(googleCredential);
  assert.equal(result.user.uid, "existing-user");
  assert.deepEqual(calls, [["linkGoogle", auth.currentUser, googleCredential]]);
  assert.equal(calls.some(([name]) => name === "register"), false);
});

test("Google accounts can add password sign-in without creating another user", async () => {
  const { calls, auth, operations } = createHarness();
  auth.currentUser = { uid: "google-user", email: "ada@example.com" };
  const result = await operations.linkEmailPassword("strong-password");
  assert.equal(result.user.uid, "google-user");
  assert.deepEqual(calls, [["linkGoogle", auth.currentUser, {
    providerId: "password",
    args: ["ada@example.com", "strong-password"],
  }]]);
  assert.equal(calls.some(([name]) => name === "register"), false);
});

test("password linking requires the currently signed-in account to have an email", async () => {
  const { auth, operations } = createHarness();
  auth.currentUser = { uid: "google-user", email: null };
  await assert.rejects(operations.linkEmailPassword("strong-password"), /email address/i);
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
