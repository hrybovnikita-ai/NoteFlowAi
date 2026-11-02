const express = require("express");
const multer = require("multer");
const { randomUUID } = require("node:crypto");
const { createDocumentService, MAX_FILE_BYTES } = require("../services/documentService");
const { createDocumentRagService } = require("../services/documentRagService");
const { HttpError } = require("../utils/httpError");
const { requireId, requireObject, requireString } = require("../utils/validation");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

function createDocumentRouter({ db, usageService }) {
  const router = express.Router();
  const documents = createDocumentService(db);
  const rag = createDocumentRagService();

  router.get("/", async (req, res, next) => {
    try {
      res.json({ items: await documents.list(req.user.id, { q: req.query.q }) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", upload.single("file"), async (req, res, next) => {
    try {
      const item = await documents.ingest(req.user.id, req.file);
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      if (!await documents.remove(req.user.id, requireId(req.params.id))) {
        throw new HttpError(404, "Document not found.", "NOT_FOUND");
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/ask", async (req, res, next) => {
    try {
      requireObject(req.body);
      const question = requireString(req.body.question, "question", { min: 1, max: 2000 });
      const documentIds = Array.isArray(req.body.documentIds)
        ? bodyDocumentIds(req.body.documentIds)
        : [];
      const chunks = await documents.retrieve(req.user.id, documentIds, question);
      const requestId = req.get("x-ai-request-id") || randomUUID();
      await usageService.reserve(req.user.firebaseUid, requestId, "document-ask");
      const response = await rag.ask(question, chunks);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function bodyDocumentIds(value) {
  if (value.length > 50) throw new HttpError(400, "Too many documentIds.", "INVALID_INPUT");
  return value.map(id => requireId(id));
}

module.exports = { createDocumentRouter };
