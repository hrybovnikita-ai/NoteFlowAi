require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createPostgresDatabase } = require("../src/database/postgres");

process.env.NODE_ENV = "test";

test("Advanced workspace features enforce auth and user isolation", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const db = await createPostgresDatabase();
  const aliceUid = `feat-${randomUUID()}`;
  const bobUid = `feat-${randomUUID()}`;
  const tokens = {
    alice: { uid: aliceUid, email: `${aliceUid}@example.test`, name: "Alice" },
    bob: { uid: bobUid, email: `${bobUid}@example.test`, name: "Bob" },
  };
  const app = createApp({
    db,
    verifyIdToken: async token => tokens[token],
  });
  const auth = token => ({ Authorization: `Bearer ${token}` });

  const note = await request(app).post("/api/notes").set(auth("alice")).send({
    title: "Graph note A",
    content: "Roadmap planning and milestones for launch.",
  }).expect(201);
  await request(app).post("/api/notes").set(auth("alice")).send({
    title: "Graph note B",
    content: "Launch milestones and roadmap dependencies.",
  }).expect(201);

  await request(app).post("/api/knowledge-graph/rebuild").set(auth("alice")).expect(200);
  const graph = await request(app).get("/api/knowledge-graph").set(auth("alice")).expect(200);
  assert.ok(graph.body.nodes.length >= 2);

  const task = await request(app).post("/api/tasks").set(auth("alice")).send({
    title: "Prepare release checklist",
    priority: "high",
    noteId: note.body.item.id,
  }).expect(201);
  await request(app).get("/api/tasks").set(auth("bob")).expect(200)
    .expect(response => assert.equal(response.body.items.length, 0));
  await request(app).patch(`/api/tasks/${task.body.item.id}`).set(auth("alice")).send({ status: "done" }).expect(200);

  await request(app).patch(`/api/notes/${note.body.item.id}`).set(auth("alice")).send({
    content: "Updated roadmap with new milestones and QA tasks.",
  }).expect(200);
  const versions = await request(app).get(`/api/notes/${note.body.item.id}/versions`).set(auth("alice")).expect(200);
  assert.ok(versions.body.items.length >= 1);
  await request(app).get(`/api/notes/${note.body.item.id}/versions`).set(auth("bob")).expect(404);

  await request(app).get("/api/documents").set(auth("alice")).expect(200);
  await request(app).post("/api/documents/ask").set(auth("alice")).send({ question: "What is in my docs?" }).expect(200);

  await db.close();
});
