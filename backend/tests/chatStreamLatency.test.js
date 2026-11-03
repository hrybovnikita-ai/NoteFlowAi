const { beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/database/connection");

process.env.NODE_ENV = "test";

const users = {
  alice: { uid: "firebase-alice", email: "alice@example.test", name: "Alice", picture: "", firebase: { sign_in_provider: "password" } },
};

function auth() {
  return { Authorization: "Bearer alice" };
}

function createDelayedChatAi(preStreamDelayMs = 40) {
  let openedAt = 0;
  return {
    service: {
      async open() {
        openedAt = Date.now();
        await new Promise(resolve => setTimeout(resolve, preStreamDelayMs));
        return {};
      },
      async *events() {
        yield { text: "Hello" };
      },
    },
    openedAt: () => openedAt,
  };
}

let db;
let app;
let chatAi;

beforeEach(() => {
  db = createDatabase(":memory:");
  chatAi = createDelayedChatAi();
  app = createApp({
    db,
    chatAiService: chatAi.service,
    verifyIdToken: async token => users[token],
  });
});

test("chat stream emits start before model work completes", async () => {
  const conversation = await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  const turnId = "11111111-1111-4111-8111-111111111111";
  const startedAt = Date.now();
  const response = await request(app)
    .post(`/api/chat/conversations/${conversation.body.item.id}/messages/stream`)
    .set(auth())
    .set("X-AI-Request-Id", "22222222-2222-4222-8222-222222222222")
    .send({ turnId, message: "Speed check" })
    .expect(200);
  const startIndex = response.text.indexOf("event: start");
  const deltaIndex = response.text.indexOf("event: delta");
  assert.ok(startIndex >= 0, "start event missing");
  assert.ok(deltaIndex > startIndex, "delta must follow start");
  assert.ok(startIndex < 240, "start event should appear at the beginning of the SSE payload");
  assert.ok(Date.now() - startedAt >= 35, "upstream delay should still occur before completion");
});
