const express = require("express");
const { createTaxonomyController } = require("../controllers/taxonomyController");

function createTaxonomyRouter(db, kind) {
  const router = express.Router();
  const controller = createTaxonomyController(db, kind);
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);
  return router;
}

module.exports = { createTaxonomyRouter };
