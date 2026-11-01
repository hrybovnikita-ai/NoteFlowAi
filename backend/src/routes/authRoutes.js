const express = require("express");
const { createAuthController } = require("../controllers/authController");

function createAuthRouter() {
  const router = express.Router();
  const controller = createAuthController();
  router.get("/me", controller.me);
  router.post("/sync", controller.sync);
  return router;
}

module.exports = { createAuthRouter };
