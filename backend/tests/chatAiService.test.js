const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createChatAiService } = require("../src/services/chatAiService");

const serviceToken = "local-chat-service-test-token-with-sufficient-length";

test("chat AI bridge sends server messages with the internal bearer token", async () => {
  let request;
  const service = createChatAiService({
    url: "http://python.test/",
    token: serviceToken,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response("event: complete\ndata: {}\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
  const response = await service.open([{ role: "user", text: "Hello" }]);
  assert.equal(request.url, "http://python.test/v1/chat/stream");
  assert.equal(request.options.headers.Authorization, `Bearer ${serviceToken}`);
  assert.deepEqual(JSON.parse(request.options.body), { messages: [{ role: "user", text: "Hello" }] });
  assert.equal(response.status, 200);
});

test("chat AI bridge parses split CRLF event frames and forwards only text deltas", async () => {
  const chunks = [
    "event: delta\r\ndata: {\"text\":\"Hello ",
    "world\"}\r\n\r\nevent: complete\r\ndata: {}\r\n\r\n",
  ];
  const response = new Response(new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(new TextEncoder().encode(chunk)));
      controller.close();
    },
  }));
  const service = createChatAiService({ token: serviceToken });
  const events = [];
  for await (const event of service.events(response)) events.push(event);
  assert.deepEqual(events, [{ text: "Hello world" }]);
});

test("chat AI bridge rejects weak service tokens and maps Python service errors", async () => {
  const unconfigured = createChatAiService({ token: "too-short" });
  await assert.rejects(() => unconfigured.open([]), error => error.code === "CHAT_SERVICE_NOT_CONFIGURED");

  const service = createChatAiService({
    token: serviceToken,
    fetchImpl: async () => new Response(JSON.stringify({
      detail: { code: "GEMINI_QUOTA_EXCEEDED", message: "Quota reached." },
    }), { status: 429, headers: { "Content-Type": "application/json" } }),
  });
  await assert.rejects(() => service.open([]), error => error.status === 429 && error.code === "GEMINI_QUOTA_EXCEEDED");
});

test("chat AI bridge surfaces in-stream errors without returning partial success", async () => {
  const response = new Response(
    "event: error\ndata: {\"code\":\"GEMINI_UPSTREAM_INTERRUPTED\",\"message\":\"Retry this response.\"}\n\n",
  );
  const service = createChatAiService({ token: serviceToken });
  await assert.rejects(async () => {
    for await (const event of service.events(response)) void event;
  }, error => error.code === "GEMINI_UPSTREAM_INTERRUPTED");
});
