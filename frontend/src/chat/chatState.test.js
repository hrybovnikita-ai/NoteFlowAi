import assert from "node:assert/strict";
import { test } from "node:test";
import { filterConversations, readSelectedConversation, saveSelectedConversation } from "./chatState.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test("selected chats persist independently per Firebase user", () => {
  const storage = createStorage();
  saveSelectedConversation("alice", "conversation-a", storage);
  saveSelectedConversation("bob", "conversation-b", storage);
  assert.equal(readSelectedConversation("alice", storage), "conversation-a");
  assert.equal(readSelectedConversation("bob", storage), "conversation-b");
  saveSelectedConversation("alice", "", storage);
  assert.equal(readSelectedConversation("alice", storage), "");
  assert.equal(readSelectedConversation("bob", storage), "conversation-b");
});

test("conversation search is case-insensitive and searches titles", () => {
  const conversations = [{ title: "Project Ideas" }, { title: "Daily notes" }, { title: "" }];
  assert.deepEqual(filterConversations(conversations, " PROJECT "), [conversations[0]]);
  assert.deepEqual(filterConversations(conversations, "new chat"), [conversations[2]]);
  assert.deepEqual(filterConversations(conversations, " "), conversations);
});
