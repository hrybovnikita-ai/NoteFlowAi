const express = require("express");
const { createNoteVersionService } = require("../services/noteVersionService");
const { getNote } = require("../services/noteService");
const { HttpError } = require("../utils/httpError");
const { requireId } = require("../utils/validation");

function createNoteVersionRouter(db) {
  const router = express.Router({ mergeParams: true });
  const versions = createNoteVersionService(db);

  router.get("/", async (req, res, next) => {
    try {
      const noteId = requireId(req.params.noteId);
      if (!await getNote(db, req.user.id, noteId)) throw new HttpError(404, "Note not found.", "NOT_FOUND");
      res.json({ items: await versions.list(req.user.id, noteId) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:versionId", async (req, res, next) => {
    try {
      const noteId = requireId(req.params.noteId);
      const item = await versions.get(req.user.id, noteId, requireId(req.params.versionId));
      if (!item) throw new HttpError(404, "Version not found.", "NOT_FOUND");
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  router.get("/compare/:leftId/:rightId", async (req, res, next) => {
    try {
      res.json(await versions.compare(
        req.user.id,
        requireId(req.params.noteId),
        requireId(req.params.leftId),
        requireId(req.params.rightId),
      ));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:versionId/restore", async (req, res, next) => {
    try {
      const item = await versions.restore(req.user.id, requireId(req.params.noteId), requireId(req.params.versionId));
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createNoteVersionRouter };
