import axios from "axios";
import { auth } from "../../firebase";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
const http = axios.create({
  baseURL: apiBaseUrl,
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

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
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error?.message
        || (error.code === "ECONNABORTED"
          ? "The API request timed out. Please try again."
          : error.response
            ? `The API request failed (${error.response.status}).`
            : "Could not connect to the NoteFlow AI API. Make sure the backend is running.");
      throw new Error(message, { cause: error });
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

export const api = {
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
    summarize: (input) => request("/ai/summarize", { method: "POST", body: input }),
    improve: (input) => request("/ai/improve", { method: "POST", body: input }),
    title: (input) => request("/ai/title", { method: "POST", body: input }),
    tags: (input) => request("/ai/tags", { method: "POST", body: input }),
    ask: (input) => request("/ai/ask", { method: "POST", body: input }),
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
};
