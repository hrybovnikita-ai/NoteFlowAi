const { HttpError } = require("../utils/httpError");

function createChatAiService({
  url = process.env.CHAT_SERVICE_URL || "http://127.0.0.1:8000",
  token = process.env.CHAT_SERVICE_TOKEN,
  fetchImpl = fetch,
} = {}) {
  async function open(messages, signal) {
    if (!token?.trim() || token.trim().length < 32) {
      throw new HttpError(503, "Chat is not configured. Set the same strong CHAT_SERVICE_TOKEN for both services.", "CHAT_SERVICE_NOT_CONFIGURED");
    }

    let response;
    try {
      response = await fetchImpl(`${url.replace(/\/$/, "")}/v1/chat/stream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ messages }),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new HttpError(502, "The AI chat service could not be reached. Please try again.", "CHAT_SERVICE_UNAVAILABLE");
    }

    if (!response.ok) {
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      const detail = payload.detail || payload.error || {};
      const status = response.status === 429 ? 429 : response.status === 413 ? 413 : response.status >= 500 || response.status === 401 ? 503 : 502;
      throw new HttpError(
        status,
        detail.message || "The AI chat service could not start this response.",
        detail.code || "CHAT_SERVICE_ERROR",
      );
    }
    if (!response.body) {
      throw new HttpError(502, "The AI chat service returned no response stream.", "CHAT_STREAM_UNAVAILABLE");
    }
    return response;
  }

  async function* events(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bodyEnded = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        buffer = buffer.replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary).replace(/\r/g, "");
          buffer = buffer.slice(boundary + 2);
          const event = frame.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
          const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
          if (!data) continue;
          let payload;
          try {
            payload = JSON.parse(data);
          } catch {
            throw new HttpError(502, "The AI chat service returned an invalid response.", "CHAT_INVALID_RESPONSE");
          }
          if (event === "error") {
            const status = payload.code === "GEMINI_QUOTA_EXCEEDED" ? 429 : 502;
            throw new HttpError(status, payload.message || "The AI response failed.", payload.code || "CHAT_GENERATION_FAILED");
          }
          if (event === "delta" && typeof payload.text === "string" && payload.text) yield payload;
          if (event === "complete") {
            return;
          }
        }
        if (done) {
          bodyEnded = true;
          break;
        }
      }
      if (buffer.trim()) {
        throw new HttpError(502, "The AI chat service ended its stream unexpectedly.", "CHAT_STREAM_INCOMPLETE");
      }
    } finally {
      if (!bodyEnded) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  return { open, events };
}

module.exports = { createChatAiService };
