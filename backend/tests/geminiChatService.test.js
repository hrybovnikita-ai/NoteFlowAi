const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createGeminiChatService, MAX_CONTEXT_CHARACTERS } = require("../src/services/geminiChatService");

test("Gemini chat opens an official streaming request with bounded context and cancellation", async () => {
  const controller = new AbortController();
  let request;
  const sdkStream = (async function* stream() {
    yield { text: "Hello" };
    yield { text: " there" };
  }());
  const service = createGeminiChatService({
    apiKey: "test-key",
    model: "test-model",
    client: {
      models: {
        async generateContentStream(input) {
          request = input;
          return sdkStream;
        },
      },
    },
  });

  const stream = await service.open([
    { role: "user", text: "old".repeat(MAX_CONTEXT_CHARACTERS) },
    { role: "model", text: "prior answer" },
    { role: "user", text: "latest question" },
  ], controller.signal);
  const events = [];
  for await (const event of service.events(stream)) events.push(event);

  assert.equal(request.model, "test-model");
  assert.equal(request.config.abortSignal, controller.signal);
  assert.equal(request.config.maxOutputTokens, 2048);
  assert.equal(request.contents.at(-1).parts[0].text, "latest question");
  assert.ok(request.contents.reduce((size, item) => size + item.parts[0].text.length, 0) <= MAX_CONTEXT_CHARACTERS);
  assert.deepEqual(events, [{ text: "Hello" }, { text: " there" }]);
});

test("Gemini chat fails clearly when the server key is missing", async () => {
  const service = createGeminiChatService({ apiKey: "" });
  await assert.rejects(service.open([{ role: "user", text: "Hello" }]), error => error.code === "GEMINI_NOT_CONFIGURED");
});

test("Gemini streaming errors are mapped without exposing upstream details", async () => {
  const service = createGeminiChatService({
    apiKey: "test-key",
    client: {
      models: {
        async generateContentStream() {
          return (async function* stream() {
            throw Object.assign(new Error("private provider response"), { status: 429 });
          }());
        },
      },
    },
  });
  const stream = await service.open([{ role: "user", text: "Hello" }]);
  await assert.rejects(async () => {
    for await (const event of service.events(stream)) void event;
  }, error => error.status === 429 && error.code === "GEMINI_QUOTA_EXCEEDED" && !error.message.includes("private provider response"));
});

test("aborting a Gemini stream stops iteration with the supplied signal", async () => {
  const controller = new AbortController();
  const service = createGeminiChatService({
    apiKey: "test-key",
    client: {
      models: {
        async generateContentStream({ config }) {
          return (async function* stream() {
            if (config.abortSignal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
            yield { text: "partial" };
            if (config.abortSignal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
          }());
        },
      },
    },
  });
  const stream = await service.open([{ role: "user", text: "Hello" }], controller.signal);
  const iterator = service.events(stream);
  assert.deepEqual(await iterator.next(), { value: { text: "partial" }, done: false });
  controller.abort();
  await assert.rejects(iterator.next(), error => error.name === "AbortError");
});
