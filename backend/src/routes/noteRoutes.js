const express = require("express");
const { createNoteController } = require("../controllers/noteController");

function createNoteRouter(db) {
  const router = express.Router();
  const controller = createNoteController(db);
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.delete("/", controller.removeAll);
  router.get("/:id", controller.get);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);
  router.patch("/:id/favorite", controller.favorite);
  router.patch("/:id/archive", controller.archive);
  return router;
}

module.exports = { createNoteRouter };
