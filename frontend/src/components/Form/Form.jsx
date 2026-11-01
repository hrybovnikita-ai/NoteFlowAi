import { useId, useState } from "react";
import "./Form.css";

export default function Form() {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");

  function saveNote(event) {
    event.preventDefault();
    if (note.trim()) setSavedNote(note.trim());
  }

  return (
    <form className="note-form" onSubmit={saveNote}>
      <label htmlFor={noteId}>Your quick note</label>
      <textarea id={noteId} placeholder="An idea worth keeping..." value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={1000} required />
      <button className="main-button" type="submit" disabled={!note.trim()}>Keep this thought <span aria-hidden="true">&rarr;</span></button>
      <div className="note-form-result" role="status">
        {savedNote && <><strong>Thought captured</strong><p>{savedNote}</p></>}
      </div>
    </form>
  );
}
