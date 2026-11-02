const { GoogleGenAI } = require("@google/genai");
const { HttpError } = require("../utils/httpError");
const { mapGeminiError } = require("./geminiService");

function formatSources(chunks) {
  return chunks.map((chunk, index) => (
    `[SOURCE ${index + 1}] document="${chunk.filename}" page=${chunk.pageNumber}\n${chunk.content}`
  )).join("\n\n");
}

function createDocumentRagService({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest", client } = {}) {
  let gemini = client;

  return {
    async ask(question, chunks) {
      if (!apiKey) throw new HttpError(503, "Gemini is not configured. Set GEMINI_API_KEY in backend/.env.", "GEMINI_NOT_CONFIGURED");
      if (!chunks.length) {
        return {
          answer: "I could not find relevant passages in your uploaded documents for that question.",
          sources: [],
        };
      }

      const prompt = `You answer questions using ONLY the provided sources.
Rules:
- If the sources do not contain the answer, say: "I couldn't find that in your uploaded documents."
- Never invent citations, page numbers, or document names.
- When you use a source, cite it inline as [document name, p.X] matching the SOURCE blocks.
- Keep the answer concise.

Question: ${question}

Sources:
${formatSources(chunks)}`;

      try {
        if (!gemini) gemini = new GoogleGenAI({ apiKey });
        const response = await gemini.models.generateContent({
          model,
          contents: prompt,
          config: {
            maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 2048),
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                answer: { type: "STRING" },
                citations: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      filename: { type: "STRING" },
                      pageNumber: { type: "INTEGER" },
                      chunkId: { type: "STRING" },
                    },
                    required: ["filename", "pageNumber", "chunkId"],
                  },
                },
              },
              required: ["answer", "citations"],
            },
          },
        });
        const text = response.text?.trim();
        if (!text) throw new HttpError(502, "Gemini returned an empty response.", "GEMINI_EMPTY_RESPONSE");
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          throw new HttpError(502, "Gemini returned an unexpected response format.", "GEMINI_INVALID_RESPONSE");
        }
        const allowed = new Map(chunks.map(chunk => [chunk.chunkId, chunk]));
        const citations = (payload.citations || []).filter(citation => {
          const match = allowed.get(citation.chunkId);
          return match
            && match.filename === citation.filename
            && Number(match.pageNumber) === Number(citation.pageNumber);
        }).map(citation => ({
          filename: citation.filename,
          pageNumber: citation.pageNumber,
          chunkId: citation.chunkId,
          excerpt: allowed.get(citation.chunkId).content.slice(0, 240),
        }));
        return { answer: payload.answer || "", sources: citations };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw mapGeminiError(error);
      }
    },
    async suggestTasksFromNote(noteText) {
      if (!apiKey) throw new HttpError(503, "Gemini is not configured. Set GEMINI_API_KEY in backend/.env.", "GEMINI_NOT_CONFIGURED");
      const prompt = `Extract actionable tasks from the note below. Return JSON only.
Each task needs title (max 120 chars), optional description, priority (low|medium|high), optional dueDate (YYYY-MM-DD or null).
Do not invent tasks unrelated to the note.

<note>
${noteText}
</note>`;
      try {
        if (!gemini) gemini = new GoogleGenAI({ apiKey });
        const response = await gemini.models.generateContent({
          model,
          contents: prompt,
          config: {
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                tasks: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      description: { type: "STRING" },
                      priority: { type: "STRING" },
                      dueDate: { type: "STRING" },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["tasks"],
            },
          },
        });
        const text = response.text?.trim();
        const payload = JSON.parse(text || "{}");
        return (payload.tasks || []).slice(0, 8).map(task => ({
          title: String(task.title || "").trim(),
          description: String(task.description || "").trim(),
          priority: ["low", "medium", "high"].includes(task.priority) ? task.priority : "medium",
          dueDate: task.dueDate || null,
        })).filter(task => task.title);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw mapGeminiError(error);
      }
    },
  };
}

module.exports = { createDocumentRagService };
