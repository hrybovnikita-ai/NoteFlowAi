const selectedConversationKey = uid => `noteflow.chat.selected.${uid}`;

export function readSelectedConversation(uid, storage = window.localStorage) {
  if (!uid) return "";
  return storage.getItem(selectedConversationKey(uid)) || "";
}

export function saveSelectedConversation(uid, conversationId, storage = window.localStorage) {
  if (!uid) return;
  const key = selectedConversationKey(uid);
  if (conversationId) storage.setItem(key, conversationId);
  else storage.removeItem(key);
}

export function filterConversations(conversations, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return conversations;
  return conversations.filter(conversation => (conversation.title || "New chat").toLocaleLowerCase().includes(normalized));
}
