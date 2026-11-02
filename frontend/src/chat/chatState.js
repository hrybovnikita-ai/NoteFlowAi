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

export function buildFollowups(userMessage = "") {
  const firstSentence = userMessage.replace(/\s+/g, " ").trim().split(/[.!?]/, 1)[0].slice(0, 56).trim();
  const ukrainian = /[іїєґІЇЄҐ]/.test(userMessage);
  const cyrillic = /[а-яёА-ЯЁ]/.test(userMessage);
  const topic = firstSentence ? `“${firstSentence}${firstSentence.length === 56 ? "…" : ""}”` : "";

  if (ukrainian) {
    return [
      topic ? `Поясніть детальніше про ${topic}` : "Поясніть докладніше",
      "Наведіть практичний приклад",
      "Що варто зробити далі?",
    ];
  }
  if (cyrillic) {
    return [
      topic ? `Расскажите подробнее о ${topic}` : "Расскажите подробнее",
      "Приведите практический пример",
      "Что стоит сделать дальше?",
    ];
  }
  return [
    topic ? `Can you expand on ${topic}?` : "Can you explain that further?",
    "Give me a practical example",
    "What should I do next?",
  ];
}
