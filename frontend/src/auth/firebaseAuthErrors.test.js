import assert from "node:assert/strict";
import { test } from "node:test";
import { getFirebaseAuthMessage } from "./firebaseAuthErrors.js";

test("generic credential errors explain Google accounts without claiming the password is wrong", () => {
  const message = getFirebaseAuthMessage({ code: "auth/invalid-credential" });
  assert.match(message, /couldn't verify/i);
  assert.match(message, /registered with Google/i);
  assert.doesNotMatch(message, /email or password is incorrect/i);
});

test("Google account collisions explain how to use and link the existing account", () => {
  const message = getFirebaseAuthMessage({ code: "auth/account-exists-with-different-credential" }, "google");
  assert.match(message, /sign in with that method/i);
  assert.match(message, /same account/i);
});

test("Firebase setup errors identify project, domain, and provider problems", () => {
  assert.match(getFirebaseAuthMessage({ code: "auth/unauthorized-domain" }), /Authorized domains/);
  assert.match(getFirebaseAuthMessage({ code: "auth/operation-not-allowed" }, "google"), /Google provider/);
  assert.match(getFirebaseAuthMessage({ code: "auth/invalid-project-id" }), /noteflowai-73991/);
});

test("account-linking errors explain existing providers without suggesting duplicate registration", () => {
  assert.match(getFirebaseAuthMessage({ code: "auth/email-already-in-use" }, "link"), /existing method/i);
  assert.match(getFirebaseAuthMessage({ code: "auth/credential-already-in-use" }, "link"), /already linked to another/i);
  assert.match(getFirebaseAuthMessage({ code: "auth/requires-recent-login" }, "link"), /sign back in/i);
});
