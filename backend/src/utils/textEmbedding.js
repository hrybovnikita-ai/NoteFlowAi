const DIMENSIONS = 384;

function tokenize(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function embedText(text) {
  const vector = new Float32Array(DIMENSIONS);
  const tokens = tokenize(text);
  if (!tokens.length) return Array.from(vector);
  for (const token of tokens) {
    const bucket = hashToken(token) % DIMENSIONS;
    vector[bucket] += 1;
  }
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) norm += vector[index] ** 2;
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return Array.from(vector);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return Math.max(0, Math.min(1, dot));
}

function chunkText(text, { size = 900, overlap = 120 } = {}) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

module.exports = { embedText, cosineSimilarity, chunkText, DIMENSIONS };
