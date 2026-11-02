const { createBillingStore } = require("../database/billingStore");
const { HttpError } = require("../utils/httpError");

const DAILY_LIMITS = Object.freeze({ free: 20, plus: 200, team: 1000 });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getDay(now) {
  const date = new Date(now);
  const day = date.toISOString().slice(0, 10);
  const resetAt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return { day, resetAt: resetAt.toISOString() };
}

function effectivePlan(account, now) {
  const active = ["active", "trialing"].includes(account?.status)
    && Number(account?.period_end || 0) * 1000 > now;
  return active && ["plus", "team"].includes(account.plan) ? account.plan : "free";
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function createAiUsageService(db, {
  clock = () => Date.now(),
  globalDailyLimit = positiveInteger(process.env.AI_GLOBAL_DAILY_REQUEST_LIMIT, 10000, "AI_GLOBAL_DAILY_REQUEST_LIMIT"),
  logger = console,
} = {}) {
  const billing = createBillingStore(db);

  async function accountFor(uid) {
    return billing.ensure(uid);
  }

  function statusFor(uid, account, now) {
    const { day, resetAt } = getDay(now);
    const plan = effectivePlan(account, now);
    let used;
    if (db.kind === "firestore") {
      used = 0;
    } else {
      used = db.prepare("SELECT request_count FROM ai_usage_daily WHERE firebase_uid = ? AND usage_date = ?")
        .get(uid, day)?.request_count || 0;
    }
    return {
      plan: plan === "team" ? "pro" : plan,
      used,
      limit: DAILY_LIMITS[plan],
      remaining: Math.max(0, DAILY_LIMITS[plan] - used),
      resetAt,
    };
  }

  async function getStatus(uid) {
    const now = clock();
    const account = await accountFor(uid);
    const result = statusFor(uid, account, now);
    if (db.kind === "firestore") {
      const { day } = getDay(now);
      const snapshot = await db.firestore.collection("users").doc(db.safeId(uid))
        .collection("aiUsage").doc(day).get();
      result.used = Number(snapshot.data()?.requestCount || 0);
      result.remaining = Math.max(0, result.limit - result.used);
    }
    return result;
  }

  function logReservation(action, plan, used, limit) {
    logger.info("AI request reserved", { action, plan: plan === "team" ? "pro" : plan, used, limit });
  }

  async function reserve(uid, requestId, action) {
    if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
      throw new HttpError(400, "X-AI-Request-Id must be a UUID.", "INVALID_REQUEST_ID");
    }
    const now = clock();
    const { day, resetAt } = getDay(now);
    const globalLimit = globalDailyLimit;

    if (db.kind === "firestore") {
      const userRef = db.firestore.collection("users").doc(db.safeId(uid));
      const usageRef = userRef.collection("aiUsage").doc(day);
      const requestRef = usageRef.collection("requests").doc(requestId);
      const globalRef = db.firestore.collection("aiUsageGlobal").doc(day);
      const accountRef = db.firestore.collection("billingAccounts").doc(db.safeId(uid));
      const reservation = await db.firestore.runTransaction(async tx => {
        const [requestDoc, usageDoc, globalDoc, accountDoc] = await Promise.all([
          tx.get(requestRef),
          tx.get(usageRef),
          tx.get(globalRef),
          tx.get(accountRef),
        ]);
        if (requestDoc.exists) {
          throw new HttpError(409, "This AI request was already submitted. Start a new request to retry.", "AI_REQUEST_ALREADY_COUNTED");
        }
        const plan = effectivePlan(accountDoc.data(), now);
        const limit = DAILY_LIMITS[plan];
        const used = Number(usageDoc.data()?.requestCount || 0);
        const globalUsed = Number(globalDoc.data()?.requestCount || 0);
        if (used >= limit) {
          throw new HttpError(429, "Your daily AI message limit has been reached.", "AI_DAILY_LIMIT", {
            plan: plan === "team" ? "pro" : plan, used, limit, remaining: 0, resetAt,
          });
        }
        if (globalUsed >= globalLimit) {
          throw new HttpError(503, "The service has reached its daily AI capacity. Please try again after the reset.", "AI_GLOBAL_DAILY_LIMIT", { resetAt });
        }
        tx.set(usageRef, { requestCount: used + 1, updatedAt: new Date(now).toISOString() }, { merge: true });
        tx.create(requestRef, { action, createdAt: new Date(now).toISOString() });
        tx.set(globalRef, { requestCount: globalUsed + 1, updatedAt: new Date(now).toISOString() }, { merge: true });
        return { plan, used: used + 1, limit };
      });
      logReservation(action, reservation.plan, reservation.used, reservation.limit);
      return {
        plan: reservation.plan === "team" ? "pro" : reservation.plan,
        used: reservation.used,
        limit: reservation.limit,
        remaining: Math.max(0, reservation.limit - reservation.used),
        resetAt,
      };
    }

    const account = await accountFor(uid);
    const plan = effectivePlan(account, now);
    const limit = DAILY_LIMITS[plan];
    const reserveSql = db.transaction(() => {
      const existing = db.prepare("SELECT 1 FROM ai_usage_requests WHERE firebase_uid = ? AND usage_date = ? AND request_id = ?")
        .get(uid, day, requestId);
      if (existing) {
        throw new HttpError(409, "This AI request was already submitted. Start a new request to retry.", "AI_REQUEST_ALREADY_COUNTED");
      }
      const used = db.prepare("SELECT request_count FROM ai_usage_daily WHERE firebase_uid = ? AND usage_date = ?")
        .get(uid, day)?.request_count || 0;
      if (used >= limit) {
        throw new HttpError(429, "Your daily AI message limit has been reached.", "AI_DAILY_LIMIT", {
          plan: plan === "team" ? "pro" : plan, used, limit, remaining: 0, resetAt,
        });
      }
      const globalUsed = db.prepare("SELECT request_count FROM ai_usage_global_daily WHERE usage_date = ?")
        .get(day)?.request_count || 0;
      if (globalUsed >= globalLimit) {
        throw new HttpError(503, "The service has reached its daily AI capacity. Please try again after the reset.", "AI_GLOBAL_DAILY_LIMIT", { resetAt });
      }
      db.prepare(`INSERT INTO ai_usage_daily (firebase_uid, usage_date, request_count) VALUES (?, ?, 1)
        ON CONFLICT(firebase_uid, usage_date) DO UPDATE SET request_count = request_count + 1`).run(uid, day);
      db.prepare("INSERT INTO ai_usage_requests (firebase_uid, usage_date, request_id, action, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(uid, day, requestId, action, new Date(now).toISOString());
      db.prepare(`INSERT INTO ai_usage_global_daily (usage_date, request_count) VALUES (?, 1)
        ON CONFLICT(usage_date) DO UPDATE SET request_count = request_count + 1`).run(day);
      return used + 1;
    });
    const used = reserveSql();
    logReservation(action, plan, used, limit);
    return { plan: plan === "team" ? "pro" : plan, used, limit, remaining: Math.max(0, limit - used), resetAt };
  }

  return { getStatus, reserve };
}

module.exports = { createAiUsageService, DAILY_LIMITS, effectivePlan, getDay };
