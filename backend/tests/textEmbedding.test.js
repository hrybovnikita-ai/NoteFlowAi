const { test } = require("node:test");
const assert = require("node:assert/strict");
const { embedText, cosineSimilarity, chunkText } = require("../src/utils/textEmbedding");
const { diffWords, isMeaningfulChange } = require("../src/utils/textDiff");

test("embedding and similarity detect related text", () => {
  const a = embedText("Project roadmap and launch milestones");
  const b = embedText("Launch milestones for the product roadmap");
  const c = embedText("Completely unrelated cooking recipes");
  assert.ok(cosineSimilarity(a, b) > cosineSimilarity(a, c));
});

test("chunkText splits long passages", () => {
  const chunks = chunkText("word ".repeat(400), { size: 100, overlap: 20 });
  assert.ok(chunks.length > 1);
});

test("diff and meaningful change helpers", () => {
  const parts = diffWords("hello world", "hello brave world");
  assert.ok(parts.some(part => part.type === "added"));
  assert.equal(isMeaningfulChange("alpha", "beta"), true);
});
