import { BillingSettings } from "../../billing/Billing";
import { getFirebaseAuthMessage } from "../../auth/firebaseAuthErrors";
import { useAuth } from "../../auth/useAuth";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { api } from "../../api/client";
import NoteHistory from "../../features/NoteHistory";
import "./Dashboard.css";

const navigation = [
  { to: "/dashboard", label: "Dashboard", icon: "⌂", end: true },
  { to: "/dashboard/notes", label: "All Notes", icon: "▤" },
  { to: "/dashboard/notes/new", label: "Create Note", icon: "＋" },
  { to: "/dashboard/favorites", label: "Favorites", icon: "♡" },
  { to: "/dashboard/collections", label: "Collections", icon: "▣" },
  { to: "/dashboard/tags", label: "Tags", icon: "⌗" },
  { to: "/dashboard/search", label: "AI Search", icon: "⌕" },
  { to: "/dashboard/knowledge-graph", label: "Knowledge Graph", icon: "◉" },
  { to: "/dashboard/documents", label: "Documents", icon: "▥" },
  { to: "/dashboard/tasks", label: "Tasks", icon: "☑" },
  { to: "/chat", label: "Chat", icon: "chat" },
  { to: "/dashboard/pricing", label: "Pricing", icon: "$" },
  { to: "/dashboard/settings", label: "Settings", icon: "⚙" },
];

function formatDate(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function getCollections(notes) {
  return [...new Set(notes.map((note) => note.collection?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function NoteCard({ note, onFavorite, onDelete, onArchive }) {
  const preview = note.content.trim() || "This note is ready for your next thought.";

  return (
    <article className="dashboard-note-card">
      <div className="dashboard-note-card-top">
        <span className="dashboard-note-date">Edited {formatDate(note.updatedAt)}</span>
        <button
          className={`dashboard-icon-button${note.favorite ? " is-favorite" : ""}`}
          type="button"
          aria-label={note.favorite ? `Remove ${note.title} from favorites` : `Add ${note.title} to favorites`}
          aria-pressed={note.favorite}
          onClick={() => onFavorite(note)}
        >
          {note.favorite ? "★" : "☆"}
        </button>
      </div>
      <Link className="dashboard-note-title" to={`/dashboard/notes/${note.id}/edit`}>{note.title || "Untitled note"}</Link>
      <p className="dashboard-note-preview">{preview}</p>
      <div className="dashboard-note-meta">
        {note.collection && <span className="dashboard-note-collection">{note.collection}</span>}
        {note.tags?.map((tag) => <span className="dashboard-tag" key={tag}>{tag}</span>)}
      </div>
      <div className="dashboard-note-actions">
        <Link className="dashboard-subtle-link" to={`/dashboard/notes/${note.id}/edit`}>Edit</Link>
        <button className="dashboard-subtle-link" type="button" onClick={() => onArchive(note)}>Archive</button>
        <button className="dashboard-subtle-link dashboard-delete-button" type="button" onClick={() => onDelete(note)}>Delete</button>
      </div>
    </article>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="dashboard-empty-state">
      <span className="dashboard-empty-icon" aria-hidden="true">✦</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function NoteGrid({ notes }) {
  const { toggleFavorite, deleteNote, archiveNote } = useOutletContext();

  if (!notes.length) {
    return (
      <EmptyState
        title="Nothing here just yet"
        description="Create a note and give your ideas a place to land."
        action={<Link className="dashboard-primary-button" to="/dashboard/notes/new">Create a note <span aria-hidden="true">＋</span></Link>}
      />
    );
  }

  return (
    <div className="dashboard-note-grid">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} onFavorite={toggleFavorite} onDelete={deleteNote} onArchive={archiveNote} />
      ))}
    </div>
  );
}

function DashboardHome() {
  const { notes } = useOutletContext();
  const [currentTime] = useState(() => Date.now());
  const collections = getCollections(notes);
  const favorites = notes.filter((note) => note.favorite).length;
  const sortedNotes = [...notes].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const recentCount = sortedNotes.filter((note) => {
    const age = currentTime - new Date(note.updatedAt).getTime();
    return age >= 0 && age < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const recentlyUpdated = sortedNotes.slice(0, 3);

  const stats = [
    { label: "Total Notes", value: notes.length, icon: "▤" },
    { label: "Favorite Notes", value: favorites, icon: "♡" },
    { label: "Collections", value: collections.length, icon: "▣" },
    { label: "Recently Updated", value: recentCount, icon: "↻", caption: "in the last 7 days" },
  ];

  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome">
        <div>
          <span className="dashboard-eyebrow">YOUR PERSONAL WORKSPACE</span>
          <h1>Welcome to NoteFlow AI</h1>
          <p>Your ideas, notes, and inspiration — all in one beautiful workspace.</p>
        </div>
        <Link className="dashboard-primary-button" to="/dashboard/notes/new">Create New Note <span aria-hidden="true">＋</span></Link>
      </section>

      <section className="dashboard-stats" aria-label="Note statistics">
        {stats.map((stat) => (
          <article className="dashboard-stat-card" key={stat.label}>
            <span className="dashboard-stat-icon" aria-hidden="true">{stat.icon}</span>
            <span className="dashboard-stat-label">{stat.label}</span>
            <strong>{stat.value}</strong>
            {stat.caption && <span className="dashboard-stat-caption">{stat.caption}</span>}
          </article>
        ))}
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div><span className="dashboard-eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>Recently edited</h2></div>
          {notes.length > 0 && <Link className="dashboard-subtle-link" to="/dashboard/notes">View all notes <span aria-hidden="true">→</span></Link>}
        </div>
        <NoteGrid notes={recentlyUpdated} />
      </section>
    </div>
  );
}

function NotesPage({ favoritesOnly = false }) {
  const { notes } = useOutletContext();
  const [query, setQuery] = useState("");
  const visibleNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return notes
      .filter((note) => !favoritesOnly || note.favorite)
      .filter((note) => !normalizedQuery || [note.title, note.content, note.collection, ...(note.tags ?? [])].join(" ").toLowerCase().includes(normalizedQuery))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [favoritesOnly, notes, query]);
  const title = favoritesOnly ? "Favorite Notes" : "All Notes";

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading">
        <div><span className="dashboard-eyebrow">{favoritesOnly ? "THE THOUGHTS YOU SAVED" : "YOUR IDEAS, ALL TOGETHER"}</span><h1>{title}</h1></div>
        <Link className="dashboard-primary-button" to="/dashboard/notes/new">Create New Note <span aria-hidden="true">＋</span></Link>
      </div>
      <label className="dashboard-search-field">
        <span aria-hidden="true">⌕</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your notes..." aria-label="Search notes" />
      </label>
      {visibleNotes.length ? <NoteGrid notes={visibleNotes} /> : (
        <EmptyState
          title={query ? "No matching notes" : favoritesOnly ? "No favorites yet" : "Your notes will show up here"}
          description={query ? "Try another keyword or tag." : favoritesOnly ? "Tap the star on a note to keep it close." : "Create your first note to get started."}
          action={!query && <Link className="dashboard-primary-button" to="/dashboard/notes/new">Create a note <span aria-hidden="true">＋</span></Link>}
        />
      )}
    </div>
  );
}

function CollectionsPage() {
  const { notes } = useOutletContext();
  const collections = getCollections(notes);

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading"><div><span className="dashboard-eyebrow">KEEP RELATED THOUGHTS TOGETHER</span><h1>Collections</h1></div></div>
      {!collections.length ? (
        <EmptyState title="No collections yet" description="Choose a collection when you create or edit a note. Your collections will appear here." />
      ) : (
        <div className="dashboard-collection-grid">
          {collections.map((collection) => {
            const collectionNotes = notes.filter((note) => note.collection === collection);
            return (
              <section className="dashboard-collection-card" key={collection}>
                <span className="dashboard-stat-icon" aria-hidden="true">▣</span>
                <h2>{collection}</h2>
                <p>{collectionNotes.length} {collectionNotes.length === 1 ? "note" : "notes"}</p>
                <div className="dashboard-collection-links">
                  {collectionNotes.slice(0, 3).map((note) => <Link key={note.id} to={`/dashboard/notes/${note.id}/edit`}>{note.title || "Untitled note"}</Link>)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TagsPage() {
  const { notes } = useOutletContext();
  const tags = useMemo(() => {
    const tagMap = new Map();
    notes.forEach((note) => note.tags?.forEach((tag) => tagMap.set(tag, [...(tagMap.get(tag) ?? []), note])));
    return [...tagMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [notes]);

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading"><div><span className="dashboard-eyebrow">FOLLOW A THREAD OF THOUGHT</span><h1>Tags</h1></div></div>
      {!tags.length ? (
        <EmptyState title="No tags yet" description="Add tags in the note editor to find related ideas here." />
      ) : (
        <div className="dashboard-tag-groups">
          {tags.map(([tag, taggedNotes]) => (
            <section className="dashboard-tag-group" key={tag}>
              <h2><span className="dashboard-tag">⌗ {tag}</span><span>{taggedNotes.length}</span></h2>
              {taggedNotes.map((note) => <Link key={note.id} to={`/dashboard/notes/${note.id}/edit`}>{note.title || "Untitled note"}</Link>)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchPage() {
  const { searchNotes } = useOutletContext();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  async function handleSearch(event) {
    event.preventDefault();
    const searchTerm = query.trim();
    setSubmittedQuery(searchTerm);
    setIsSearching(true);
    setError("");
    try {
      setResults(searchTerm ? await searchNotes(searchTerm) : []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed. Please try again.");
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading"><div><span className="dashboard-eyebrow">FIND THE THREAD</span><h1>AI Search</h1></div></div>
      <section className="dashboard-ai-search">
        <span className="dashboard-search-orb" aria-hidden="true">✦</span>
        <h2>Find the idea you’re looking for.</h2>
        <p>Search your notes by title, content, collection, or tag.</p>
        <form className="dashboard-search-form" onSubmit={handleSearch}>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try a keyword or phrase..." aria-label="Search all notes" />
          <button className="dashboard-primary-button" type="submit" disabled={!query.trim() || isSearching}>{isSearching ? "Searching..." : "Search"} <span aria-hidden="true">⌕</span></button>
        </form>
        <span className="dashboard-prototype-note">Keyword search is powered by your secure NoteFlow AI account.</span>
      </section>
      {error && <p className="dashboard-form-error" role="alert">{error}</p>}
      {isSearching ? <p className="dashboard-search-status" role="status">Looking through your notes...</p> : submittedQuery && (
        results.length ? (
          <section className="dashboard-section">
            <div className="dashboard-section-heading"><h2>{results.length} {results.length === 1 ? "result" : "results"} for “{submittedQuery}”</h2></div>
            <NoteGrid notes={results} />
          </section>
        ) : <EmptyState title="No matching notes" description="Try a different phrase, tag, or collection name." />
      )}
    </div>
  );
}

function NoteEditorPage() {
  const { noteId } = useParams();
  const navigate = useNavigate();
  const { notes, saveNote, collections, notesLoading } = useOutletContext();
  const existingNote = notes.find((note) => note.id === noteId);
  const [title, setTitle] = useState(existingNote?.title ?? "");
  const [content, setContent] = useState(existingNote?.content ?? "");
  const [tagsText, setTagsText] = useState(existingNote?.tags?.join(", ") ?? "");
  const [collection, setCollection] = useState(existingNote?.collection ?? "");
  const [favorite, setFavorite] = useState(existingNote?.favorite ?? false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [aiAction, setAiAction] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiDraft, setAiDraft] = useState(null);
  const [aiQuestion, setAiQuestion] = useState("");

  if (noteId && notesLoading) {
    return <p className="dashboard-search-status" role="status">Loading your note…</p>;
  }
  if (noteId && !existingNote) {
    return (
      <div className="dashboard-page">
        <EmptyState title="Note not found" description="This note may have been deleted or is not available in your account." action={<Link className="dashboard-primary-button" to="/dashboard/notes">Back to notes</Link>} />
      </div>
    );
  }

  async function generateWithAi(action) {
    setAiAction(action);
    setAiError("");
    setAiDraft(null);
    try {
      const input = {
        ...(existingNote ? { noteId: existingNote.id } : {}),
        title,
        content,
        ...(action === "ask" ? { question: aiQuestion } : {}),
      };
      const result = await api.ai[action](input);
      setAiDraft({ action, result: result.result });
    } catch (aiRequestError) {
      setAiError(aiRequestError instanceof Error ? aiRequestError.message : "The AI request failed. Please try again.");
    } finally {
      setAiAction("");
    }
  }

  function applyAiDraft() {
    if (!aiDraft) return;
    if (aiDraft.action === "title") setTitle(aiDraft.result);
    if (aiDraft.action === "tags") setTagsText(aiDraft.result.join(", "));
    if (aiDraft.action === "summarize" || aiDraft.action === "improve") setContent(aiDraft.result);
    setAiDraft(null);
  }

  async function handleSave(event) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Add a title before saving your note.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await saveNote({
        ...(existingNote ? { id: existingNote.id } : {}),
        title: trimmedTitle,
        content,
        tags: [...new Set(tagsText.split(",").map((tag) => tag.trim()).filter(Boolean))],
        collection: collection.trim(),
        favorite,
      });
      navigate("/dashboard/notes");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Your note could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading">
        <div><span className="dashboard-eyebrow">{existingNote ? "KEEP BUILDING ON THIS THOUGHT" : "CAPTURE A NEW IDEA"}</span><h1>{existingNote ? "Edit note" : "Create a note"}</h1></div>
      </div>
      <form className="dashboard-editor" onSubmit={handleSave}>
        <label htmlFor="note-title">Title</label>
        <input id="note-title" className="dashboard-editor-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give your note a title" maxLength={120} required />
        <div className="dashboard-editor-meta"><span>Last edited {existingNote ? formatDate(existingNote.updatedAt) : "When you save"}</span>
          <button className={`dashboard-favorite-toggle${favorite ? " is-favorite" : ""}`} type="button" aria-pressed={favorite} onClick={() => setFavorite((current) => !current)}>{favorite ? "★ Favorited" : "☆ Add to favorites"}</button>
        </div>
        <label htmlFor="note-content">Your thoughts</label>
        <textarea id="note-content" className="dashboard-editor-content" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Start anywhere. You can shape the idea later." rows={14} />
        <section className="dashboard-note-ai" aria-label="AI writing tools">
          <div className="dashboard-note-ai-heading">
            <div><span className="dashboard-eyebrow">NOTE ASSISTANT</span><h2>AI writing tools</h2></div>
            <span className="dashboard-note-ai-model">Gemini</span>
          </div>
          <div className="dashboard-note-ai-actions">
            {[
              ["summarize", "Summarize"],
              ["improve", "Improve writing"],
              ["title", "Generate title"],
              ["tags", "Suggest tags"],
            ].map(([action, label]) => (
              <button
                className="dashboard-secondary-button"
                key={action}
                type="button"
                disabled={!content.trim() || Boolean(aiAction) || isSaving}
                onClick={() => generateWithAi(action)}
              >
                {aiAction === action ? `${label}…` : label}
              </button>
            ))}
          </div>
          <form
            className="dashboard-note-ai-question"
            onSubmit={(event) => {
              event.preventDefault();
              generateWithAi("ask");
            }}
          >
            <label htmlFor="note-ai-question">Ask about this note</label>
            <div>
              <input
                id="note-ai-question"
                value={aiQuestion}
                onChange={(event) => setAiQuestion(event.target.value)}
                placeholder="Ask a question based on this note..."
                maxLength={2000}
              />
              <button className="dashboard-primary-button" type="submit" disabled={!content.trim() || !aiQuestion.trim() || Boolean(aiAction) || isSaving}>
                {aiAction === "ask" ? "Thinking…" : "Ask AI"}
              </button>
            </div>
          </form>
          {aiError && <p className="dashboard-form-error" role="alert">{aiError}</p>}
          {aiAction && <p className="dashboard-search-status" role="status">Gemini is working on your note…</p>}
          {aiDraft && (
            <div className="dashboard-note-ai-result">
              <strong>{aiDraft.action === "ask" ? "AI answer" : "Review suggestion"}</strong>
              <p>{Array.isArray(aiDraft.result) ? aiDraft.result.join(", ") : aiDraft.result}</p>
              {aiDraft.action !== "ask" && (
                <button className="dashboard-primary-button" type="button" onClick={applyAiDraft}>Apply suggestion</button>
              )}
            </div>
          )}
        </section>
        <div className="dashboard-editor-fields">
          <div><label htmlFor="note-tags">Tags</label><input id="note-tags" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="ideas, work, inspiration" /><span className="dashboard-field-hint">Separate tags with commas.</span></div>
          <div><label htmlFor="note-collection">Collection</label>
            <select id="note-collection" value={collection} onChange={(event) => setCollection(event.target.value)}>
              <option value="">Unsorted</option>
              {collections.filter((name) => name !== collection).map((name) => <option key={name} value={name}>{name}</option>)}
              {collection && !collections.includes(collection) && <option value={collection}>{collection}</option>}
            </select>
            <input aria-label="Create or rename collection" className="dashboard-new-collection" value={collection} onChange={(event) => setCollection(event.target.value)} placeholder="Or type a collection name" />
          </div>
        </div>
        {error && <p className="dashboard-form-error" role="alert">{error}</p>}
        <div className="dashboard-editor-actions">
          <button className="dashboard-primary-button" type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save note"} <span aria-hidden="true">✓</span></button>
          <button className="dashboard-secondary-button" type="button" onClick={() => navigate("/dashboard/notes")}>Cancel</button>
        </div>
        <p className="dashboard-prototype-note">Notes are securely saved to your NoteFlow AI account.</p>
      </form>
      {existingNote && (
        <NoteHistory
          noteId={existingNote.id}
          onRestored={(item) => {
            setTitle(item.title);
            setContent(item.content);
          }}
        />
      )}
    </div>
  );
}

function SettingsPage({ session, onLogout, logoutError }) {
  const { notes, replaceNotes } = useOutletContext();
  const { user, linkEmailPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkSuccess, setLinkSuccess] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const hasPasswordProvider = user?.providerData?.some(({ providerId }) => providerId === "password");

  function clearNotes() {
    if (window.confirm("Delete all notes saved to this account?")) replaceNotes([]);
  }

  async function handleLogout() {
    await onLogout();
  }

  async function handlePasswordLink(event) {
    event.preventDefault();
    setLinkError("");
    setLinkSuccess("");
    if (password !== confirmPassword) {
      setLinkError("The passwords do not match.");
      return;
    }
    setLinkBusy(true);
    try {
      await linkEmailPassword(password);
      setPassword("");
      setConfirmPassword("");
      setLinkSuccess("Password sign-in is now linked to this account.");
    } catch (error) {
      setLinkError(getFirebaseAuthMessage(error, "link"));
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading"><div><span className="dashboard-eyebrow">YOUR WORKSPACE PREFERENCES</span><h1>Settings</h1></div></div>
      <section className="dashboard-settings-card">
        <span className="dashboard-eyebrow">FIREBASE ACCOUNT</span>
        <h2>Signed in as</h2>
        {session.photoURL && <img className="dashboard-settings-avatar" src={session.photoURL} alt={`${session.displayName || "Google"} profile`} referrerPolicy="no-referrer" />}
        {session.displayName && <p className="dashboard-profile-name">{session.displayName}</p>}
        <p>{session.email}</p>
        <p>Signed in with {session.provider}</p>
        {logoutError && <p className="dashboard-form-error" role="alert">{logoutError}</p>}
        <button className="dashboard-secondary-button" type="button" onClick={handleLogout}>Log out</button>
      </section>
      {user && !hasPasswordProvider && (
        <section className="dashboard-settings-card">
          <span className="dashboard-eyebrow">SIGN-IN METHODS</span>
          <h2>Add email and password sign-in</h2>
          <p>Link a password to {user.email || "this account"} so you can use either Google or email/password without creating a second account.</p>
          <form className="dashboard-editor-form" onSubmit={handlePasswordLink}>
            <label htmlFor="link-password">Password</label>
            <input id="link-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            <label htmlFor="link-password-confirm">Confirm password</label>
            <input id="link-password-confirm" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            {linkError && <p className="dashboard-form-error" role="alert">{linkError}</p>}
            {linkSuccess && <p className="dashboard-search-status" role="status">{linkSuccess}</p>}
            <button className="dashboard-primary-button" type="submit" disabled={linkBusy}>{linkBusy ? "Linking…" : "Add password sign-in"}</button>
          </form>
        </section>
      )}
      <BillingSettings />
      <section className="dashboard-settings-card dashboard-danger-zone">
        <span className="dashboard-eyebrow">LOCAL PROTOTYPE DATA</span>
        <h2>Clear your account notes</h2>
        <p>This removes {notes.length} {notes.length === 1 ? "note" : "notes"} from your NoteFlow AI account.</p>
        <button className="dashboard-danger-button" type="button" onClick={clearNotes}>Delete all notes</button>
      </section>
    </div>
  );
}

export default function DashboardLayout({ session, onLogout, logoutError }) {
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const collections = useMemo(() => getCollections(notes), [notes]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function loadDashboardData() {
      const [healthResult, syncResult, notesResult] = await Promise.allSettled([
        api.health(controller.signal),
        api.auth.sync(),
        api.notes.list(),
      ]);
      if (!active) return;

      if (notesResult.status === "fulfilled") {
        setNotes(notesResult.value);
      } else {
        setStorageError(notesResult.reason instanceof Error ? notesResult.reason.message : "Notes could not be loaded.");
      }

      if (healthResult.status === "rejected" && healthResult.reason?.name !== "AbortError") {
        setStorageError(healthResult.reason instanceof Error ? healthResult.reason.message : "The backend health check failed.");
      } else if (syncResult.status === "rejected") {
        setStorageError(syncResult.reason instanceof Error ? syncResult.reason.message : "Your account could not be synchronized with the API.");
      } else if (notesResult.status === "fulfilled") {
        setStorageError("");
      }
      setNotesLoading(false);
    }

    loadDashboardData();
    return () => {
      active = false;
      controller.abort();
    };
  }, [session.uid]);

  async function saveNote(note) {
    const result = note.id
      ? await api.notes.update(note.id, Object.fromEntries(Object.entries(note).filter(([key]) => key !== "id")))
      : await api.notes.create(note);
    const savedNote = result.item;
    setNotes((current) => [savedNote, ...current.filter((item) => item.id !== savedNote.id)]);
    setStorageError("");
    return savedNote;
  }

  async function toggleFavorite(note) {
    try {
      const { item } = await api.notes.favorite(note.id, !note.favorite);
      setNotes((current) => current.map((itemNote) => itemNote.id === note.id ? item : itemNote));
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Favorite status could not be updated.");
    }
  }

  async function deleteNote(note) {
    if (window.confirm(`Delete “${note.title || "Untitled note"}”?`)) {
      try {
        await api.notes.remove(note.id);
        setNotes((current) => current.filter((item) => item.id !== note.id));
        setStorageError("");
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : "The note could not be deleted.");
      }
    }
  }

  async function archiveNote(note) {
    try {
      await api.notes.archive(note.id, true);
      setNotes((current) => current.filter((item) => item.id !== note.id));
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "The note could not be archived.");
    }
  }

  async function replaceNotes(nextNotes) {
    if (nextNotes.length) {
      setStorageError("Replacing all notes is not supported.");
      return;
    }
    try {
      await api.notes.removeAll();
      setNotes([]);
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Notes could not be deleted.");
    }
  }

  async function searchNotes(query) {
    const result = await api.notes.search(query);
    return result.items;
  }

  async function handleLogout() {
    const success = await onLogout();
    if (success) navigate("/", { replace: true });
  }

  const outletContext = {
    notes,
    saveNote,
    toggleFavorite,
    deleteNote,
    collections,
    replaceNotes,
    archiveNote,
    notesLoading,
    searchNotes,
  };

  return (
    <div className={`dashboard-shell${location.pathname.startsWith("/chat") ? " is-chat" : ""}`}>
      {mobileNavOpen && <button className="dashboard-sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`dashboard-sidebar${mobileNavOpen ? " is-open" : ""}`}>
        <Link className="dashboard-brand" to="/dashboard"><img className="dashboard-brand-logo" src="/favicon.png" alt="" /><span className="dashboard-brand-name">NoteFlow<span>AI</span></span></Link>
        <span className="dashboard-sidebar-label">WORKSPACE</span>
        <nav className="dashboard-sidebar-nav" aria-label="Dashboard navigation">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} title={item.label} aria-label={item.label} onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `dashboard-nav-link${isActive ? " is-active" : ""}`}>
              <span className="dashboard-nav-icon" aria-hidden="true">{item.icon === "chat"
                ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6a7.5 7.5 0 1 1 17-3.5Z" /><path d="M8 11h8M8 14.5h5" /></svg>
                : item.icon}</span>{item.label}
              {item.label === "All Notes" && <span className="dashboard-nav-count">{notes.length}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="dashboard-sidebar-bottom">
          <details className="dashboard-profile-dropdown">
            <summary className="dashboard-account-chip">
              {session.photoURL
                ? <img className="dashboard-account-avatar" src={session.photoURL} alt="" referrerPolicy="no-referrer" />
                : <span className="dashboard-account-avatar">{(session.displayName || session.email || "N").slice(0, 1).toUpperCase()}</span>}
              <div><strong>{session.displayName || session.email?.split("@")[0] || "NoteFlow user"}</strong><span>{session.email}</span></div>
              <span className="dashboard-profile-caret" aria-hidden="true">⌄</span>
            </summary>
            <div className="dashboard-profile-menu">
              <span className="dashboard-profile-provider">{session.provider} account</span>
              <Link to="/dashboard" onClick={() => setMobileNavOpen(false)}>Dashboard</Link>
              <Link to="/dashboard/settings" onClick={() => setMobileNavOpen(false)}>Settings</Link>
              <button type="button" onClick={handleLogout}>Log out</button>
            </div>
          </details>
          {logoutError && <p className="dashboard-form-error" role="alert">{logoutError}</p>}
        </div>
      </aside>

      <div className="dashboard-main-column">
        <header className="dashboard-topbar">
          <button className="dashboard-menu-toggle" type="button" aria-label={mobileNavOpen ? "Close menu" : "Open menu"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? "×" : "☰"}</button>
          <span className="dashboard-topbar-label">{navigation.find((item) => item.to === location.pathname)?.label ?? (location.pathname.includes("/edit") ? "Edit Note" : "Workspace")}</span>
          <Link className="dashboard-topbar-create" to="/dashboard/notes/new" onClick={() => setMobileNavOpen(false)}>＋ <span>New note</span></Link>
        </header>
        <main className="dashboard-main-content">
          {storageError && <p className="dashboard-storage-warning" role="alert">{storageError}</p>}
          {notesLoading && <p className="dashboard-search-status" role="status">Loading your notes…</p>}
          <Outlet context={outletContext} />
          <footer className="dashboard-footer"><span>NoteFlow AI</span><span>Your notes are saved to your account.</span></footer>
        </main>
      </div>
    </div>
  );
}

export {
  CollectionsPage,
  DashboardHome,
  NoteEditorPage,
  NotesPage,
  SearchPage,
  SettingsPage,
  TagsPage,
};
