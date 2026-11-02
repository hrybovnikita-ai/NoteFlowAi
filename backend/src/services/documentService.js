const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { HttpError } = require("../utils/httpError");
const { embedText, chunkText, cosineSimilarity } = require("../utils/textEmbedding");

const UPLOAD_ROOT = path.resolve(process.env.DOCUMENT_UPLOAD_DIR || path.join(process.cwd(), "data", "uploads"));
const MAX_FILE_BYTES = Number(process.env.DOCUMENT_MAX_BYTES || 10 * 1024 * 1024);
const MAX_DOCUMENTS_PER_USER = Number(process.env.DOCUMENT_MAX_PER_USER || 25);
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

async function extractText(buffer, mimeType, filename) {
  if (mimeType === "text/plain") {
    return { text: buffer.toString("utf8"), pageCount: 1, pages: [{ page: 1, text: buffer.toString("utf8") }] };
  }
  if (mimeType === "application/pdf") {
    const pdfParse = require("pdf-parse");
    const parsed = await pdfParse(buffer);
    const pages = [];
    if (parsed.numpages <= 1) {
      pages.push({ page: 1, text: parsed.text || "" });
    } else {
      const perPage = String(parsed.text || "").split("\f");
      for (let index = 0; index < parsed.numpages; index += 1) {
        pages.push({ page: index + 1, text: perPage[index] || "" });
      }
    }
    return { text: parsed.text || "", pageCount: parsed.numpages || 1, pages };
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || "";
    return { text, pageCount: 1, pages: [{ page: 1, text }] };
  }
  throw new HttpError(400, `Unsupported file type for ${filename}.`, "INVALID_FILE_TYPE");
}

function mapDocument(row) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    pageCount: row.page_count,
    createdAt: row.created_at,
  };
}

function createDocumentService(db) {
  if (db.kind !== "postgres") throw new Error("Documents require PostgreSQL.");

  return {
    async list(uid, { q } = {}) {
      const params = [uid];
      let sql = "SELECT * FROM user_documents WHERE user_id = $1";
      if (q?.trim()) {
        params.push(`%${q.trim().toLowerCase()}%`);
        sql += ` AND lower(filename) LIKE $${params.length}`;
      }
      sql += " ORDER BY created_at DESC";
      return (await db.query(sql, params)).rows.map(mapDocument);
    },
    async get(uid, id) {
      const row = (await db.query("SELECT * FROM user_documents WHERE user_id = $1 AND id = $2", [uid, id])).rows[0];
      return row ? mapDocument(row) : null;
    },
    async ingest(uid, file) {
      if (!file?.buffer || !file.originalname) throw new HttpError(400, "A document file is required.", "INVALID_INPUT");
      if (file.size > MAX_FILE_BYTES) {
        throw new HttpError(413, `Documents must be ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB or smaller.`, "FILE_TOO_LARGE");
      }
      const mimeType = file.mimetype === "application/octet-stream"
        ? (file.originalname.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : file.originalname.toLowerCase().endsWith(".docx")
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : file.originalname.toLowerCase().endsWith(".txt")
              ? "text/plain"
              : file.mimetype)
        : file.mimetype;
      if (!ALLOWED_MIME.has(mimeType)) {
        throw new HttpError(400, "Only PDF, DOCX, and TXT files are supported.", "INVALID_FILE_TYPE");
      }

      const count = Number((await db.query("SELECT count(*)::int AS count FROM user_documents WHERE user_id = $1", [uid])).rows[0].count);
      if (count >= MAX_DOCUMENTS_PER_USER) {
        throw new HttpError(403, `You can store up to ${MAX_DOCUMENTS_PER_USER} documents.`, "DOCUMENT_LIMIT_REACHED");
      }

      const extracted = await extractText(file.buffer, mimeType, file.originalname);
      const normalized = String(extracted.text || "").replace(/\s+/g, " ").trim();
      if (!normalized) throw new HttpError(400, "No readable text was found in this document.", "EMPTY_DOCUMENT");

      const id = randomUUID();
      const storageKey = path.join(uid, `${id}${path.extname(file.originalname) || ".bin"}`);
      await fs.mkdir(path.join(UPLOAD_ROOT, uid), { recursive: true });
      await fs.writeFile(path.join(UPLOAD_ROOT, storageKey), file.buffer);

      return db.transaction(async client => {
        await client.query(
          `INSERT INTO user_documents (id, user_id, filename, mime_type, size_bytes, page_count, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, uid, file.originalname, mimeType, file.size, extracted.pageCount, storageKey],
        );

        let chunkIndex = 0;
        for (const page of extracted.pages) {
          const pageChunks = chunkText(page.text);
          for (const content of pageChunks) {
            const vector = embedText(content);
            await client.query(
              `INSERT INTO document_chunks (id, document_id, user_id, chunk_index, page_number, content, vector)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
              [randomUUID(), id, uid, chunkIndex, page.page, content, JSON.stringify(vector)],
            );
            chunkIndex += 1;
          }
        }
        return mapDocument((await client.query("SELECT * FROM user_documents WHERE id = $1 AND user_id = $2", [id, uid])).rows[0]);
      });
    },
    async remove(uid, id) {
      const row = (await db.query("SELECT storage_key FROM user_documents WHERE user_id = $1 AND id = $2", [uid, id])).rows[0];
      if (!row) return false;
      await db.query("DELETE FROM user_documents WHERE user_id = $1 AND id = $2", [uid, id]);
      await fs.unlink(path.join(UPLOAD_ROOT, row.storage_key)).catch(() => {});
      return true;
    },
    async retrieve(uid, documentIds, question, { limit = 6 } = {}) {
      const params = [uid];
      let filter = "";
      if (documentIds?.length) {
        params.push(documentIds);
        filter = ` AND d.id = ANY($${params.length}::uuid[])`;
      }
      const chunks = (await db.query(
        `SELECT c.id, c.content, c.page_number AS "pageNumber", c.vector, d.filename, d.id AS "documentId"
         FROM document_chunks c
         JOIN user_documents d ON d.id = c.document_id AND d.user_id = c.user_id
         WHERE c.user_id = $1${filter}`,
        params,
      )).rows;
      const queryVector = embedText(question);
      const ranked = chunks
        .map(chunk => ({
          ...chunk,
          score: cosineSimilarity(queryVector, chunk.vector),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .filter(chunk => chunk.score > 0.05);
      return ranked.map(({ id, content, pageNumber, filename, documentId, score }) => ({
        chunkId: id,
        documentId,
        filename,
        pageNumber,
        content,
        score,
      }));
    },
  };
}

module.exports = { createDocumentService, UPLOAD_ROOT, MAX_FILE_BYTES };
