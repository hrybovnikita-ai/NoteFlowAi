require("dotenv").config();

const { randomUUID } = require("node:crypto");
const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createPostgresDatabase } = require("../src/database/postgres");
const { createChatStore } = require("../src/database/chatStore");
const { createAiUsageService } = require("../src/services/aiUsageService");

process.env.NODE_ENV = "test";

test("PostgreSQL migrations, authenticated CRUD, isolation, and usage persistence", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const db = await createPostgresDatabase();
  const aliceUid = `pg-test-${randomUUID()}`;
  const bobUid = `pg-test-${randomUUID()}`;
  const tokens = {
    alice: { uid: aliceUid, email: `${aliceUid}@example.test`, name: "Postgres Alice" },
    bob: { uid: bobUid, email: `${bobUid}@example.test`, name: "Postgres Bob" },
  };
  const app = createApp({
    db,
    verifyIdToken: async token => {
      if (token === "expired") throw new Error("expired token");
      if (!tokens[token]) throw new Error("invalid token");
      return tokens[token];
    },
  });
  const auth = token => ({ Authorization: `Bearer ${token}` });
  let usageRequestId;

  try {
    await request(app).get("/api/me").set(auth("expired")).expect(401);
    await request(app).get("/api/me").set(auth("alice")).expect(200);
    await request(app).get("/api/me").set(auth("bob")).expect(200);

    const created = await request(app).post("/api/notes").set(auth("alice")).send({
      title: "PostgreSQL private note",
      content: "A persistent database check.",
      collection: "Integration",
      tags: ["database"],
    }).expect(201);
    const noteId = created.body.item.id;
    await request(app).get(`/api/notes/${noteId}`).set(auth("alice")).expect(200);
    await request(app).get(`/api/notes/${noteId}`).set(auth("bob")).expect(404);
    await request(app).get("/api/notes").set(auth("bob")).expect(200)
      .expect(response => assert.equal(response.body.pagination.total, 0));
    await request(app).patch(`/api/notes/${noteId}`).set(auth("alice")).send({ title: "Updated PostgreSQL note" }).expect(200);
    await request(app).delete(`/api/notes/${noteId}`).set(auth("bob")).expect(404);
    await request(app).delete(`/api/notes/${noteId}`).set(auth("alice")).expect(204);

    const conversation = await request(app).post("/api/chat/conversations").set(auth("alice")).send({}).expect(201);
    await request(app).patch(`/api/chat/conversations/${conversation.body.item.id}`)
      .set(auth("alice")).send({ title: "Postgres chat" }).expect(200);
    await request(app).get(`/api/chat/conversations/${conversation.body.item.id}/messages`)
      .set(auth("bob")).expect(404);
    const chatStore = createChatStore(db);
    const turnId = randomUUID();
    await chatStore.beginTurn(aliceUid, conversation.body.item.id, turnId, "Persist this question");
    await chatStore.completeTurn(aliceUid, conversation.body.item.id, turnId, "Persist this answer");
    const messages = await chatStore.listMessages(aliceUid, conversation.body.item.id);
    assert.deepEqual(messages.map(message => message.content), ["Persist this question", "Persist this answer"]);
    assert.equal(await chatStore.remove(bobUid, conversation.body.item.id), false);
    await request(app).delete(`/api/chat/conversations/${conversation.body.item.id}`).set(auth("alice")).expect(204);

    const usage = createAiUsageService(db, { logger: { info() {} } });
    usageRequestId = randomUUID();
    const reservation = await usage.reserve(aliceUid, usageRequestId, "postgres-test");
    assert.equal(reservation.remaining, reservation.limit - reservation.used);
    await assert.rejects(
      usage.reserve(aliceUid, usageRequestId, "postgres-test"),
      error => error.code === "AI_REQUEST_ALREADY_COUNTED",
    );
    const status = await usage.getStatus(aliceUid);
    assert.equal(status.used, reservation.used);
  } finally {
    try {
      if (usageRequestId) {
        const usageRows = await db.query(
          "SELECT usage_date FROM ai_usage_requests WHERE firebase_uid = $1 AND request_id = $2",
          [aliceUid, usageRequestId],
        );
        for (const { usage_date: usageDate } of usageRows.rows) {
          await db.transaction(async client => {
            const removed = await client.query(
              "DELETE FROM ai_usage_requests WHERE firebase_uid = $1 AND usage_date = $2 AND request_id = $3",
              [aliceUid, usageDate, usageRequestId],
            );
            if (!removed.rowCount) return;
            await client.query(
              "UPDATE ai_usage_daily SET request_count = GREATEST(request_count - 1, 0) WHERE firebase_uid = $1 AND usage_date = $2",
              [aliceUid, usageDate],
            );
            await client.query(
              "UPDATE ai_usage_global_daily SET request_count = GREATEST(request_count - 1, 0) WHERE usage_date = $1",
              [usageDate],
            );
          });
        }
      }
      await db.query("DELETE FROM users WHERE firebase_uid = ANY($1::text[])", [[aliceUid, bobUid]]);
    } finally {
      await db.close();
    }
  }
});
