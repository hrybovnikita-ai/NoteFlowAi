import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useAuth } from "../auth/useAuth";
import { api } from "../api/client";
import { filterConversations, readSelectedConversation, saveSelectedConversation } from "./chatState";
import "./Chat.css";
import "highlight.js/styles/github-dark.css";

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const [copyUnavailable, setCopyUnavailable] = useState(false);
  const code = Array.isArray(children) ? children[0] : children;
  const text = typeof code?.props?.children === "string" ? code.props.children : "";
  const language = code?.props?.className?.replace("language-", "") || "code";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyUnavailable(false);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyUnavailable(true);
      window.setTimeout(() => setCopyUnavailable(false), 2500);
    }
  }

  return (
    <div className="chat-code-block">
      <div className="chat-code-toolbar"><span>{language}</span><button type="button" onClick={copyCode} aria-live="polite">{copied ? "Copied" : copyUnavailable ? "Copy unavailable" : "Copy"}</button></div>
      <pre>{children}</pre>
    </div>
  );
}

function MessageContent({ content }) {
  const components = useMemo(() => ({ pre: ({ children }) => <CodeBlock>{children}</CodeBlock> }), []);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>{content}</ReactMarkdown>;
}

function formatConversationDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function friendlyError(error) {
  if (error?.name === "AbortError") return "";
  if (error?.code === "AI_DAILY_LIMIT") return "Your daily AI message limit has been reached. It resets at 00:00 UTC.";
  if (error?.status === 429 || error?.code === "GEMINI_QUOTA_EXCEEDED") return "The chat is busy right now. Please wait a moment and try again.";
  if (error?.status === 503 && error?.code === "CHAT_SERVICE_NOT_CONFIGURED") return "AI chat is not configured on the server yet. Please contact your administrator.";
  return error instanceof Error ? error.message : "The response could not be generated. Please try again.";
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export default function ChatPage() {
  const { user } = useAuth();
  const uid = user?.uid || "";
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState("");
  const [clock, setClock] = useState(null);
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const controllerRef = useRef(null);
  const selectedRef = useRef("");
  const loadSequenceRef = useRef(0);
  const skipMessageFetchRef = useRef(false);
  const endRef = useRef(null);
  const lastResetFetchedRef = useRef("");

  const loadUsage = useCallback(async () => {
    const result = await api.ai.usage();
    setUsage(result.usage);
    setUsageError("");
  }, []);

  const loadConversations = useCallback(async () => {
    const result = await api.chat.conversations();
    setConversations(result.items);
    return result.items;
  }, []);

  useEffect(() => {
    let active = true;
    api.chat.conversations()
      .then(({ items }) => {
        if (active) {
          setConversations(items);
          const savedId = readSelectedConversation(uid);
          const selected = items.find(item => item.id === savedId)?.id || items[0]?.id || "";
          saveSelectedConversation(uid, selected);
          if (selected) {
            setLoadingMessages(true);
            setSelectedId(selected);
          }
        }
      })
      .catch(loadError => {
        if (active) setError(friendlyError(loadError));
      })
      .finally(() => {
        if (active) setLoadingConversations(false);
      });
    return () => { active = false; controllerRef.current?.abort(); };
  }, [uid]);

  useEffect(() => {
    let active = true;
    const requestTimer = window.setTimeout(() => loadUsage().catch(loadError => {
      if (active) setUsageError(friendlyError(loadError));
    }), 0);
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      active = false;
      window.clearTimeout(requestTimer);
      window.clearInterval(timer);
    };
  }, [loadUsage]);

  useEffect(() => {
    if (!usage || clock === null || clock < new Date(usage.resetAt).getTime() || lastResetFetchedRef.current === usage.resetAt) return undefined;
    lastResetFetchedRef.current = usage.resetAt;
    const timer = window.setTimeout(() => loadUsage().catch(loadError => setUsageError(friendlyError(loadError))), 0);
    return () => window.clearTimeout(timer);
  }, [clock, loadUsage, usage]);

  useEffect(() => {
    selectedRef.current = selectedId;
    const sequence = ++loadSequenceRef.current;
    if (!selectedId) return undefined;
    if (skipMessageFetchRef.current) {
      skipMessageFetchRef.current = false;
      return undefined;
    }
    api.chat.messages(selectedId)
      .then(result => {
        if (loadSequenceRef.current === sequence) setMessages(result.items);
      })
      .catch(loadError => {
        if (loadSequenceRef.current === sequence) setError(friendlyError(loadError));
      })
      .finally(() => {
        if (loadSequenceRef.current === sequence) setLoadingMessages(false);
      });
    return undefined;
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: sending ? "smooth" : "auto", block: "end" });
  }, [messages, sending]);

  async function createConversation() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSending(false);
    setError("");
    try {
      const { item } = await api.chat.createConversation();
      setConversations(current => [item, ...current]);
      saveSelectedConversation(uid, item.id);
      skipMessageFetchRef.current = true;
      selectedRef.current = item.id;
      setSelectedId(item.id);
      setMessages([]);
      setLoadingMessages(false);
      setHistoryOpen(true);
    } catch (createError) {
      setError(friendlyError(createError));
    }
  }

  async function selectConversation(id) {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      setSending(false);
    }
    setSelectedId(id);
    saveSelectedConversation(uid, id);
    setMessages([]);
    setLoadingMessages(true);
    setError("");
    setHistoryOpen(false);
  }

  async function deleteConversation(conversation) {
    if (!window.confirm(`Delete "${conversation.title}" and its messages? This cannot be undone.`)) return;
    try {
      if (selectedId === conversation.id) {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setSending(false);
      }
      await api.chat.remove(conversation.id);
      const remaining = conversations.filter(item => item.id !== conversation.id);
      setConversations(remaining);
      if (selectedId === conversation.id) {
        const nextId = remaining[0]?.id || "";
        setSelectedId(nextId);
        saveSelectedConversation(uid, nextId);
        setMessages([]);
        setLoadingMessages(Boolean(remaining.length));
      }
      setError("");
    } catch (deleteError) {
      setError(friendlyError(deleteError));
    }
  }

  async function saveRename(event) {
    event.preventDefault();
    const title = renameDraft.trim();
    if (!title || !renamingId) return;
    try {
      const { item } = await api.chat.rename(renamingId, title);
      setConversations(current => current.map(conversation => conversation.id === item.id ? item : conversation));
      setRenamingId("");
      setError("");
    } catch (renameError) {
      setError(friendlyError(renameError));
    }
  }

  async function runTurn({ text, regenerate = false, turnId = crypto.randomUUID() }) {
    if (sending) return;
    setError("");
    let conversationId = selectedId;
    if (!conversationId) {
      try {
        const { item } = await api.chat.createConversation();
        conversationId = item.id;
        saveSelectedConversation(uid, item.id);
        skipMessageFetchRef.current = true;
        selectedRef.current = item.id;
        setSelectedId(item.id);
        setConversations(current => [item, ...current]);
      } catch (createError) {
        setError(friendlyError(createError));
        return;
      }
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setSending(true);
    if (regenerate) {
      setMessages(current => current.map(message => message.id === `${turnId}-assistant`
        ? { ...message, content: "", status: "streaming" }
        : message));
    } else {
      setMessages(current => [
        ...current,
        { id: `${turnId}-user`, turnId, role: "user", content: text, status: "complete", createdAt: new Date().toISOString() },
        { id: `${turnId}-assistant`, turnId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString() },
      ]);
    }
    if (!regenerate) setDraft("");

    try {
      const assistant = await api.chat.stream({
        conversationId,
        turnId,
        message: text,
        regenerate,
        signal: controller.signal,
        onEvent(event, payload) {
          if (event === "delta" && selectedRef.current === conversationId) {
            setMessages(current => current.map(message => message.id === `${turnId}-assistant`
              ? { ...message, content: message.content + payload.text }
              : message));
          }
        },
      });
      if (assistant && selectedRef.current === conversationId) {
        setMessages(current => current.map(message => message.id === assistant.id ? assistant : message));
      }
      await loadConversations();
    } catch (turnError) {
      if (selectedRef.current === conversationId) {
        setMessages(current => current.map(message => message.id === `${turnId}-assistant`
          ? { ...message, status: "failed" }
          : message));
      }
      const message = friendlyError(turnError);
      if (message) setError(message);
      loadConversations().catch(loadError => setError(friendlyError(loadError)));
    } finally {
      try {
        await loadUsage();
      } catch (loadError) {
        setUsageError(friendlyError(loadError));
      }
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setSending(false);
      }
    }
  }

  function submitMessage(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    runTurn({ text });
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function stopGeneration() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMessages(current => current.map(message => message.status === "streaming"
      ? { ...message, status: "stopping" }
      : message));
    setSending(false);
  }

  const lastAssistant = [...messages].reverse().find(message => message.role === "assistant" && message.status !== "streaming");
  const lastConversation = conversations.find(conversation => conversation.id === selectedId);
  const visibleConversations = useMemo(() => filterConversations(conversations, historyQuery), [conversations, historyQuery]);
  const atLimit = usage ? usage.remaining <= 0 : false;
  const usagePercent = usage ? Math.min(100, (usage.used / usage.limit) * 100) : 0;
  const resetCountdown = usage ? clock === null ? "…" : formatCountdown(new Date(usage.resetAt).getTime() - clock) : "";
  const planLabel = usage?.plan === "pro" ? "Pro" : usage?.plan === "plus" ? "Plus" : "Free";

  return (
    <section className={`chat-page${historyOpen ? "" : " is-history-collapsed"}`} aria-label="AI chat">
      {historyOpen && <button className="chat-history-backdrop" type="button" aria-label="Close chat history" onClick={() => setHistoryOpen(false)} />}
      <aside className={`chat-history${historyOpen ? " is-open" : ""}`} aria-label="Chat history">
        <div className="chat-history-heading"><div><span className="chat-eyebrow">YOUR WORKSPACE</span><h2>Conversations</h2></div><button className="chat-icon-button chat-history-close" type="button" onClick={() => setHistoryOpen(false)} aria-label="Close chat history">×</button></div>
        <button className="chat-new-button" type="button" onClick={createConversation} disabled={loadingConversations}><span aria-hidden="true">＋</span> New chat</button>
        <label className="chat-search-field">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        </label>
        <div className="chat-history-list" aria-live="polite">
          {loadingConversations && <p className="chat-subtle-message">Loading your chats…</p>}
          {!loadingConversations && conversations.length === 0 && <p className="chat-subtle-message">Your conversations will appear here.</p>}
          {!loadingConversations && conversations.length > 0 && visibleConversations.length === 0 && <p className="chat-subtle-message">No conversations match that search.</p>}
          {visibleConversations.map(conversation => (
            <div className={`chat-history-item${conversation.id === selectedId ? " is-selected" : ""}`} key={conversation.id}>
              {renamingId === conversation.id ? (
                <form className="chat-rename-form" onSubmit={saveRename}>
                  <input aria-label="Conversation title" value={renameDraft} maxLength={80} onChange={event => setRenameDraft(event.target.value)} autoFocus />
                  <button type="submit" aria-label="Save title">✓</button>
                  <button type="button" aria-label="Cancel rename" onClick={() => setRenamingId("")}>×</button>
                </form>
              ) : (
                <>
                  <button className="chat-history-select" type="button" onClick={() => selectConversation(conversation.id)} aria-current={conversation.id === selectedId ? "page" : undefined}>
                    <span className="chat-history-title">{conversation.title || "New chat"}</span><time>{formatConversationDate(conversation.updatedAt)}</time>
                  </button>
                  <div className="chat-history-actions">
                    <button className="chat-icon-button" type="button" aria-label={`Rename ${conversation.title || "conversation"}`} onClick={() => { setRenamingId(conversation.id); setRenameDraft(conversation.title || ""); }}>✎</button>
                    <button className="chat-icon-button chat-delete-button" type="button" aria-label={`Delete ${conversation.title || "conversation"}`} onClick={() => deleteConversation(conversation)}>×</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <p className="chat-privacy-note"><span aria-hidden="true">◆</span> Your conversations are private to your account.</p>
      </aside>

      <div className="chat-conversation">
        <header className="chat-header">
          <button className="chat-icon-button chat-history-toggle" type="button" aria-label="Toggle chat history" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}>☰</button>
          <div className="chat-header-copy"><span className="chat-eyebrow">NOTEFLOW AI</span><h1>{lastConversation?.title || "AI Chat"}</h1></div>
          <span className="chat-model-badge"><span /> Gemini</span>
        </header>
        <section className={`chat-usage${atLimit ? " is-exhausted" : ""}`} aria-label="Daily AI usage">
          <div className="chat-usage-heading">
            <span>{usage ? `${usage.remaining} of ${usage.limit} AI messages left today · ${planLabel}` : usageError || "Loading your daily AI allowance…"}</span>
            {usage && <span>Resets in {resetCountdown}</span>}
          </div>
          {usageError && usage && <span className="chat-usage-warning" role="status">{usageError}</span>}
          {usage && <div
            className="chat-usage-track"
            role="progressbar"
            aria-label="Daily AI messages used"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={usage.used}
          ><span style={{ width: `${usagePercent}%` }} /></div>}
          {atLimit && <div className="chat-usage-warning" role="status">
            Daily limit reached. Your allowance resets in {resetCountdown}.
            {usage.plan === "free" && <> <a href="/pricing">Explore Plus and Pro</a>.</>}
          </div>}
        </section>

        <div className="chat-message-scroll" aria-live="polite">
          {loadingMessages && <p className="chat-subtle-message chat-loading-messages">Restoring this conversation…</p>}
          {!loadingConversations && !loadingMessages && messages.length === 0 && (
            <div className="chat-welcome">
              <span className="chat-welcome-mark" aria-hidden="true">✦</span>
              <span className="chat-eyebrow">A CLEARER WAY TO THINK</span>
              <h2>What would you like to explore?</h2>
              <p>Ask a question, work through an idea, or get help turning a thought into a plan.</p>
              <div className="chat-suggestions">
                {["Help me organize my thoughts", "Explain a complex topic simply", "Turn an idea into an action plan"].map(suggestion => (
                  <button type="button" key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}<span aria-hidden="true">↗</span></button>
                ))}
              </div>
            </div>
          )}
          <div className="chat-message-list">
            {messages.map(message => (
              <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                <span className={`chat-message-avatar chat-avatar-${message.role}`} aria-hidden="true">{message.role === "user" ? "Y" : "✦"}</span>
                <div className="chat-message-body">
                  <span className="chat-message-author">{message.role === "user" ? "You" : "NoteFlow AI"}</span>
                  <div className="chat-bubble-content">
                    {message.content
                      ? message.role === "assistant" ? <MessageContent content={message.content} /> : <p>{message.content}</p>
                      : message.status === "streaming" ? <span className="chat-typing-indicator" aria-label="AI is responding"><i /><i /><i /></span>
                        : ["failed", "stopping"].includes(message.status) ? <p className="chat-stopped-message">{message.status === "stopping" ? "Stopping response…" : "Response stopped. You can try again."}</p> : null}
                  </div>
                  {message.role === "assistant" && message === lastAssistant && ["complete", "failed"].includes(message.status) && !sending && (
                    <button className="chat-regenerate-button" type="button" onClick={() => runTurn({ regenerate: true, turnId: message.turnId })}>↻ Regenerate response</button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <div ref={endRef} />
        </div>

        {error && <div className="chat-error-banner" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
        <form className="chat-composer" onSubmit={submitMessage}>
          <label className="chat-composer-label" htmlFor="chat-message-input">Message NoteFlow AI</label>
          <textarea id="chat-message-input" value={draft} maxLength={12000} onChange={event => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={atLimit ? "Daily message limit reached" : "Message NoteFlow AI…"} rows={1} disabled={loadingConversations || loadingMessages || atLimit} />
          <div className="chat-composer-footer">
            <span>Enter to send · Shift + Enter for a new line</span>
            {sending
              ? <button className="chat-send-button chat-stop-button" type="button" onClick={stopGeneration}><span aria-hidden="true">■</span> Stop</button>
              : <button className="chat-send-button" type="submit" disabled={!draft.trim() || loadingConversations || loadingMessages || atLimit}><span aria-hidden="true">↑</span> Send</button>}
          </div>
        </form>
        <p className="chat-disclaimer">AI can make mistakes. Check important information.</p>
      </div>
    </section>
  );
}
