const { randomUUID } = require("node:crypto");
const { HttpError } = require("../utils/httpError");
const { requireString } = require("../utils/validation");

const STATUSES = new Set(["todo", "in_progress", "done"]);
const PRIORITIES = new Set(["low", "medium", "high"]);

function parseTaskInput(body, { partial = false } = {}) {
  const result = {};
  if (Object.hasOwn(body, "title")) result.title = requireString(body.title, "title", { min: 1, max: 160 });
  if (Object.hasOwn(body, "description")) result.description = requireString(body.description, "description", { max: 4000, trim: false });
  if (Object.hasOwn(body, "status")) {
    if (!STATUSES.has(body.status)) throw new HttpError(400, "status must be todo, in_progress, or done.", "INVALID_INPUT");
    result.status = body.status;
  }
  if (Object.hasOwn(body, "priority")) {
    if (!PRIORITIES.has(body.priority)) throw new HttpError(400, "priority must be low, medium, or high.", "INVALID_INPUT");
    result.priority = body.priority;
  }
  if (Object.hasOwn(body, "noteId")) result.noteId = body.noteId ? requireString(body.noteId, "noteId", { max: 64 }) : null;
  if (Object.hasOwn(body, "dueDate")) result.dueDate = body.dueDate || null;
  if (Object.hasOwn(body, "reminderAt")) result.reminderAt = body.reminderAt || null;
  if (!partial && !result.title) throw new HttpError(400, "title is required.", "INVALID_INPUT");
  return result;
}

function mapTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    reminderAt: row.reminder_at,
    noteId: row.note_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createTaskService(db) {
  if (db.kind !== "postgres") throw new Error("Tasks require PostgreSQL.");

  return {
    parseTaskInput,
    async list(uid, { status, q } = {}) {
      const conditions = ["user_id = $1"];
      const params = [uid];
      if (status && STATUSES.has(status)) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (q?.trim()) {
        params.push(`%${q.trim().toLowerCase()}%`);
        conditions.push(`(lower(title) LIKE $${params.length} OR lower(description) LIKE $${params.length})`);
      }
      const result = await db.query(
        `SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC`,
        params,
      );
      return result.rows.map(mapTask);
    },
    async create(uid, input) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO tasks (id, user_id, note_id, title, description, status, priority, due_date, reminder_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          uid,
          input.noteId || null,
          input.title,
          input.description || "",
          input.status || "todo",
          input.priority || "medium",
          input.dueDate || null,
          input.reminderAt || null,
        ],
      );
      return mapTask((await db.query("SELECT * FROM tasks WHERE id = $1 AND user_id = $2", [id, uid])).rows[0]);
    },
    async update(uid, id, input) {
      const existing = (await db.query("SELECT * FROM tasks WHERE id = $1 AND user_id = $2", [id, uid])).rows[0];
      if (!existing) return null;
      const next = {
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        status: input.status ?? existing.status,
        priority: input.priority ?? existing.priority,
        note_id: input.noteId === undefined ? existing.note_id : input.noteId,
        due_date: input.dueDate === undefined ? existing.due_date : input.dueDate,
        reminder_at: input.reminderAt === undefined ? existing.reminder_at : input.reminderAt,
      };
      await db.query(
        `UPDATE tasks SET title = $1, description = $2, status = $3, priority = $4, note_id = $5,
         due_date = $6, reminder_at = $7, updated_at = now() WHERE id = $8 AND user_id = $9`,
        [next.title, next.description, next.status, next.priority, next.note_id, next.due_date, next.reminder_at, id, uid],
      );
      return mapTask((await db.query("SELECT * FROM tasks WHERE id = $1 AND user_id = $2", [id, uid])).rows[0]);
    },
    async remove(uid, id) {
      return (await db.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2", [id, uid])).rowCount > 0;
    },
  };
}

module.exports = { createTaskService, parseTaskInput };
