import axios from "axios";
import { auth } from "../../firebase";
import { retryWithFreshIdToken } from "./idTokenRequest";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
const http = axios.create({
  baseURL: apiBaseUrl,
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

function apiError(error) {
  const payloadMessage = error.response?.data?.error?.message;
  const status = error.response?.status;
  let message = payloadMessage
    || (error.code === "ECONNABORTED"
      ? "The API request timed out. Please try again."
      : error.response
        ? `The API request failed (${status}).`
        : "Could not connect to the NoteFlow AI API. Make sure the backend is running.");
  if (status === 429 && !payloadMessage) {
    message = "AI rate limit reached. Please try again in a moment.";
  }
  return Object.assign(new Error(message, { cause: error }), {
    code: error.response?.data?.error?.code,
    status: error.response?.status,
    details: error.response?.data?.error?.details,
  });
}

function usesAiRequestId(method, path) {
  return method === "POST" && (
    path.startsWith("/ai/")
    || path === "/documents/ask"
    || path === "/tasks/suggest-from-note"
  );
}

async function request(path, { method = "GET", body, query } = {}) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to access your notes.");

  try {
    const token = await user.getIdToken();
    const response = await http.request({
      url: path,
      method,
      params: query,
      data: body,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(usesAiRequestId(method, path) ? { "X-AI-Request-Id": crypto.randomUUID() } : {}),
      },
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401 && error.response?.data?.error?.code === "INVALID_TOKEN" && error.config) {
        try {
          const response = await retryWithFreshIdToken(user, refreshedToken => http.request({
            ...error.config,
            headers: { ...error.config.headers, Authorization: `Bearer ${refreshedToken}` },
          }), error.response);
          return response.data;
        } catch (retryError) {
          if (axios.isAxiosError(retryError)) throw apiError(retryError);
          throw retryError;
        }
      }
      throw apiError(error);
    }
    throw error;
  }
}

async function listAllNotes() {
  const items = [];
  let page = 1;
  let pages = 1;
  while (page <= pages) {
    const result = await request("/notes", { query: { page, limit: 100 } });
    items.push(...result.items);
    pages = result.pagination.pages;
    page += 1;
  }
  return items;
}

async function checkApiHealth(signal) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/health`, { signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Could not reach the NoteFlow AI API. Make sure the backend is running.", { cause: error });
  }

  if (!response.ok) {
    throw new Error(`The NoteFlow AI API health check failed (${response.status}).`);
  }
  const health = await response.json();
  if (health.status !== "ok") {
    throw new Error("The NoteFlow AI API is not ready.");
  }
  return health;
}

async function chatStream({ conversationId, turnId, message, regenerate = false, signal, onEvent }) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to use AI chat.");

  const token = await user.getIdToken();
  const requestId = crypto.randomUUID();
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/chat/conversations/${encodeURIComponent(conversationId)}/messages/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-AI-Request-Id": requestId,
      },
      body: JSON.stringify({ turnId, ...(regenerate ? { regenerate: true } : { message }) }),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Could not connect to the NoteFlow AI chat service. Please check your connection.", { cause: error });
  }

  if (!response.ok) {
    response = await retryWithFreshIdToken(user, refreshedToken => fetch(`${apiBaseUrl}/chat/conversations/${encodeURIComponent(conversationId)}/messages/stream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshedToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-AI-Request-Id": requestId,
      },
      body: JSON.stringify({ turnId, ...(regenerate ? { regenerate: true } : { message }) }),
      signal,
    }), response);
  }

  if (!response.ok) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const detail = payload?.error || {};
    throw Object.assign(new Error(detail.message || `The chat request failed (${response.status}).`), {
      code: detail.code || "CHAT_REQUEST_FAILED",
      status: response.status,
      details: detail.details,
    });
  }
  if (!response.body) throw new Error("The chat service returned no response stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamComplete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = frame.split("\n");
        const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (!event || !data) continue;
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          throw new Error("The chat service returned an invalid response.");
        }
        onEvent?.(event, payload);
        if (event === "error") {
          throw Object.assign(new Error(payload.message || "The AI response failed. Please retry."), {
            code: payload.code || "CHAT_GENERATION_FAILED",
            details: payload.details,
          });
        }
        if (event === "complete") {
          await reader.cancel();
          streamComplete = true;
          return payload.message;
        }
      }
      if (done) break;
    }
  } finally {
    if (!streamComplete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  throw new Error("The AI response ended unexpectedly. Please retry.");
}

const subscriptionRequests = new Map();
function getSubscription() {
  // Pricing cards share a request, avoiding competing sync operations for one user.
  const uid = auth?.currentUser?.uid;
  if (!subscriptionRequests.has(uid)) subscriptionRequests.set(uid, request('/billing/subscription').finally(() => { subscriptionRequests.delete(uid); }));
  return subscriptionRequests.get(uid);
}
export const api = {
  billing: {
    subscription: getSubscription,
    checkout: (plan) => request('/billing/checkout', { method: 'POST', body: { plan } }),
    checkoutSession: (id) => request(`/billing/checkout-sessions/${encodeURIComponent(id)}`),
    portal: () => request('/billing/portal', { method: 'POST', body: {} }),
  },
  health: checkApiHealth,
  auth: {
    me: () => request("/auth/me"),
    sync: () => request("/auth/sync", { method: "POST", body: {} }),
  },
  notes: {
    list: listAllNotes,
    create: (note) => request("/notes", { method: "POST", body: note }),
    get: (id) => request(`/notes/${encodeURIComponent(id)}`),
    update: (id, changes) => request(`/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: changes }),
    remove: (id) => request(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    removeAll: () => request("/notes", { method: "DELETE" }),
    favorite: (id, favorite) => request(`/notes/${encodeURIComponent(id)}/favorite`, { method: "PATCH", body: { favorite } }),
    archive: (id, archived) => request(`/notes/${encodeURIComponent(id)}/archive`, { method: "PATCH", body: { archived } }),
    search: (query) => request("/search", { query: { q: query, limit: 100 } }),
  },
  ai: {
    usage: () => request("/ai/usage"),
    summarize: (input) => request("/ai/summarize", { method: "POST", body: input }),
    improve: (input) => request("/ai/improve", { method: "POST", body: input }),
    fixGrammar: (input) => request("/ai/fix-grammar", { method: "POST", body: input }),
    translate: (input) => request("/ai/translate", { method: "POST", body: input }),
    keypoints: (input) => request("/ai/keypoints", { method: "POST", body: input }),
    title: (input) => request("/ai/title", { method: "POST", body: input }),
    tags: (input) => request("/ai/tags", { method: "POST", body: input }),
    ask: (input) => request("/ai/ask", { method: "POST", body: input }),
  },
  chat: {
    conversations: (query) => request("/chat/conversations", { query }),
    createConversation: () => request("/chat/conversations", { method: "POST", body: {} }),
    messages: (id, query) => request(`/chat/conversations/${encodeURIComponent(id)}/messages`, { query }),
    editMessage: (id, turnId, content) => request(`/chat/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(turnId)}`, { method: "PATCH", body: { content } }),
    clearMessages: (id) => request(`/chat/conversations/${encodeURIComponent(id)}/messages`, { method: "DELETE" }),
    rename: (id, title) => request(`/chat/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: { title } }),
    remove: (id) => request(`/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    stream: chatStream,
  },
  categories: {
    list: () => request("/categories"),
    create: (category) => request("/categories", { method: "POST", body: category }),
    update: (id, changes) => request(`/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: changes }),
    remove: (id) => request(`/categories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  tags: {
    list: () => request("/tags"),
    create: (tag) => request("/tags", { method: "POST", body: tag }),
    update: (id, changes) => request(`/tags/${encodeURIComponent(id)}`, { method: "PATCH", body: changes }),
    remove: (id) => request(`/tags/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  knowledgeGraph: {
    get: (query) => request("/knowledge-graph", { query }),
    rebuild: () => request("/knowledge-graph/rebuild", { method: "POST", body: {} }),
  },
  documents: {
    list: (query) => request("/documents", { query }),
    remove: (id) => request(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ask: (body) => request("/documents/ask", { method: "POST", body }),
    upload: async (file) => {
      const user = auth?.currentUser;
      if (!user) throw new Error("Sign in to upload documents.");
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append("file", file);
      let response = await fetch(`${apiBaseUrl}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (response.status === 401) {
        const refreshedToken = await user.getIdToken(true);
        response = await fetch(`${apiBaseUrl}/documents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${refreshedToken}` },
          body: formData,
        });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw Object.assign(new Error(payload?.error?.message || "Document upload failed."), {
          code: payload?.error?.code,
          status: response.status,
        });
      }
      return payload;
    },
  },
  tasks: {
    list: (query) => request("/tasks", { query }),
    create: (body) => request("/tasks", { method: "POST", body }),
    update: (id, body) => request(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    remove: (id) => request(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    suggestFromNote: (body) => request("/tasks/suggest-from-note", { method: "POST", body }),
  },
  noteVersions: {
    list: (noteId) => request(`/notes/${encodeURIComponent(noteId)}/versions`),
    get: (noteId, versionId) => request(`/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionId)}`),
    compare: (noteId, leftId, rightId) => request(`/notes/${encodeURIComponent(noteId)}/versions/compare/${encodeURIComponent(leftId)}/${encodeURIComponent(rightId)}`),
    restore: (noteId, versionId) => request(`/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: "POST", body: {} }),
  },
};
