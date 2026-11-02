const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { createDatabase } = require("../src/database/connection");
const { createAiUsageService } = require("../src/services/aiUsageService");
const { randomUUID } = require("node:crypto");

const now = Date.UTC(2025, 0, 1, 23, 59, 0);
const databases = [];

function setup({ globalDailyLimit, clock = () => now } = {}) {
  const db = createDatabase(":memory:");
  databases.push(db);
  const service = createAiUsageService(db, { clock, globalDailyLimit, logger: { info() {} } });
  return { db, service };
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

test("daily quotas use UTC reset time, isolate users, and count idempotent requests once", async () => {
  const { service } = setup();
  const first = await service.getStatus("free-user");
  assert.deepEqual(first, {
    plan: "free",
    used: 0,
    limit: 20,
    remaining: 20,
    resetAt: "2025-01-02T00:00:00.000Z",
  });

  const requestId = randomUUID();
  await service.reserve("free-user", requestId, "chat");
  await assert.rejects(service.reserve("free-user", requestId, "chat"), error => error.code === "AI_REQUEST_ALREADY_COUNTED");
  assert.equal((await service.getStatus("free-user")).used, 1);
  assert.equal((await service.getStatus("another-user")).used, 0);
});

test("Free quota is enforced atomically under concurrent requests and resets at UTC midnight", async () => {
  let time = now;
  const { service } = setup({ clock: () => time });
  const attempts = await Promise.allSettled(Array.from({ length: 25 }, () => service.reserve("free-user", randomUUID(), "chat")));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 20);
  const limited = attempts.find(result => result.status === "rejected");
  assert.equal(limited.reason.code, "AI_DAILY_LIMIT");
  assert.equal(limited.reason.details.resetAt, "2025-01-02T00:00:00.000Z");
  assert.equal((await service.getStatus("free-user")).remaining, 0);

  time += 60 * 1000;
  assert.deepEqual(await service.getStatus("free-user"), {
    plan: "free",
    used: 0,
    limit: 20,
    remaining: 20,
    resetAt: "2025-01-03T00:00:00.000Z",
  });
});

test("Plus and Pro quotas require an unexpired provider-synchronized subscription", async () => {
  const { db, service } = setup();
  db.prepare("INSERT INTO billing_accounts (firebase_uid, plan, status, period_end) VALUES (?, ?, ?, ?)")
    .run("plus-user", "plus", "active", Math.floor(now / 1000) + 3600);
  db.prepare("INSERT INTO billing_accounts (firebase_uid, plan, status, period_end) VALUES (?, ?, ?, ?)")
    .run("pro-user", "team", "trialing", Math.floor(now / 1000) + 3600);
  db.prepare("INSERT INTO billing_accounts (firebase_uid, plan, status, period_end) VALUES (?, ?, ?, ?)")
    .run("expired-user", "plus", "active", Math.floor(now / 1000) - 1);

  assert.equal((await service.getStatus("plus-user")).limit, 200);
  assert.equal((await service.getStatus("pro-user")).plan, "pro");
  assert.equal((await service.getStatus("pro-user")).limit, 1000);
  assert.equal((await service.getStatus("expired-user")).plan, "free");
  assert.equal((await service.getStatus("expired-user")).limit, 20);
});

test("Plus and Pro quotas reject requests at their exact daily caps", async () => {
  const { db, service } = setup();
  for (const [uid, plan, limit] of [["plus-user", "plus", 200], ["pro-user", "team", 1000]]) {
    db.prepare("INSERT INTO billing_accounts (firebase_uid, plan, status, period_end) VALUES (?, ?, 'active', ?)")
      .run(uid, plan, Math.floor(now / 1000) + 3600);
    for (let count = 0; count < limit; count += 1) {
      await service.reserve(uid, randomUUID(), "chat");
    }
    await assert.rejects(service.reserve(uid, randomUUID(), "chat"), error => error.code === "AI_DAILY_LIMIT" && error.details.limit === limit);
    assert.equal((await service.getStatus(uid)).remaining, 0);
  }
});

test("global daily request safeguard applies across users", async () => {
  const { service } = setup({ globalDailyLimit: 1 });
  await service.reserve("first-user", randomUUID(), "chat");
  await assert.rejects(service.reserve("second-user", randomUUID(), "summarize"), error => error.code === "AI_GLOBAL_DAILY_LIMIT" && error.status === 503);
});
