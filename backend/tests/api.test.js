const { afterEach, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/database/connection");

process.env.NODE_ENV = "test";

let db;
let app;
let chatCalls;
let failChat;
let chatContexts;

const mockChatAi = {
  async open(messages) {
    chatCalls += 1;
    chatContexts.push(messages);
    return { messages };
  },
  async *events() {
    if (failChat) throw new Error("upstream unavailable");
    yield { text: "Hello from NoteFlow." };
  },
};

const users = {
  alice: { uid: "firebase-alice", email: "alice@example.test", name: "Alice", picture: "", firebase: { sign_in_provider: "password" } },
  bob: { uid: "firebase-bob", email: "bob@example.test", name: "Bob", picture: "", firebase: { sign_in_provider: "google.com" } },
};

function auth(user = "alice") {
  return { Authorization: `Bearer ${user}` };
}

beforeEach(() => {
  chatCalls = 0;
  failChat = false;
  chatContexts = [];
  db = createDatabase(":memory:");
  app = createApp({
    db,
    chatAiService: mockChatAi,
    verifyIdToken: async (token) => {
      if (token === "expired") throw Object.assign(new Error("token expired"), { code: "auth/id-token-expired" });
      if (!users[token]) throw new Error("invalid token");
      return users[token];
    },
  });
});

afterEach(() => db.close());

test("health endpoint is public and returns service status", async () => {
  const response = await request(app).get("/api/health").expect(200);
  assert.deepEqual(response.body, { status: "ok", service: "NoteFlow AI API" });
});

test("protected API rejects missing and invalid Firebase ID tokens", async () => {
  await request(app).get("/api/notes").expect(401);
  const response = await request(app).get("/api/notes").set(auth("invalid")).expect(401);
  assert.equal(response.body.error.code, "INVALID_TOKEN");
  await request(app).get("/api/notes").set(auth("expired")).expect(401)
    .expect(result => assert.equal(result.body.error.code, "INVALID_TOKEN"));
});

test("auth profile and sync use only verified token identity", async () => {
  const alice = await request(app).get("/api/auth/me").set(auth()).expect(200);
  assert.deepEqual(alice.body.user, {
    uid: "firebase-alice",
    email: "alice@example.test",
    displayName: "Alice",
    avatarUrl: "",
    provider: "Email/password",
  });

  const bob = await request(app).post("/api/auth/sync").set(auth("bob")).send({}).expect(200);
  assert.equal(bob.body.synced, true);
  assert.equal(bob.body.user.uid, "firebase-bob");
  assert.equal(bob.body.user.provider, "Google");

  const forged = await request(app).post("/api/auth/sync").set(auth()).send({ uid: "firebase-bob", email: "bob@example.test" }).expect(400);
  assert.equal(forged.body.error.code, "INVALID_INPUT");
  await request(app).get("/api/auth/me").expect(401);
});

test("notes support create, read, update, favorite, archive, and delete", async () => {
  const created = await request(app).post("/api/notes").set(auth()).send({
    title: "First note",
    content: "Remember the launch checklist",
    tags: ["work", "launch"],
    collection: "Projects",
  }).expect(201);
  const noteId = created.body.item.id;
  assert.deepEqual(created.body.item.tags, ["launch", "work"]);
  assert.equal(created.body.item.collection, "Projects");

  const read = await request(app).get(`/api/notes/${noteId}`).set(auth()).expect(200);
  assert.equal(read.body.item.title, "First note");
  await request(app).patch(`/api/notes/${noteId}`).set(auth()).send({ title: "Updated note" }).expect(200);
  const favorite = await request(app).patch(`/api/notes/${noteId}/favorite`).set(auth()).send({ favorite: true }).expect(200);
  assert.equal(favorite.body.item.favorite, true);
  const archived = await request(app).patch(`/api/notes/${noteId}/archive`).set(auth()).send({ archived: true }).expect(200);
  assert.equal(archived.body.item.archived, true);
  await request(app).get("/api/notes").set(auth()).expect(200).expect((response) => assert.equal(response.body.pagination.total, 0));
  await request(app).get("/api/notes?archived=true").set(auth()).expect(200).expect((response) => assert.equal(response.body.items.length, 1));
  await request(app).delete(`/api/notes/${noteId}`).set(auth()).expect(204);
  await request(app).get(`/api/notes/${noteId}`).set(auth()).expect(404);
});

test("notes and searches are isolated by verified Firebase user", async () => {
  const created = await request(app).post("/api/notes").set(auth()).send({
    title: "Private journal",
    content: "lanterns in the garden",
    tags: [],
  }).expect(201);
  const noteId = created.body.item.id;

  await request(app).get("/api/notes").set(auth("bob")).expect(200).expect((response) => assert.equal(response.body.items.length, 0));
  await request(app).get(`/api/notes/${noteId}`).set(auth("bob")).expect(404);
  await request(app).patch(`/api/notes/${noteId}`).set(auth("bob")).send({ title: "Stolen" }).expect(404);
  await request(app).get("/api/search?q=lantern").set(auth("bob")).expect(200).expect((response) => assert.equal(response.body.items.length, 0));
  await request(app).get("/api/search?q=lantern").set(auth()).expect(200).expect((response) => assert.equal(response.body.items[0].id, noteId));
});

test("pagination, sorting, and input validation are enforced", async () => {
  for (const title of ["Alpha", "Beta", "Gamma"]) {
    await request(app).post("/api/notes").set(auth()).send({ title, content: "" }).expect(201);
  }
  const page = await request(app).get("/api/notes?page=2&limit=1&sort=title&order=asc").set(auth()).expect(200);
  assert.equal(page.body.pagination.total, 3);
  assert.equal(page.body.items[0].title, "Beta");
  await request(app).get("/api/notes?limit=1000").set(auth()).expect(400);
  await request(app).get("/api/notes?sort=created_at;DROP").set(auth()).expect(400);
  await request(app).post("/api/notes").set(auth()).send({ title: " ", content: "" }).expect(400);
  await request(app).post("/api/notes").set(auth()).send({ title: "Valid", content: "", user_id: 2 }).expect(400);
});

test("note counts enforce Free and Plus entitlements on the server", async () => {
  for (let index = 0; index < 30; index += 1) {
    await request(app).post("/api/notes").set(auth()).send({ title: `Note ${index}`, content: "" }).expect(201);
  }
  const limited = await request(app).post("/api/notes").set(auth()).send({ title: "Over the limit", content: "" }).expect(403);
  assert.equal(limited.body.error.code, "NOTE_LIMIT_REACHED");
  assert.equal(limited.body.error.details.limit, 30);

  db.prepare("UPDATE billing_accounts SET plan = 'plus', status = 'active', period_end = ? WHERE firebase_uid = ?")
    .run(Math.floor(Date.now() / 1000) + 3600, users.alice.uid);
  await request(app).post("/api/notes").set(auth()).send({ title: "Plus note", content: "" }).expect(201);
});

test("categories and tags support CRUD and reject cross-user access", async () => {
  const category = await request(app).post("/api/categories").set(auth()).send({ name: "Research", color: "#123456" }).expect(201);
  const tag = await request(app).post("/api/tags").set(auth()).send({ name: "important" }).expect(201);
  await request(app).get("/api/categories").set(auth("bob")).expect(200).expect((response) => assert.equal(response.body.items.length, 0));
  await request(app).get("/api/tags").set(auth("bob")).expect(200).expect((response) => assert.equal(response.body.items.length, 0));
  await request(app).patch(`/api/categories/${category.body.item.id}`).set(auth("bob")).send({ name: "Other" }).expect(404);
  await request(app).delete(`/api/tags/${tag.body.item.id}`).set(auth("bob")).expect(404);
  await request(app).patch(`/api/categories/${category.body.item.id}`).set(auth()).send({ name: "Reading", color: "#654321" }).expect(200);
  await request(app).patch(`/api/tags/${tag.body.item.id}`).set(auth()).send({ name: "urgent" }).expect(200);
  await request(app).delete(`/api/categories/${category.body.item.id}`).set(auth()).expect(204);
  await request(app).delete(`/api/tags/${tag.body.item.id}`).set(auth()).expect(204);
});

test("chat conversations and messages are private and support lifecycle operations", async () => {
  const created = await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  const conversationId = created.body.item.id;
  assert.equal(created.body.item.title, "New chat");
  await request(app).get("/api/chat/conversations").set(auth("bob")).expect(200)
    .expect(response => assert.equal(response.body.items.length, 0));
  await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth("bob")).expect(404);
  await request(app).patch(`/api/chat/conversations/${conversationId}`).set(auth("bob")).send({ title: "Not yours" }).expect(404);
  await request(app).delete(`/api/chat/conversations/${conversationId}`).set(auth("bob")).expect(404);

  const renamed = await request(app).patch(`/api/chat/conversations/${conversationId}`).set(auth()).send({ title: "Research session" }).expect(200);
  assert.equal(renamed.body.item.title, "Research session");
  await request(app).delete(`/api/chat/conversations/${conversationId}`).set(auth()).expect(204);
  await request(app).get(`/api/chat/conversations/${conversationId}/messages`).set(auth()).expect(404);
});

test("conversation history paginates without repeating entries when timestamps tie", async () => {
  for (let index = 0; index < 3; index += 1) {
    await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  }
  const first = await request(app).get("/api/chat/conversations?limit=2").set(auth()).expect(200);
  assert.equal(first.body.items.length, 2);
  assert.equal(first.body.pagination.hasMore, true);
  const second = await request(app).get(`/api/chat/conversations?limit=2&cursor=${encodeURIComponent(first.body.pagination.nextCursor)}`).set(auth()).expect(200);
  assert.equal(second.body.items.length, 1);
  assert.equal(second.body.pagination.hasMore, false);
  assert.equal(new Set([...first.body.items, ...second.body.items].map(item => item.id)).size, 3);
  await request(app).get("/api/chat/conversations?limit=101").set(auth()).expect(400);
});

test("chat messages paginate in chronological order and edited turns discard later context", async () => {
  const { body: { item: conversation } } = await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  const path = `/api/chat/conversations/${conversation.id}/messages/stream`;
  const firstTurn = "9ba7e340-c95f-4e8d-a60c-d45d1c351cef";
  const secondTurn = "17413dcf-ed29-4df7-b90a-7cc3ad6ea2a8";
  await request(app).post(path).set(auth()).send({ turnId: firstTurn, message: "First prompt" }).expect(200);
  await request(app).post(path).set(auth()).send({ turnId: secondTurn, message: "Second prompt" }).expect(200);

  const firstPage = await request(app).get(`/api/chat/conversations/${conversation.id}/messages?limit=2`).set(auth()).expect(200);
  assert.deepEqual(firstPage.body.items.map(message => message.content), ["Second prompt", "Hello from NoteFlow."]);
  assert.equal(firstPage.body.pagination.hasMore, true);
  const secondPage = await request(app).get(`/api/chat/conversations/${conversation.id}/messages?limit=2&beforeSeq=${firstPage.body.pagination.nextBeforeSeq}`).set(auth()).expect(200);
  assert.deepEqual(secondPage.body.items.map(message => message.content), ["First prompt", "Hello from NoteFlow."]);

  await request(app).patch(`/api/chat/conversations/${conversation.id}/messages/${firstTurn}`).set(auth("bob")).send({ content: "Not yours" }).expect(404);
  await request(app).patch(`/api/chat/conversations/${conversation.id}/messages/${firstTurn}`).set(auth()).send({ content: "Updated first prompt" }).expect(200);
  await request(app).post(path).set(auth()).send({ turnId: firstTurn, message: "Updated first prompt" }).expect(200);
  const edited = await request(app).get(`/api/chat/conversations/${conversation.id}/messages`).set(auth()).expect(200);
  assert.deepEqual(edited.body.items.map(message => message.content), ["Updated first prompt", "Hello from NoteFlow."]);
  await request(app).delete(`/api/chat/conversations/${conversation.id}/messages`).set(auth()).expect(204);
  assert.deepEqual((await request(app).get(`/api/chat/conversations/${conversation.id}/messages`).set(auth()).expect(200)).body.items, []);
});

test("chat streams, persists, deduplicates, and regenerates a turn", async () => {
  const { body: { item: conversation } } = await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  const turnId = "9ba7e340-c95f-4e8d-a60c-d45d1c351cef";
  const path = `/api/chat/conversations/${conversation.id}/messages/stream`;

  const streamed = await request(app).post(path).set(auth()).send({ turnId, message: "Help me plan a launch" }).expect(200);
  assert.match(streamed.text, /event: delta/);
  assert.match(streamed.text, /Hello from NoteFlow/);
  assert.match(streamed.text, /event: complete/);
  assert.equal(chatCalls, 1);
  assert.deepEqual(chatContexts[0], [{ role: "user", text: "Help me plan a launch" }]);
  const messages = await request(app).get(`/api/chat/conversations/${conversation.id}/messages`).set(auth()).expect(200);
  assert.deepEqual(messages.body.items.map(message => [message.role, message.status]), [
    ["user", "complete"],
    ["assistant", "complete"],
  ]);
  assert.equal(messages.body.items[1].content, "Hello from NoteFlow.");

  await request(app).post(path).set(auth()).send({ turnId, message: "Help me plan a launch" }).expect(200);
  assert.equal(chatCalls, 1, "retrying a completed turn should reuse the saved response");
  await request(app).post(path).set(auth()).send({
    turnId: "17413dcf-ed29-4df7-b90a-7cc3ad6ea2a8",
    message: "What should I do first?",
  }).expect(200);
  assert.deepEqual(chatContexts[1], [
    { role: "user", text: "Help me plan a launch" },
    { role: "model", text: "Hello from NoteFlow." },
    { role: "user", text: "What should I do first?" },
  ]);
  assert.equal((await request(app).get(`/api/chat/conversations/${conversation.id}/messages`).set(auth()).expect(200)).body.items.length, 4);
  await request(app).post(path).set(auth()).send({ turnId, regenerate: true }).expect(200);
  assert.equal(chatCalls, 3);
  assert.equal((await request(app).get(`/api/chat/conversations/${conversation.id}/messages`).set(auth()).expect(200)).body.items.length, 4);
});

test("chat failures are surfaced and failed turns can be retried", async () => {
  const { body: { item: conversation } } = await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  const turnId = "29bb05a2-42ba-4170-94c9-c6c7937abfa0";
  const path = `/api/chat/conversations/${conversation.id}/messages/stream`;
  failChat = true;
  const failed = await request(app).post(path).set(auth()).send({ turnId, message: "Try this" }).expect(200);
  assert.match(failed.text, /event: error/);
  assert.doesNotMatch(failed.text, /upstream unavailable/);
  failChat = false;
  await request(app).post(path).set(auth()).send({ turnId, message: "Try this" }).expect(200);
  const messages = await request(app).get(`/api/chat/conversations/${conversation.id}/messages`).set(auth()).expect(200);
  assert.deepEqual(messages.body.items.map(message => message.status), ["complete", "complete"]);
  assert.deepEqual(messages.body.items.map(message => message.seq), [1, 2]);
});

test("failed chat turns are omitted from later Gemini context", async () => {
  const { body: { item: conversation } } = await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  const path = `/api/chat/conversations/${conversation.id}/messages/stream`;
  failChat = true;
  await request(app).post(path).set(auth()).send({
    turnId: "29bb05a2-42ba-4170-94c9-c6c7937abfa0",
    message: "Failed prompt",
  }).expect(200);
  failChat = false;
  await request(app).post(path).set(auth()).send({
    turnId: "17413dcf-ed29-4df7-b90a-7cc3ad6ea2a8",
    message: "Next prompt",
  }).expect(200);
  assert.deepEqual(chatContexts[1], [{ role: "user", text: "Next prompt" }]);
});

test("chat validates IDs and requires an authenticated user", async () => {
  await request(app).get("/api/chat/conversations").expect(401);
  const { body: { item: conversation } } = await request(app).post("/api/chat/conversations").set(auth()).send({}).expect(201);
  await request(app).post(`/api/chat/conversations/${conversation.id}/messages/stream`).set(auth())
    .send({ turnId: "invalid", message: "Hello" }).expect(400);
});

test("malformed JSON and missing routes return sanitized errors", async () => {
  const malformed = await request(app)
    .post("/api/notes")
    .set(auth())
    .set("Content-Type", "application/json")
    .send("{")
    .expect(400);
  assert.equal(malformed.body.error.code, "INVALID_JSON");
  const missing = await request(app).get("/not-a-route").expect(404);
  assert.equal(missing.body.error.message, "Route not found.");
  assert.equal(JSON.stringify(missing.body).includes("stack"), false);
});

test("Firebase Admin configuration failures return a service error without exposing details", async () => {
  const unconfiguredApp = createApp({
    db,
    verifyIdToken: async () => {
      const error = new Error("private credential details");
      error.code = "FIREBASE_ADMIN_NOT_CONFIGURED";
      throw error;
    },
  });
  const response = await request(unconfiguredApp).get("/api/notes").set(auth()).expect(503);
  assert.equal(response.body.error.code, "AUTH_NOT_CONFIGURED");
  assert.equal(JSON.stringify(response.body).includes("private credential"), false);
});
