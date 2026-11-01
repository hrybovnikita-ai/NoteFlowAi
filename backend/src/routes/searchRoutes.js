const express = require("express");
const { createSearchController } = require("../controllers/searchController");

function createSearchRouter(db) {
  const router = express.Router();
  router.get("/", createSearchController(db));
  return router;
}

module.exports = { createSearchRouter };
