const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { createAiController } = require("../controllers/aiController");

function createAiRouter({ db, aiService, usageService }) {
  const router = express.Router();
  router.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
  }));
  router.get("/usage", async (req, res, next) => {
    try {
      res.json({ usage: await usageService.getStatus(req.user.firebaseUid) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/:action", createAiController({ db, aiService, usageService }));
  return router;
}

module.exports = { createAiRouter };
