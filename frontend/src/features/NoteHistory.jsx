import { useEffect, useState } from "react";
import { api } from "../api/client";
import "./Features.css";

function renderDiffPart(part, index) {
  if (part.type === "equal") return <span key={index}>{part.value}</span>;
  if (part.type === "added") return <ins key={index}>{part.value}</ins>;
  return <del key={index}>{part.value}</del>;
}

export default function NoteHistory({ noteId, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [compare, setCompare] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState("");

  async function loadVersions() {
    setLoading(true);
    setError("");
    try {
      const { items } = await api.noteVersions.list(noteId);
      setVersions(items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Version history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (noteId) loadVersions(); }, [noteId]);

  function toggleVersion(id) {
    setSelected(current => {
      if (current.includes(id)) return current.filter(item => item !== id);
      const next = [...current, id].slice(-2);
      return next;
    });
  }

  async function runCompare() {
    if (selected.length !== 2) return;
    const [leftId, rightId] = selected;
    const data = await api.noteVersions.compare(noteId, leftId, rightId);
    setCompare(data);
  }

  async function restore(versionId) {
    if (!window.confirm("Restore this version? Your current content will be preserved in history.")) return;
    setRestoring(versionId);
    try {
      const { item } = await api.noteVersions.restore(noteId, versionId);
      onRestored?.(item);
      await loadVersions();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Restore failed.");
    } finally {
      setRestoring("");
    }
  }

  return (
    <section className="feature-history">
      <div className="dashboard-note-ai-heading">
        <div><span className="dashboard-eyebrow">VERSION TIMELINE</span><h2>Note history</h2></div>
      </div>
      {error && <p className="dashboard-form-error" role="alert">{error}</p>}
      {loading && <p className="dashboard-search-status" role="status">Loading versions…</p>}
      {!loading && !versions.length && <p className="feature-empty">Meaningful edits will appear here automatically.</p>}
      <ul className="feature-history-list">
        {versions.map(version => (
          <li key={version.id}>
            <label>
              <input type="checkbox" checked={selected.includes(version.id)} onChange={() => toggleVersion(version.id)} />
              <div>
                <strong>v{version.versionNumber} · {version.title}</strong>
                <span>{new Date(version.createdAt).toLocaleString()} · {version.changeSummary}</span>
              </div>
            </label>
            <button className="dashboard-secondary-button" type="button" disabled={restoring === version.id} onClick={() => restore(version.id)}>
              {restoring === version.id ? "Restoring…" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
      {selected.length === 2 && (
        <button className="dashboard-primary-button" type="button" onClick={runCompare}>Compare selected</button>
      )}
      {compare && (
        <div className="feature-diff">
          <h3>Comparison</h3>
          <p>{compare.left.versionNumber} → {compare.right.versionNumber}</p>
          <div className="feature-diff-body">{compare.diff.map(renderDiffPart)}</div>
        </div>
      )}
    </section>
  );
}
