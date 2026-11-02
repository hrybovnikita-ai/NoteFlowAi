const express = require("express");
const { createChatStore } = require("../database/chatStore");
const { HttpError } = require("../utils/httpError");
const { requireObject, requireString } = require("../utils/validation");

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTurn(body) {
  requireObject(body);
  if (Object.keys(body).some(key => !["turnId", "message", "regenerate"].includes(key))) {
    throw new HttpError(400, "Unsupported chat message fields.", "INVALID_INPUT");
  }
  if (typeof body.turnId !== "string" || !uuidPattern.test(body.turnId)) {
    throw new HttpError(400, "turnId must be a UUID.", "INVALID_INPUT");
  }
  const regenerate = body.regenerate === true;
  if (body.regenerate !== undefined && typeof body.regenerate !== "boolean") {
    throw new HttpError(400, "regenerate must be a boolean.", "INVALID_INPUT");
  }
  if (regenerate && Object.hasOwn(body, "message")) throw new HttpError(400, "A regenerated response uses the original saved message.", "INVALID_INPUT");
  return {
    turnId: body.turnId,
    regenerate,
    message: regenerate ? "" : requireString(body.message, "message", { min: 1, max: 12000 }),
  };
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function createChatRouter({ db, aiService, usageService }) {
  const router = express.Router();
  const store = createChatStore(db);
  const uid = req => db.kind === "firestore" ? req.user.firebaseUid : req.user.id;

  router.get("/conversations", async (req, res) => {
    res.json({ items: await store.list(uid(req)) });
  });

  router.post("/conversations", async (req, res) => {
    if (req.body !== undefined) {
      requireObject(req.body);
      if (Object.keys(req.body).length) throw new HttpError(400, "Conversation creation does not accept fields.", "INVALID_INPUT");
    }
    res.status(201).json({ item: await store.create(uid(req)) });
  });

  router.get("/conversations/:id/messages", async (req, res) => {
    const conversation = await store.get(uid(req), req.params.id);
    if (!conversation) throw new HttpError(404, "Conversation not found.", "NOT_FOUND");
    res.json({ items: await store.listMessages(uid(req), req.params.id) });
  });

  router.patch("/conversations/:id", async (req, res) => {
    requireObject(req.body);
    if (Object.keys(req.body).some(key => key !== "title")) throw new HttpError(400, "Only the conversation title can be changed.", "INVALID_INPUT");
    const title = requireString(req.body.title, "title", { min: 1, max: 80 });
    const item = await store.rename(uid(req), req.params.id, title);
    if (!item) throw new HttpError(404, "Conversation not found.", "NOT_FOUND");
    res.json({ item });
  });

  router.delete("/conversations/:id", async (req, res) => {
    if (!await store.remove(uid(req), req.params.id)) throw new HttpError(404, "Conversation not found.", "NOT_FOUND");
    res.status(204).end();
  });

  router.post("/conversations/:id/messages/stream", async (req, res, next) => {
    const userId = uid(req);
    const conversationId = req.params.id;
    let turn;
    let completed = false;
    let turnId;
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded && !completed) abortController.abort();
    });

    try {
      const input = parseTurn(req.body);
      turnId = input.turnId;
      const conversation = await store.get(userId, conversationId);
      if (!conversation) throw new HttpError(404, "Conversation not found.", "NOT_FOUND");
      turn = await store.beginTurn(userId, conversationId, input.turnId, input.message, input.regenerate);
      if (turn.cached) {
        res.status(200);
        res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
        sendEvent(res, "start", { turnId: input.turnId });
        if (turn.assistant.content) sendEvent(res, "delta", { text: turn.assistant.content });
        sendEvent(res, "complete", { message: turn.assistant });
        completed = true;
        return res.end();
      }

      const requestId = req.get("x-ai-request-id") || require("node:crypto").randomUUID();
      await usageService.reserve(req.user.firebaseUid, requestId, "chat");
      const context = await store.context(userId, conversationId, input.turnId);
      const upstream = await aiService.open(context, abortController.signal);
      res.status(200);
      res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
      res.flushHeaders?.();
      sendEvent(res, "start", { turnId: input.turnId });
      let content = "";
      for await (const event of aiService.events(upstream)) {
        content += event.text;
        sendEvent(res, "delta", event);
      }
      if (!content.trim()) throw new HttpError(502, "Gemini returned an empty response. Please retry.", "GEMINI_EMPTY_RESPONSE");
      const assistant = await store.completeTurn(userId, conversationId, input.turnId, content);
      completed = true;
      sendEvent(res, "complete", { message: assistant });
      res.end();
    } catch (error) {
      if (turn && !turn.cached && !completed) {
        await store.failTurn(userId, conversationId, turnId);
      }
      if (res.destroyed || abortController.signal.aborted) return;
      if (!res.headersSent) return next(error);
      if (!(error instanceof HttpError)) {
        console.error("Chat generation failed with internal error code:", error.code || "UNKNOWN");
      }
      sendEvent(res, "error", {
        code: error.code || "CHAT_GENERATION_FAILED",
        message: error instanceof HttpError ? error.message : "The AI response failed. Please retry.",
      });
      res.end();
    }
  });
  return router;
}

module.exports = { createChatRouter, parseTurn };
