const { afterEach, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createDatabase } = require("../src/database/connection");

process.env.NODE_ENV = "test";

let db;
let app;

const users = {
  alice: { uid: "firebase-alice", email: "alice@example.test", name: "Alice", picture: "", firebase: { sign_in_provider: "password" } },
  bob: { uid: "firebase-bob", email: "bob@example.test", name: "Bob", picture: "", firebase: { sign_in_provider: "google.com" } },
};

function auth(user = "alice") {
  return { Authorization: `Bearer ${user}` };
}

beforeEach(() => {
  db = createDatabase(":memory:");
  app = createApp({
    db,
    verifyIdToken: async (token) => {
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
