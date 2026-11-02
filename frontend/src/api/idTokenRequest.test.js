import assert from "node:assert/strict";
import { test } from "node:test";
import { sendWithFreshIdToken } from "./idTokenRequest.js";

function fetchResponse(status, payload) {
  return {
    status,
    clone: () => ({ json: async () => payload }),
  };
}

test("a backend INVALID_TOKEN response refreshes once and retries with the new Firebase token", async () => {
  const tokenCalls = [];
  const sentTokens = [];
  const user = { getIdToken: async force => { tokenCalls.push(force); return force ? "fresh-token" : "cached-token"; } };
  const response = await sendWithFreshIdToken(user, async token => {
    sentTokens.push(token);
    return token === "cached-token"
      ? fetchResponse(401, { error: { code: "INVALID_TOKEN" } })
      : fetchResponse(200, {});
  });

  assert.deepEqual(tokenCalls, [undefined, true]);
  assert.deepEqual(sentTokens, ["cached-token", "fresh-token"]);
  assert.equal(response.status, 200);
});

test("ordinary authorization errors do not trigger token refresh", async () => {
  const tokenCalls = [];
  const user = { getIdToken: async force => { tokenCalls.push(force); return "cached-token"; } };
  const response = await sendWithFreshIdToken(user, async () => fetchResponse(401, { error: { code: "UNAUTHENTICATED" } }));
  assert.equal(response.status, 401);
  assert.deepEqual(tokenCalls, [undefined]);
});

test("a refreshed token is never retried a second time", async () => {
  const tokenCalls = [];
  let attempts = 0;
  const user = { getIdToken: async force => { tokenCalls.push(force); return force ? "fresh-token" : "cached-token"; } };
  const response = await sendWithFreshIdToken(user, async () => {
    attempts += 1;
    return fetchResponse(401, { error: { code: "INVALID_TOKEN" } });
  });
  assert.equal(response.status, 401);
  assert.equal(attempts, 2);
  assert.deepEqual(tokenCalls, [undefined, true]);
});

test("axios-style INVALID_TOKEN errors are retried with a force-refreshed token", async () => {
  const tokenCalls = [];
  const sentTokens = [];
  const user = { getIdToken: async force => { tokenCalls.push(force); return force ? "fresh-token" : "cached-token"; } };
  const result = await sendWithFreshIdToken(user, async token => {
    sentTokens.push(token);
    if (token === "cached-token") {
      throw { response: { status: 401, data: { error: { code: "INVALID_TOKEN" } } } };
    }
    return { status: 200 };
  });
  assert.equal(result.status, 200);
  assert.deepEqual(sentTokens, ["cached-token", "fresh-token"]);
  assert.deepEqual(tokenCalls, [undefined, true]);
});
