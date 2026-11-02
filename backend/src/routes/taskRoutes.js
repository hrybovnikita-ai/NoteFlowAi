const express = require("express");
const { randomUUID } = require("node:crypto");
const { createTaskService, parseTaskInput } = require("../services/taskService");
const { createDocumentRagService } = require("../services/documentRagService");
const { getNote } = require("../services/noteService");
const { HttpError } = require("../utils/httpError");
const { requireId, requireObject, requireString } = require("../utils/validation");

function createTaskRouter({ db, usageService }) {
  const router = express.Router();
  const tasks = createTaskService(db);
  const rag = createDocumentRagService();

  router.get("/", async (req, res, next) => {
    try {
      res.json({ items: await tasks.list(req.user.id, { status: req.query.status, q: req.query.q }) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const item = await tasks.create(req.user.id, parseTaskInput(req.body));
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const item = await tasks.update(req.user.id, requireId(req.params.id), parseTaskInput(req.body, { partial: true }));
      if (!item) throw new HttpError(404, "Task not found.", "NOT_FOUND");
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      if (!await tasks.remove(req.user.id, requireId(req.params.id))) throw new HttpError(404, "Task not found.", "NOT_FOUND");
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/suggest-from-note", async (req, res, next) => {
    try {
      requireObject(req.body);
      let content = "";
      if (req.body.noteId) {
        const note = await getNote(db, req.user.id, requireId(req.body.noteId));
        if (!note) throw new HttpError(404, "Note not found.", "NOT_FOUND");
        content = `${note.title}\n${note.content}`;
      } else {
        content = requireString(req.body.content, "content", { min: 1, max: 50000, trim: false });
      }
      const requestId = req.get("x-ai-request-id") || randomUUID();
      await usageService.reserve(req.user.firebaseUid, requestId, "task-suggest");
      const suggestions = await rag.suggestTasksFromNote(content);
      res.json({ suggestions });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createTaskRouter };
