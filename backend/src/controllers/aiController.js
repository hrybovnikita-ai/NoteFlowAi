const { getNote } = require("../services/noteService");
const { createBillingStore } = require("../database/billingStore");
const { effectivePlan } = require("../services/aiUsageService");
const { HttpError } = require("../utils/httpError");
const { requireId, requireObject, requireString } = require("../utils/validation");
const { randomUUID } = require("node:crypto");

const ALLOWED_FIELDS = new Set(["noteId", "title", "content", "question"]);
const ACTIONS = new Set(["summarize", "improve", "title", "tags", "ask"]);

async function parseAiInput(body, action, db, userId) {
  requireObject(body);
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new HttpError(400, `Unsupported AI request field: ${key}.`, "INVALID_INPUT");
    }
  }

  let savedNote;
  if (body.noteId !== undefined) {
    const noteId = requireId(body.noteId);
    savedNote = await getNote(db, userId, noteId);
    if (!savedNote) throw new HttpError(404, "Note not found.", "NOT_FOUND");
  }

  const title = body.title === undefined
    ? savedNote?.title || ""
    : requireString(body.title, "title", { max: 120 });
  const content = body.content === undefined
    ? savedNote?.content
    : requireString(body.content, "content", { min: 1, max: 50000, trim: false });

  if (typeof content !== "string" || !content.trim()) {
    throw new HttpError(400, "content must contain at least one non-whitespace character.", "INVALID_INPUT");
  }
  if (content.length > 50000) {
    throw new HttpError(400, "content must not exceed 50000 characters.", "INVALID_INPUT");
  }

  let question = "";
  if (action === "ask") {
    question = requireString(body.question, "question", { min: 1, max: 2000 });
  } else if (body.question !== undefined) {
    throw new HttpError(400, "question is only valid for the ask action.", "INVALID_INPUT");
  }

  return { title, content, question };
}

function createAiController({ db, aiService, usageService }) {
  const billing = createBillingStore(db);
  return async function handleAiRequest(req, res, next) {
    try {
      const action = req.params.action;
      if (!ACTIONS.has(action)) throw new HttpError(404, "AI action not found.", "NOT_FOUND");
      const input = await parseAiInput(req.body, action, db, req.user.id);
      if (action === "summarize") {
        const account = await billing.ensure(req.user.firebaseUid);
        const plan = effectivePlan(account, Date.now());
        if (plan === "free") {
          throw new HttpError(403, "AI summaries are available on Plus and Pro plans.", "FEATURE_REQUIRES_PAID_PLAN", {
            feature: "summaries",
            requiredPlan: "plus",
          });
        }
      }
      const requestId = req.get("x-ai-request-id") || randomUUID();
      await usageService.reserve(req.user.firebaseUid, requestId, action);
      const result = await aiService.generate(action, input);
      res.json(result);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { createAiController, parseAiInput };
