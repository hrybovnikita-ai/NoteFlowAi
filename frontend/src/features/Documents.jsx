import { useEffect, useState } from "react";
import { api } from "../api/client";
import "./Features.css";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  async function loadDocuments(search = query) {
    setLoading(true);
    setError("");
    try {
      const { items } = await api.documents.list({ q: search });
      setDocuments(items);
      setSelectedIds(current => current.filter(id => items.some(doc => doc.id === id)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Documents could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDocuments(""); }, []);

  async function onUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const { item } = await api.documents.upload(file);
      setDocuments(current => [item, ...current]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id) {
    if (!window.confirm("Delete this document and its indexed text?")) return;
    try {
      await api.documents.remove(id);
      setDocuments(current => current.filter(doc => doc.id !== id));
      setSelectedIds(current => current.filter(item => item !== id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    }
  }

  async function onAsk(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError("");
    setAnswer(null);
    try {
      const response = await api.documents.ask({
        question: question.trim(),
        documentIds: selectedIds.length ? selectedIds : undefined,
      });
      setAnswer(response);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "Document chat failed.");
    } finally {
      setAsking(false);
    }
  }

  function toggleDocument(id) {
    setSelectedIds(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  }

  return (
    <div className="dashboard-page feature-page">
      <div className="dashboard-page-heading">
        <div>
          <span className="dashboard-eyebrow">DOCUMENT INTELLIGENCE</span>
          <h1>AI Document Chat</h1>
          <p>Upload PDF, DOCX, or TXT files and ask grounded questions with real citations.</p>
        </div>
        <label className="dashboard-primary-button feature-upload-button">
          {uploading ? "Uploading…" : "Upload document"}
          <input type="file" accept=".pdf,.docx,.txt,application/pdf,text/plain" hidden onChange={onUpload} disabled={uploading} />
        </label>
      </div>
      <form className="feature-search-row" onSubmit={(event) => { event.preventDefault(); loadDocuments(query); }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents…" />
        <button className="dashboard-secondary-button" type="submit">Search</button>
      </form>
      {error && <p className="dashboard-form-error" role="alert">{error}</p>}
      <div className="feature-split">
        <section className="feature-panel">
          <h2>Your documents</h2>
          {loading && <p className="dashboard-search-status" role="status">Loading…</p>}
          {!loading && !documents.length && <p className="feature-empty">No documents yet. Upload a file to start.</p>}
          <ul className="feature-doc-list">
            {documents.map(doc => (
              <li key={doc.id}>
                <label>
                  <input type="checkbox" checked={selectedIds.includes(doc.id)} onChange={() => toggleDocument(doc.id)} />
                  <div>
                    <strong>{doc.filename}</strong>
                    <span>{Math.round(doc.sizeBytes / 1024)} KB · {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"}</span>
                  </div>
                </label>
                <button className="dashboard-subtle-link dashboard-delete-button" type="button" onClick={() => onDelete(doc.id)}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
        <section className="feature-panel">
          <h2>Ask your documents</h2>
          <form className="feature-doc-chat" onSubmit={onAsk}>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} placeholder="Ask a question about the selected documents…" maxLength={2000} />
            <button className="dashboard-primary-button" type="submit" disabled={asking || !question.trim()}>{asking ? "Thinking…" : "Ask Gemini"}</button>
          </form>
          {answer && (
            <div className="feature-doc-answer">
              <p>{answer.answer}</p>
              {answer.sources?.length > 0 && (
                <ul>
                  {answer.sources.map(source => (
                    <li key={source.chunkId}>
                      <strong>{source.filename}</strong> · p.{source.pageNumber}
                      <span>{source.excerpt}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
