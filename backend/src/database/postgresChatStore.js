const { randomUUID } = require("node:crypto");
const { HttpError } = require("../utils/httpError");

const LOCK_MS = 120000;
const DEFAULT_TITLE = "New chat";
const messageId = (turnId, role) => `${turnId}-${role}`;
const now = () => new Date().toISOString();
const conversationTitle = message => {
  const title = message.replace(/\s+/g, " ").trim();
  return title.length > 56 ? `${title.slice(0, 55).trimEnd()}…` : title || DEFAULT_TITLE;
};

function createPostgresChatStore(db) {
  async function get(uid, id, query = db.query) {
    const result = await query(
      `SELECT id, title, message_count AS "messageCount", created_at AS "createdAt",
       updated_at AS "updatedAt" FROM chat_conversations WHERE id = $1 AND user_id = $2`,
      [id, uid],
    );
    return result.rows[0] || null;
  }

  async function listMessages(uid, conversationId, { limit = 100, beforeSeq } = {}, query = db.query) {
    const result = beforeSeq === undefined
      ? await query(
        `SELECT id, conversation_id AS "conversationId", turn_id AS "turnId", seq, role, content,
         status, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM chat_messages WHERE conversation_id = $1 AND user_id = $2
         ORDER BY seq DESC LIMIT $3`,
        [conversationId, uid, limit + 1],
      )
      : await query(
        `SELECT id, conversation_id AS "conversationId", turn_id AS "turnId", seq, role, content,
         status, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM chat_messages WHERE conversation_id = $1 AND user_id = $2 AND seq < $3
         ORDER BY seq DESC LIMIT $4`,
        [conversationId, uid, beforeSeq, limit + 1],
      );
    return result.rows.reverse();
  }

  return {
    async list(uid, { limit = 50, cursor } = {}) {
      const result = cursor
        ? await db.query(
          `SELECT id, title, message_count AS "messageCount", created_at AS "createdAt",
           updated_at AS "updatedAt" FROM chat_conversations
           WHERE user_id = $1 AND (updated_at < $2 OR (updated_at = $2 AND id < $3))
           ORDER BY updated_at DESC, id DESC LIMIT $4`,
          [uid, cursor.updatedAt, cursor.id, limit + 1],
        )
        : await db.query(
          `SELECT id, title, message_count AS "messageCount", created_at AS "createdAt",
           updated_at AS "updatedAt" FROM chat_conversations
           WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2`,
          [uid, limit + 1],
        );
      return result.rows;
    },
    async create(uid) {
      const id = randomUUID();
      const result = await db.query(
        `INSERT INTO chat_conversations (id, user_id, title)
         VALUES ($1, $2, $3)
         RETURNING id, title, message_count AS "messageCount", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, uid, DEFAULT_TITLE],
      );
      return result.rows[0];
    },
    get: (uid, id) => get(uid, id),
    listMessages: (uid, conversationId, options) => listMessages(uid, conversationId, options),
    async rename(uid, id, title) {
      const result = await db.query(
        `UPDATE chat_conversations SET title = $1, updated_at = now()
         WHERE id = $2 AND user_id = $3
         RETURNING id, title, message_count AS "messageCount", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [title, id, uid],
      );
      return result.rows[0] || null;
    },
    async remove(uid, id) {
      return (await db.query("DELETE FROM chat_conversations WHERE id = $1 AND user_id = $2", [id, uid])).rowCount > 0;
    },
    async clear(uid, conversationId) {
      return db.transaction(async client => {
        const conversation = await client.query(
          "SELECT active_turn_id AS \"activeTurnId\", lock_until AS \"lockUntil\" FROM chat_conversations WHERE id = $1 AND user_id = $2 FOR UPDATE",
          [conversationId, uid],
        );
        if (!conversation.rowCount) return false;
        const { activeTurnId, lockUntil } = conversation.rows[0];
        if (activeTurnId && Number(lockUntil) > Date.now()) {
          throw new HttpError(409, "Stop the active response before clearing this conversation.", "CHAT_BUSY");
        }
        await client.query("DELETE FROM chat_messages WHERE conversation_id = $1 AND user_id = $2", [conversationId, uid]);
        await client.query(
          `UPDATE chat_conversations SET title = $1, message_count = 0, active_turn_id = NULL,
           lock_until = 0, updated_at = now() WHERE id = $2 AND user_id = $3`,
          [DEFAULT_TITLE, conversationId, uid],
        );
        return true;
      });
    },
    async editTurn(uid, conversationId, turnId, content) {
      return db.transaction(async client => {
        const conversation = await client.query(
          `SELECT title, active_turn_id AS "activeTurnId", lock_until AS "lockUntil"
           FROM chat_conversations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [conversationId, uid],
        );
        if (!conversation.rowCount) return false;
        if (conversation.rows[0].activeTurnId && Number(conversation.rows[0].lockUntil) > Date.now()) {
          throw new HttpError(409, "Stop the active response before editing a message.", "CHAT_BUSY");
        }
        const userMessage = await client.query(
          "SELECT seq FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND user_id = $3 AND role = 'user'",
          [messageId(turnId, "user"), conversationId, uid],
        );
        if (!userMessage.rowCount) return false;
        const seq = userMessage.rows[0].seq;
        await client.query(
          "UPDATE chat_messages SET content = $1, updated_at = now() WHERE id = $2 AND user_id = $3",
          [content, messageId(turnId, "user"), uid],
        );
        await client.query("DELETE FROM chat_messages WHERE conversation_id = $1 AND user_id = $2 AND seq > $3", [conversationId, uid, seq]);
        await client.query(
          `UPDATE chat_conversations SET message_count = $1, title = $2, updated_at = now(),
           active_turn_id = NULL, lock_until = 0 WHERE id = $3 AND user_id = $4`,
          [seq, seq === 1 ? conversationTitle(content) : conversation.rows[0].title, conversationId, uid],
        );
        return true;
      });
    },
    async beginTurn(uid, conversationId, turnId, content, regenerate = false) {
      const userId = messageId(turnId, "user");
      const assistantId = messageId(turnId, "assistant");
      return db.transaction(async client => {
        const conversationResult = await client.query(
          `SELECT title, message_count AS "messageCount", active_turn_id AS "activeTurnId",
           lock_until AS "lockUntil" FROM chat_conversations
           WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [conversationId, uid],
        );
        if (!conversationResult.rowCount) throw new HttpError(404, "Conversation not found.", "NOT_FOUND");
        const conversation = conversationResult.rows[0];
        const lockIsActive = conversation.activeTurnId && Number(conversation.lockUntil) > Date.now();
        if (lockIsActive) {
          throw new HttpError(409, "Another response is being generated. Wait or stop it before sending another message.", "CHAT_BUSY");
        }
        const [userResult, assistantResult] = await Promise.all([
          client.query(
            "SELECT seq, role FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND user_id = $3",
            [userId, conversationId, uid],
          ),
          client.query(
            `SELECT id, turn_id AS "turnId", seq, role, content, status, created_at AS "createdAt",
             updated_at AS "updatedAt" FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND user_id = $3`,
            [assistantId, conversationId, uid],
          ),
        ]);
        const userMessage = userResult.rows[0];
        const assistant = assistantResult.rows[0];
        if (assistant?.status === "complete" && !regenerate) return { cached: true, assistant };
        if (regenerate && (!userMessage || !assistant || assistant.status === "streaming")) {
          throw new HttpError(409, "This response can no longer be regenerated.", "CHAT_REGENERATE_CONFLICT");
        }
        let count = Number(conversation.messageCount);
        if (!regenerate && !userMessage) {
          await client.query(
            `INSERT INTO chat_messages (id, conversation_id, user_id, turn_id, seq, role, content, status)
             VALUES ($1, $2, $3, $4, $5, 'user', $6, 'complete')`,
            [userId, conversationId, uid, turnId, count + 1, content],
          );
          await client.query(
            `UPDATE chat_conversations SET title = $1, message_count = message_count + 2,
             updated_at = now() WHERE id = $2 AND user_id = $3`,
            [count === 0 && conversation.title === DEFAULT_TITLE ? conversationTitle(content) : conversation.title, conversationId, uid],
          );
          count += 1;
        }
        if (!assistant) {
          await client.query(
            `INSERT INTO chat_messages (id, conversation_id, user_id, turn_id, seq, role, content, status)
             VALUES ($1, $2, $3, $4, $5, 'assistant', '', 'streaming')`,
            [assistantId, conversationId, uid, turnId, count + 1],
          );
          if (userMessage) {
            await client.query(
              "UPDATE chat_conversations SET message_count = message_count + 1 WHERE id = $1 AND user_id = $2",
              [conversationId, uid],
            );
          }
        } else {
          await client.query(
            `UPDATE chat_messages SET content = '', status = 'streaming', created_at = now(), updated_at = NULL
             WHERE id = $1 AND conversation_id = $2 AND user_id = $3`,
            [assistantId, conversationId, uid],
          );
        }
        await client.query(
          `UPDATE chat_conversations SET active_turn_id = $1, lock_until = $2,
           updated_at = now() WHERE id = $3 AND user_id = $4`,
          [turnId, Date.now() + LOCK_MS, conversationId, uid],
        );
        return { cached: false, assistantId, userMessageId: userId };
      });
    },
    async context(uid, conversationId, turnId) {
      const result = await db.query(
        `SELECT id, turn_id AS "turnId", role, content, status, seq
         FROM chat_messages WHERE user_id = $1 AND conversation_id = $2 ORDER BY seq ASC`,
        [uid, conversationId],
      );
      const messages = result.rows;
      const assistantIndex = messages.findIndex(message => message.id === messageId(turnId, "assistant"));
      const before = assistantIndex < 0 ? messages : messages.slice(0, assistantIndex);
      const assistantStatuses = new Map(messages.filter(message => message.role === "assistant").map(message => [message.turnId, message.status]));
      const recent = before.filter(message => message.status === "complete"
        && !(message.role === "user" && assistantStatuses.get(message.turnId) === "failed")).slice(-40);
      if (recent[0]?.role === "assistant") recent.shift();
      return recent.map(({ role, content }) => ({ role: role === "assistant" ? "model" : "user", text: content }));
    },
    async completeTurn(uid, conversationId, turnId, content) {
      return db.transaction(async client => {
        const conversation = await client.query(
          "SELECT active_turn_id AS \"activeTurnId\" FROM chat_conversations WHERE id = $1 AND user_id = $2 FOR UPDATE",
          [conversationId, uid],
        );
        if (!conversation.rowCount || conversation.rows[0].activeTurnId !== turnId) {
          throw new HttpError(409, "This response is no longer active.", "CHAT_TURN_EXPIRED");
        }
        const result = await client.query(
          `UPDATE chat_messages SET content = $1, status = 'complete', updated_at = now()
           WHERE id = $2 AND conversation_id = $3 AND user_id = $4
           RETURNING id, turn_id AS "turnId", seq, role, content, status, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [content, messageId(turnId, "assistant"), conversationId, uid],
        );
        if (!result.rowCount) throw new HttpError(409, "This response is no longer active.", "CHAT_TURN_EXPIRED");
        await client.query(
          "UPDATE chat_conversations SET active_turn_id = NULL, lock_until = 0, updated_at = now() WHERE id = $1 AND user_id = $2",
          [conversationId, uid],
        );
        return result.rows[0];
      });
    },
    async failTurn(uid, conversationId, turnId, content = "") {
      return db.transaction(async client => {
        const conversation = await client.query(
          "SELECT active_turn_id AS \"activeTurnId\" FROM chat_conversations WHERE id = $1 AND user_id = $2 FOR UPDATE",
          [conversationId, uid],
        );
        if (!conversation.rowCount || conversation.rows[0].activeTurnId !== turnId) return false;
        await client.query(
          `UPDATE chat_messages SET content = $1, status = 'failed', updated_at = now()
           WHERE id = $2 AND conversation_id = $3 AND user_id = $4`,
          [content, messageId(turnId, "assistant"), conversationId, uid],
        );
        await client.query(
          "UPDATE chat_conversations SET active_turn_id = NULL, lock_until = 0 WHERE id = $1 AND user_id = $2",
          [conversationId, uid],
        );
        return true;
      });
    },
  };
}

module.exports = { createPostgresChatStore };
