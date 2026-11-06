const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/database/connection");
const { createGeminiService, mapGeminiError } = require("../src/services/geminiService");
const { HttpError } = require("../src/utils/httpError");

process.env.NODE_ENV = "test";

const claims = {
  alice: { uid: "ai-alice", email: "alice@example.test", name: "Alice", picture: "" },
  bob: { uid: "ai-bob", email: "bob@example.test", name: "Bob", picture: "" },
};

function createTestApi(aiService, plan = "plus") {
  const db = createDatabase(":memory:");
  if (plan !== "free") {
    db.prepare("INSERT INTO billing_accounts (firebase_uid, plan, status, period_end) VALUES (?, ?, 'active', ?)")
      .run("ai-alice", plan, Math.floor(Date.now() / 1000) + 86400);
  }
  const app = createApp({
    db,
    aiService,
    verifyIdToken: async (token) => {
      if (!claims[token]) throw Object.assign(new Error("invalid token"), { code: "auth/invalid-id-token" });
      return claims[token];
    },
  });
  return { app, db };
}

function auth(user = "alice") {
  return { Authorization: `Bearer ${user}` };
}

const generated = {
  summarize: "A concise summary.",
  improve: "The revised note.",
  "fix-grammar": "The grammar-fixed note.",
  translate: "The translated note.",
  keypoints: "- First point\n- Second point",
  title: "A useful title",
  tags: ["research", "planning", "ideas"],
  ask: "The answer from the note.",
};

test("AI endpoints require Firebase authentication", async (t) => {
  const { app, db } = createTestApi({ generate: async () => ({ result: "unused" }) });
  t.after(() => db.close());
  await request(app).post("/api/ai/summarize").send({ content: "A note" }).expect(401);
  await request(app).post("/api/ai/summarize").set(auth("invalid")).send({ content: "A note" }).expect(401);
});

test("AI actions return consistent JSON results from the service", async (t) => {
  const calls = [];
  const { app, db } = createTestApi({
    generate: async (action, input) => {
      calls.push({ action, input });
      return { result: generated[action] };
    },
  });
  t.after(() => db.close());

  for (const action of ["summarize", "improve", "fix-grammar", "translate", "keypoints", "title", "tags", "ask"]) {
    const body = { title: "Test", content: "A note about planning." };
    if (action === "ask") body.question = "What is this about?";
    const response = await request(app)
      .post(`/api/ai/${encodeURIComponent(action)}`)
      .set(auth())
      .send(body)
      .expect(200);
    assert.deepEqual(response.body, { result: generated[action] });
  }
  assert.equal(calls.length, 8);
  assert.equal(calls[7].input.question, "What is this about?");
});

test("Free accounts cannot call paid AI summaries", async t => {
  const { app, db } = createTestApi({ generate: async () => ({ result: "not generated" }) }, "free");
  t.after(() => db.close());
  const response = await request(app).post("/api/ai/summarize").set(auth()).send({ content: "A private note." }).expect(403);
  assert.equal(response.body.error.code, "FEATURE_REQUIRES_PAID_PLAN");
});

test("AI failures and retries consume quota without charging a duplicate request ID twice", async t => {
  let calls = 0;
  const { app, db } = createTestApi({ generate: async () => {
    calls += 1;
    throw new HttpError(429, "Gemini rate limit or quota reached. Please try again later.", "GEMINI_QUOTA_EXCEEDED");
  } });
  t.after(() => db.close());
  const requestId = "b9e8a88a-a53b-4382-85a9-cbb9ce08b93e";
  await request(app).post("/api/ai/improve").set(auth()).set("X-AI-Request-Id", requestId)
    .send({ content: "A note." }).expect(429);
  const status = await request(app).get("/api/ai/usage").set(auth()).expect(200);
  assert.equal(status.body.usage.used, 1);
  await request(app).post("/api/ai/improve").set(auth()).set("X-AI-Request-Id", requestId)
    .send({ content: "A note." }).expect(409);
  assert.equal(calls, 1);
  await request(app).post("/api/ai/improve").set(auth()).set("X-AI-Request-Id", "a52b8ed4-1760-4bdb-b889-67b3a617965a")
    .send({ content: "A note." }).expect(429);
  assert.equal((await request(app).get("/api/ai/usage").set(auth())).body.usage.used, 2);
});

test("AI requests reject malformed input and unsupported fields", async (t) => {
  const { app, db } = createTestApi({ generate: async () => ({ result: "unused" }) });
  t.after(() => db.close());

  await request(app).post("/api/ai/summarize").set(auth()).send({ content: "  " }).expect(400);
  await request(app).post("/api/ai/ask").set(auth()).send({ content: "Note text" }).expect(400);
  await request(app).post("/api/ai/title").set(auth()).send({ content: "Note", userId: "someone-else" }).expect(400);
  await request(app).post("/api/ai/unknown").set(auth()).send({ content: "Note" }).expect(404);
});

test("AI endpoints only process saved notes owned by the authenticated user", async (t) => {
  let generateCalls = 0;
  const { app, db } = createTestApi({ generate: async () => {
    generateCalls += 1;
    return { result: "summary" };
  } });
  t.after(() => db.close());
  const note = await request(app)
    .post("/api/notes")
    .set(auth())
    .send({ title: "Private", content: "Owner-only text" })
    .expect(201);

  const response = await request(app)
    .post("/api/ai/summarize")
    .set(auth("bob"))
    .send({ noteId: note.body.item.id })
    .expect(404);
  assert.equal(response.body.error.code, "NOT_FOUND");
  assert.equal(generateCalls, 0);

  await request(app)
    .post("/api/ai/summarize")
    .set(auth())
    .send({ noteId: note.body.item.id })
    .expect(200);
  assert.equal(generateCalls, 1);
});

test("missing Gemini API key returns an explicit configuration error", async (t) => {
  const service = createGeminiService({ apiKey: "", client: { models: { generateContent: async () => ({ text: "unused" }) } } });
  const { app, db } = createTestApi(service);
  t.after(() => db.close());

  const response = await request(app)
    .post("/api/ai/summarize")
    .set(auth())
    .send({ content: "Short note." })
    .expect(503);
  assert.deepEqual(response.body.error, {
    code: "GEMINI_NOT_CONFIGURED",
    message: "Gemini is not configured. Set GEMINI_API_KEY in backend/.env.",
  });
});

test("Gemini SDK is called with the configured model and handles tag JSON", async (t) => {
  let received;
  const service = createGeminiService({
    apiKey: "test-key",
    model: "test-model",
    client: {
      models: {
        generateContent: async (options) => {
          received = options;
          return { text: '["research", "planning", "ideas"]' };
        },
      },
    },
  });
  const { app, db } = createTestApi(service);
  t.after(() => db.close());

  const response = await request(app)
    .post("/api/ai/tags")
    .set(auth())
    .send({ title: "Planning", content: "Organize the project plan." })
    .expect(200);
  assert.deepEqual(response.body, { result: ["research", "planning", "ideas"] });
  assert.equal(received.model, "test-model");
  assert.equal(received.config.maxOutputTokens, 2048);
  assert.equal(received.config.responseMimeType, "application/json");
});

test("Gemini quota errors return a safe rate-limit response", async (t) => {
  const service = createGeminiService({
    apiKey: "test-key",
    client: {
      models: {
        generateContent: async () => {
          const error = new Error("private provider response");
          error.status = 429;
          throw error;
        },
      },
    },
  });
  const { app, db } = createTestApi(service);
  t.after(() => db.close());

  const response = await request(app)
    .post("/api/ai/improve")
    .set(auth())
    .send({ content: "A short note." })
    .expect(429);
  assert.equal(response.body.error.code, "GEMINI_QUOTA_EXCEEDED");
  assert.equal(response.body.error.message, "Gemini rate limit or quota reached. Please try again later.");
  assert.equal(JSON.stringify(response.body).includes("private provider response"), false);
});

test("Gemini model and network failures map to safe client errors", () => {
  const unavailable = mapGeminiError(Object.assign(new Error("model not found"), { status: 404 }));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.code, "GEMINI_MODEL_UNAVAILABLE");

  const network = mapGeminiError(Object.assign(new Error("fetch failed"), { code: "ENOTFOUND" }));
  assert.equal(network.status, 502);
  assert.equal(network.code, "GEMINI_UPSTREAM_UNAVAILABLE");
});
