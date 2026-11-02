const express = require("express");
const { createKnowledgeGraphService } = require("../services/knowledgeGraphService");

function createKnowledgeGraphRouter(db) {
  const router = express.Router();
  const service = createKnowledgeGraphService(db);

  router.get("/", async (req, res, next) => {
    try {
      res.json(await service.graph(req.user.id, {
        q: req.query.q,
        minSimilarity: req.query.minSimilarity ? Number(req.query.minSimilarity) : undefined,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rebuild", async (req, res, next) => {
    try {
      res.json({ result: await service.rebuild(req.user.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createKnowledgeGraphRouter };
