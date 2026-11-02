import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import "./Features.css";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export default function TasksPage() {
  const { notes } = useOutletContext();
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState({ title: "", description: "", priority: "medium", dueDate: "", noteId: "" });
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      const { items } = await api.tasks.list({ status: filter === "all" ? undefined : filter });
      setTasks(items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tasks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTasks(); }, [filter]);

  const grouped = useMemo(() => ({
    todo: tasks.filter(task => task.status === "todo"),
    in_progress: tasks.filter(task => task.status === "in_progress"),
    done: tasks.filter(task => task.status === "done"),
  }), [tasks]);

  async function createTask(event) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    setBusy(true);
    try {
      const { item } = await api.tasks.create({
        title: draft.title.trim(),
        description: draft.description,
        priority: draft.priority,
        dueDate: draft.dueDate || null,
        noteId: draft.noteId || null,
      });
      setTasks(current => [item, ...current]);
      setDraft({ title: "", description: "", priority: "medium", dueDate: "", noteId: "" });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Task could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function updateTask(id, changes) {
    const { item } = await api.tasks.update(id, changes);
    setTasks(current => current.map(task => (task.id === id ? item : task)));
  }

  async function removeTask(id) {
    await api.tasks.remove(id);
    setTasks(current => current.filter(task => task.id !== id));
  }

  async function suggestFromNote(noteId) {
    setBusy(true);
    setError("");
    try {
      const { suggestions: next } = await api.tasks.suggestFromNote({ noteId });
      setSuggestions(next);
    } catch (suggestError) {
      setError(suggestError instanceof Error ? suggestError.message : "AI suggestions failed.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptSuggestion(suggestion) {
    const { item } = await api.tasks.create({ ...suggestion, status: "todo" });
    setTasks(current => [item, ...current]);
    setSuggestions(current => current.filter(entry => entry.title !== suggestion.title));
  }

  const calendarDays = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const days = [];
    for (let day = 1; day <= end.getDate(); day += 1) {
      const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      days.push({ date, tasks: tasks.filter(task => task.dueDate === date) });
    }
    return days;
  }, [tasks]);

  function renderTaskCard(task) {
    return (
      <article className="feature-task-card" key={task.id}>
        <div className="feature-task-head">
          <select value={task.status} onChange={(event) => updateTask(task.id, { status: event.target.value })}>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
          <span className={`feature-priority feature-priority-${task.priority}`}>{task.priority}</span>
        </div>
        <h3>{task.title}</h3>
        {task.description && <p>{task.description}</p>}
        <div className="feature-task-meta">
          {task.dueDate && <span>Due {task.dueDate}</span>}
          {task.noteId && <Link to={`/dashboard/notes/${task.noteId}/edit`}>Linked note</Link>}
        </div>
        <button className="dashboard-subtle-link dashboard-delete-button" type="button" onClick={() => removeTask(task.id)}>Delete</button>
      </article>
    );
  }

  return (
    <div className="dashboard-page feature-page">
      <div className="dashboard-page-heading">
        <div>
          <span className="dashboard-eyebrow">SMART PRODUCTIVITY</span>
          <h1>Smart Tasks</h1>
          <p>Track work across list, calendar, and Kanban views. AI suggestions require your confirmation.</p>
        </div>
        <div className="feature-view-toggle">
          {["list", "calendar", "kanban"].map(name => (
            <button key={name} type="button" className={view === name ? "is-active" : ""} onClick={() => setView(name)}>{name}</button>
          ))}
        </div>
      </div>
      {error && <p className="dashboard-form-error" role="alert">{error}</p>}
      <div className="feature-split">
        <section className="feature-panel">
          <h2>Create task</h2>
          <form className="feature-task-form" onSubmit={createTask}>
            <input value={draft.title} onChange={(event) => setDraft(current => ({ ...current, title: event.target.value }))} placeholder="Task title" required maxLength={160} />
            <textarea value={draft.description} onChange={(event) => setDraft(current => ({ ...current, description: event.target.value }))} placeholder="Description" rows={3} />
            <div className="feature-task-form-row">
              <select value={draft.priority} onChange={(event) => setDraft(current => ({ ...current, priority: event.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <input type="date" value={draft.dueDate} onChange={(event) => setDraft(current => ({ ...current, dueDate: event.target.value }))} />
            </div>
            <select value={draft.noteId} onChange={(event) => setDraft(current => ({ ...current, noteId: event.target.value }))}>
              <option value="">No linked note</option>
              {notes.map(note => <option key={note.id} value={note.id}>{note.title || "Untitled"}</option>)}
            </select>
            <button className="dashboard-primary-button" type="submit" disabled={busy}>Add task</button>
          </form>
          <div className="feature-suggest-box">
            <h3>AI suggestions from notes</h3>
            <select defaultValue="" onChange={(event) => { if (event.target.value) suggestFromNote(event.target.value); event.target.value = ""; }}>
              <option value="">Choose a note…</option>
              {notes.map(note => <option key={note.id} value={note.id}>{note.title || "Untitled"}</option>)}
            </select>
            {suggestions.map(suggestion => (
              <div className="feature-suggestion" key={suggestion.title}>
                <div><strong>{suggestion.title}</strong><p>{suggestion.description}</p></div>
                <button className="dashboard-secondary-button" type="button" onClick={() => acceptSuggestion(suggestion)}>Save task</button>
              </div>
            ))}
          </div>
        </section>
        <section className="feature-panel">
          <div className="feature-task-toolbar">
            <h2>Tasks</h2>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </div>
          {loading && <p className="dashboard-search-status" role="status">Loading tasks…</p>}
          {!loading && view === "list" && (
            <div className="feature-task-list">
              {[...tasks].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).map(renderTaskCard)}
            </div>
          )}
          {!loading && view === "kanban" && (
            <div className="feature-kanban">
              {Object.entries(grouped).map(([status, items]) => (
                <div key={status}>
                  <h3>{status.replace("_", " ")}</h3>
                  {items.map(renderTaskCard)}
                </div>
              ))}
            </div>
          )}
          {!loading && view === "calendar" && (
            <div className="feature-calendar">
              {calendarDays.map(day => (
                <article key={day.date}>
                  <strong>{day.date.slice(-2)}</strong>
                  <span>{day.tasks.length} task{day.tasks.length === 1 ? "" : "s"}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
