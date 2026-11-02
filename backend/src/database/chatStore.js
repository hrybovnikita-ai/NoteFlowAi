const { randomUUID } = require("node:crypto");
const { FieldPath } = require("firebase-admin/firestore");
const { HttpError } = require("../utils/httpError");

const LOCK_MS = 120000;
const DEFAULT_TITLE = "New chat";
const messageId = (turnId, role) => `${turnId}-${role}`;
const now = () => new Date().toISOString();

function conversationTitle(message) {
  const title = message.replace(/\s+/g, " ").trim();
  return title.length > 56 ? `${title.slice(0, 55).trimEnd()}…` : title || DEFAULT_TITLE;
}

function createChatStore(db) {
  if (db.kind === "postgres") return require("./postgresChatStore").createPostgresChatStore(db);
  const firestore = db.kind === "firestore";
  const ownerId = uid => firestore ? db.safeId(uid) : uid;
  const conversations = uid => db.firestore.collection("users").doc(ownerId(uid)).collection("conversations");
  const messages = (uid, conversationId) => conversations(uid).doc(db.safeId(conversationId)).collection("messages");

  function getConversation(uid, id) {
    if (firestore) {
      return conversations(uid).doc(db.safeId(id)).get()
        .then(doc => doc.exists ? { id: doc.id, ...doc.data() } : null);
    }
    return db.prepare("SELECT id, title, message_count AS messageCount, created_at AS createdAt, updated_at AS updatedAt FROM chat_conversations WHERE id = ? AND user_id = ?")
      .get(id, ownerId(uid)) || null;
  }

  function getMessage(uid, conversationId, id) {
    if (firestore) return messages(uid, conversationId).doc(db.safeId(id)).get();
    return db.prepare("SELECT id, conversation_id AS conversationId, turn_id AS turnId, seq, role, content, status, created_at AS createdAt FROM chat_messages WHERE id = ? AND conversation_id = ? AND user_id = ?")
      .get(id, conversationId, ownerId(uid)) || null;
  }

  return {
    async list(uid, { limit = 50, cursor } = {}) {
      if (firestore) {
        let query = conversations(uid)
          .orderBy("updatedAt", "desc")
          .orderBy(FieldPath.documentId(), "desc");
        if (cursor) query = query.startAfter(cursor.updatedAt, cursor.id);
        const snapshot = await query.limit(limit + 1).get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
      if (cursor) {
        return db.prepare(`SELECT id, title, message_count AS messageCount, created_at AS createdAt, updated_at AS updatedAt
          FROM chat_conversations WHERE user_id = ? AND (updated_at < ? OR (updated_at = ? AND id < ?))
          ORDER BY updated_at DESC, id DESC LIMIT ?`)
          .all(ownerId(uid), cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1);
      }
      return db.prepare("SELECT id, title, message_count AS messageCount, created_at AS createdAt, updated_at AS updatedAt FROM chat_conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?")
        .all(ownerId(uid), limit + 1);
    },
    async create(uid) {
      const id = randomUUID();
      const timestamp = now();
      const value = { title: DEFAULT_TITLE, messageCount: 0, createdAt: timestamp, updatedAt: timestamp };
      if (firestore) await conversations(uid).doc(id).create(value);
      else db.prepare("INSERT INTO chat_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, ownerId(uid), value.title, timestamp, timestamp);
      return { id, ...value };
    },
    async get(uid, id) {
      return getConversation(uid, id);
    },
    async listMessages(uid, conversationId, { limit = 100, beforeSeq } = {}) {
      if (firestore) {
        let query = messages(uid, conversationId);
        if (beforeSeq !== undefined) query = query.where("seq", "<", beforeSeq);
        const snapshot = await query.orderBy("seq", "desc").limit(limit + 1).get();
        return snapshot.docs.reverse().map(doc => ({ id: doc.id, ...doc.data() }));
      }
      const rows = beforeSeq === undefined
        ? db.prepare("SELECT id, conversation_id AS conversationId, turn_id AS turnId, seq, role, content, status, created_at AS createdAt FROM chat_messages WHERE conversation_id = ? AND user_id = ? ORDER BY seq DESC LIMIT ?")
          .all(conversationId, ownerId(uid), limit + 1)
        : db.prepare("SELECT id, conversation_id AS conversationId, turn_id AS turnId, seq, role, content, status, created_at AS createdAt FROM chat_messages WHERE conversation_id = ? AND user_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?")
          .all(conversationId, ownerId(uid), beforeSeq, limit + 1);
      return rows.reverse();
    },
    async rename(uid, id, title) {
      const current = await getConversation(uid, id);
      if (!current) return null;
      const updatedAt = now();
      if (firestore) await conversations(uid).doc(db.safeId(id)).update({ title, updatedAt });
      else db.prepare("UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(title, updatedAt, id, ownerId(uid));
      return { ...current, title, updatedAt };
    },
    async remove(uid, id) {
      const current = await getConversation(uid, id);
      if (!current) return false;
      if (!firestore) {
        db.prepare("DELETE FROM chat_conversations WHERE id = ? AND user_id = ?").run(id, ownerId(uid));
        return true;
      }
      const collection = messages(uid, id);
      while (true) {
        const snapshot = await collection.limit(400).get();
        if (snapshot.empty) break;
        const batch = db.firestore.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
      await conversations(uid).doc(db.safeId(id)).delete();
      return true;
    },
    async clear(uid, conversationId) {
      const timestamp = now();
      if (!firestore) {
        const clearConversation = db.transaction(() => {
          const current = getConversation(uid, conversationId);
          if (!current) return false;
          const lock = db.prepare("SELECT active_turn_id AS activeTurnId, lock_until AS lockUntil FROM chat_conversations WHERE id = ? AND user_id = ?")
            .get(conversationId, ownerId(uid));
          if (lock.activeTurnId && lock.lockUntil > Date.now()) {
            throw new HttpError(409, "Stop the active response before clearing this conversation.", "CHAT_BUSY");
          }
          db.prepare("DELETE FROM chat_messages WHERE conversation_id = ? AND user_id = ?").run(conversationId, ownerId(uid));
          db.prepare("UPDATE chat_conversations SET title = ?, message_count = 0, active_turn_id = NULL, lock_until = 0, updated_at = ? WHERE id = ? AND user_id = ?")
            .run(DEFAULT_TITLE, timestamp, conversationId, ownerId(uid));
          return true;
        });
        return clearConversation();
      }

      const conversationRef = conversations(uid).doc(db.safeId(conversationId));
      const sentinel = `clear-${randomUUID()}`;
      const exists = await db.firestore.runTransaction(async tx => {
        const snapshot = await tx.get(conversationRef);
        if (!snapshot.exists) return false;
        const current = snapshot.data();
        if (current.activeTurnId && current.lockUntil > Date.now()) {
          throw new HttpError(409, "Stop the active response before clearing this conversation.", "CHAT_BUSY");
        }
        tx.update(conversationRef, { activeTurnId: sentinel, lockUntil: Date.now() + LOCK_MS });
        return true;
      });
      if (!exists) return false;
      try {
        const collection = messages(uid, conversationId);
        while (true) {
          const snapshot = await collection.limit(400).get();
          if (snapshot.empty) break;
          const batch = db.firestore.batch();
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          batch.update(conversationRef, { lockUntil: Date.now() + LOCK_MS });
          await batch.commit();
        }
        await conversationRef.update({
          title: DEFAULT_TITLE,
          messageCount: 0,
          activeTurnId: null,
          lockUntil: 0,
          updatedAt: timestamp,
        });
        return true;
      } catch (error) {
        await conversationRef.update({ activeTurnId: null, lockUntil: 0 });
        throw error;
      }
    },
    async editTurn(uid, conversationId, turnId, content) {
      const userMessageId = messageId(turnId, "user");
      const timestamp = now();
      if (!firestore) {
        const edit = db.transaction(() => {
          const conversation = getConversation(uid, conversationId);
          if (!conversation) return false;
          const lock = db.prepare("SELECT active_turn_id AS activeTurnId, lock_until AS lockUntil FROM chat_conversations WHERE id = ? AND user_id = ?")
            .get(conversationId, ownerId(uid));
          if (lock.activeTurnId && lock.lockUntil > Date.now()) {
            throw new HttpError(409, "Stop the active response before editing a message.", "CHAT_BUSY");
          }
          const userMessage = getMessage(uid, conversationId, userMessageId);
          if (!userMessage || userMessage.role !== "user") return false;
          db.prepare("UPDATE chat_messages SET content = ? WHERE id = ? AND user_id = ?")
            .run(content, userMessageId, ownerId(uid));
          db.prepare("DELETE FROM chat_messages WHERE conversation_id = ? AND user_id = ? AND seq > ?")
            .run(conversationId, ownerId(uid), userMessage.seq);
          db.prepare("UPDATE chat_conversations SET message_count = ?, active_turn_id = NULL, lock_until = 0, updated_at = ?, title = ? WHERE id = ? AND user_id = ?")
            .run(userMessage.seq, timestamp, userMessage.seq === 1 ? conversationTitle(content) : conversation.title, conversationId, ownerId(uid));
          return true;
        });
        return edit();
      }

      const conversationRef = conversations(uid).doc(db.safeId(conversationId));
      const userRef = messages(uid, conversationId).doc(userMessageId);
      const seq = await db.firestore.runTransaction(async tx => {
        const [conversationDoc, userDoc] = await Promise.all([tx.get(conversationRef), tx.get(userRef)]);
        if (!conversationDoc.exists || !userDoc.exists || userDoc.data().role !== "user") return null;
        const conversation = conversationDoc.data();
        if (conversation.activeTurnId && conversation.lockUntil > Date.now()) {
          throw new HttpError(409, "Stop the active response before editing a message.", "CHAT_BUSY");
        }
        const value = Number(userDoc.data().seq);
        tx.update(conversationRef, { activeTurnId: `edit-${turnId}`, lockUntil: Date.now() + LOCK_MS });
        return value;
      });
      if (seq === null) return false;
      try {
        const collection = messages(uid, conversationId);
        while (true) {
          const snapshot = await collection.where("seq", ">", seq).orderBy("seq", "asc").limit(400).get();
          if (snapshot.empty) break;
          const batch = db.firestore.batch();
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          batch.update(conversationRef, { lockUntil: Date.now() + LOCK_MS });
          await batch.commit();
        }
        await userRef.update({ content });
        const conversation = await getConversation(uid, conversationId);
        await conversationRef.update({
          messageCount: seq,
          title: seq === 1 ? conversationTitle(content) : conversation.title,
          activeTurnId: null,
          lockUntil: 0,
          updatedAt: timestamp,
        });
        return true;
      } catch (error) {
        await conversationRef.update({ activeTurnId: null, lockUntil: 0 });
        throw error;
      }
    },
    async beginTurn(uid, conversationId, turnId, content, regenerate = false) {
      const userMessageId = messageId(turnId, "user");
      const assistantMessageId = messageId(turnId, "assistant");
      const timestamp = now();

      if (firestore) {
        const conversationRef = conversations(uid).doc(db.safeId(conversationId));
        const userRef = messages(uid, conversationId).doc(userMessageId);
        const assistantRef = messages(uid, conversationId).doc(assistantMessageId);
        return db.firestore.runTransaction(async tx => {
          const [conversationDoc, userDoc, assistantDoc] = await Promise.all([
            tx.get(conversationRef), tx.get(userRef), tx.get(assistantRef),
          ]);
          if (!conversationDoc.exists) throw new HttpError(404, "Conversation not found.", "NOT_FOUND");
          const current = conversationDoc.data();
          if (current.activeTurnId && current.activeTurnId !== turnId && current.lockUntil > Date.now()) {
            throw new HttpError(409, "Another response is being generated. Wait or stop it before sending another message.", "CHAT_BUSY");
          }
          if (assistantDoc.exists && assistantDoc.data().status === "streaming" && current.lockUntil > Date.now()) {
            throw new HttpError(409, "This message is already being generated.", "CHAT_BUSY");
          }
          if (regenerate && (!userDoc.exists || !assistantDoc.exists || assistantDoc.data().status === "streaming")) {
            throw new HttpError(409, "This response can no longer be regenerated.", "CHAT_REGENERATE_CONFLICT");
          }
          if (!regenerate && assistantDoc.exists && assistantDoc.data().status === "complete") {
            return { cached: true, assistant: { id: assistantDoc.id, ...assistantDoc.data() } };
          }
          const count = Number(current.messageCount || 0);
          if (!regenerate && !userDoc.exists) {
            tx.create(userRef, { turnId, seq: count + 1, role: "user", content, status: "complete", createdAt: timestamp });
            tx.set(conversationRef, {
              ...(count === 0 && current.title === DEFAULT_TITLE ? { title: conversationTitle(content) } : {}),
              messageCount: count + 2,
            }, { merge: true });
          } else if (!regenerate && userDoc.exists && !assistantDoc.exists) {
            tx.update(conversationRef, { messageCount: count + 1 });
          }
          tx.set(assistantRef, {
            turnId,
            seq: assistantDoc.exists ? assistantDoc.data().seq : count + (userDoc.exists ? 1 : 2),
            role: "assistant",
            content: "",
            status: "streaming",
            createdAt: timestamp,
          });
          tx.set(conversationRef, { activeTurnId: turnId, lockUntil: Date.now() + LOCK_MS, updatedAt: timestamp }, { merge: true });
          return { cached: false, assistantId: assistantMessageId, userMessageId };
        });
      }

      const begin = db.transaction(() => {
        const conversation = getConversation(uid, conversationId);
        if (!conversation) throw new HttpError(404, "Conversation not found.", "NOT_FOUND");
        const lock = db.prepare("SELECT active_turn_id AS activeTurnId, lock_until AS lockUntil FROM chat_conversations WHERE id = ? AND user_id = ?")
          .get(conversationId, ownerId(uid));
        if (lock.activeTurnId && lock.activeTurnId !== turnId && lock.lockUntil > Date.now()) {
          throw new HttpError(409, "Another response is being generated. Wait or stop it before sending another message.", "CHAT_BUSY");
        }
        const userMessage = getMessage(uid, conversationId, userMessageId);
        const assistant = getMessage(uid, conversationId, assistantMessageId);
        if (assistant?.status === "streaming" && lock.lockUntil > Date.now()) {
          throw new HttpError(409, "This message is already being generated.", "CHAT_BUSY");
        }
        if (regenerate && (!userMessage || !assistant || assistant.status === "streaming")) {
          throw new HttpError(409, "This response can no longer be regenerated.", "CHAT_REGENERATE_CONFLICT");
        }
        if (!regenerate && assistant?.status === "complete") return { cached: true, assistant };
        const count = conversation.messageCount || 0;
        if (!regenerate && !userMessage) {
          db.prepare("INSERT INTO chat_messages (id, conversation_id, user_id, turn_id, seq, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, 'user', ?, 'complete', ?)")
            .run(userMessageId, conversationId, ownerId(uid), turnId, count + 1, content, timestamp);
          db.prepare("UPDATE chat_conversations SET title = ?, message_count = ?, updated_at = ? WHERE id = ? AND user_id = ?")
            .run(count === 0 && conversation.title === DEFAULT_TITLE ? conversationTitle(content) : conversation.title, count + 2, timestamp, conversationId, ownerId(uid));
        }
        const seq = assistant ? assistant.seq : count + (userMessage ? 1 : 2);
        db.prepare(`INSERT INTO chat_messages (id, conversation_id, user_id, turn_id, seq, role, content, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'assistant', '', 'streaming', ?)
          ON CONFLICT(id) DO UPDATE SET content = '', status = 'streaming', created_at = excluded.created_at`)
          .run(assistantMessageId, conversationId, ownerId(uid), turnId, seq, timestamp);
        if (!regenerate && userMessage && !assistant) {
          db.prepare("UPDATE chat_conversations SET message_count = ? WHERE id = ? AND user_id = ?")
            .run(count + 1, conversationId, ownerId(uid));
        }
        db.prepare("UPDATE chat_conversations SET active_turn_id = ?, lock_until = ?, updated_at = ? WHERE id = ? AND user_id = ?")
          .run(turnId, Date.now() + LOCK_MS, timestamp, conversationId, ownerId(uid));
        return { cached: false, assistantId: assistantMessageId, userMessageId };
      });
      return begin();
    },
    async context(uid, conversationId, turnId) {
      const items = await this.listMessages(uid, conversationId);
      const assistantId = messageId(turnId, "assistant");
      const currentAssistant = items.findIndex(item => item.id === assistantId);
      const beforeAssistant = currentAssistant < 0 ? items : items.slice(0, currentAssistant);
      const assistantStatuses = new Map(items.filter(item => item.role === "assistant").map(item => [item.turnId, item.status]));
      const recent = beforeAssistant.filter(item => item.status === "complete"
        && !(item.role === "user" && assistantStatuses.get(item.turnId) === "failed")).slice(-40);
      if (recent[0]?.role === "assistant") recent.shift();
      return recent.map(({ role, content }) => ({
        role: role === "assistant" ? "model" : "user",
        text: content,
      }));
    },
    async completeTurn(uid, conversationId, turnId, content) {
      const timestamp = now();
      const assistantId = messageId(turnId, "assistant");
      if (firestore) {
        const conversationRef = conversations(uid).doc(db.safeId(conversationId));
        const assistantRef = messages(uid, conversationId).doc(assistantId);
        return db.firestore.runTransaction(async tx => {
          const [conversationDoc, assistantDoc] = await Promise.all([tx.get(conversationRef), tx.get(assistantRef)]);
          if (!conversationDoc.exists || !assistantDoc.exists || conversationDoc.data().activeTurnId !== turnId) {
            throw new HttpError(409, "This response is no longer active.", "CHAT_TURN_EXPIRED");
          }
          const value = { id: assistantId, ...assistantDoc.data(), content, status: "complete", updatedAt: timestamp };
          tx.set(assistantRef, value);
          tx.update(conversationRef, { activeTurnId: null, lockUntil: 0, updatedAt: timestamp });
          return value;
        });
      }
      const finish = db.transaction(() => {
        const conversation = db.prepare("SELECT active_turn_id AS activeTurnId FROM chat_conversations WHERE id = ? AND user_id = ?")
          .get(conversationId, ownerId(uid));
        const assistant = getMessage(uid, conversationId, assistantId);
        if (!conversation || !assistant || conversation.activeTurnId !== turnId) {
          throw new HttpError(409, "This response is no longer active.", "CHAT_TURN_EXPIRED");
        }
        db.prepare("UPDATE chat_messages SET content = ?, status = 'complete' WHERE id = ? AND user_id = ?")
          .run(content, assistantId, ownerId(uid));
        db.prepare("UPDATE chat_conversations SET active_turn_id = NULL, lock_until = 0, updated_at = ? WHERE id = ? AND user_id = ?")
          .run(timestamp, conversationId, ownerId(uid));
        return { ...assistant, content, status: "complete", updatedAt: timestamp };
      });
      return finish();
    },
    async failTurn(uid, conversationId, turnId, content = "") {
      const timestamp = now();
      const assistantId = messageId(turnId, "assistant");
      if (firestore) {
        const conversationRef = conversations(uid).doc(db.safeId(conversationId));
        const assistantRef = messages(uid, conversationId).doc(assistantId);
        return db.firestore.runTransaction(async tx => {
          const [conversationDoc, assistantDoc] = await Promise.all([tx.get(conversationRef), tx.get(assistantRef)]);
          if (!conversationDoc.exists || conversationDoc.data().activeTurnId !== turnId || !assistantDoc.exists) return false;
          tx.set(assistantRef, { ...assistantDoc.data(), content, status: "failed", updatedAt: timestamp });
          tx.update(conversationRef, { activeTurnId: null, lockUntil: 0 });
          return true;
        });
      }
      const fail = db.transaction(() => {
        const conversation = db.prepare("SELECT active_turn_id AS activeTurnId FROM chat_conversations WHERE id = ? AND user_id = ?")
          .get(conversationId, ownerId(uid));
        if (!conversation || conversation.activeTurnId !== turnId) return false;
        db.prepare("UPDATE chat_messages SET content = ?, status = 'failed' WHERE id = ? AND user_id = ?")
          .run(content, assistantId, ownerId(uid));
        db.prepare("UPDATE chat_conversations SET active_turn_id = NULL, lock_until = 0 WHERE id = ? AND user_id = ?")
          .run(conversationId, ownerId(uid));
        return true;
      });
      return fail();
    },
  };
}

module.exports = { createChatStore, conversationTitle };
