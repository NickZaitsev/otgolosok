import { useState } from "react";
import { StorySources, StoryText } from "./story-content";
import type { RouteNote } from "./types";

export function RouteNotes({ notes }: { notes: RouteNote[] }) {
  if (notes.length === 0) return null;

  return <section className="route-notes" id="along-the-way" aria-labelledby="route-notes-title">
    <header className="route-notes-heading">
      <p className="kicker">Улицы и соседние дома</p>
      <h2 id="route-notes-title">По дороге</h2>
      <p>Короткие заметки, каждая до минуты. Выберите, о чём прочитать.</p>
    </header>
    <div className="route-notes-list">
      {notes.map((note) => <Note key={note.id} note={note} />)}
    </div>
  </section>;
}

function Note({ note }: { note: RouteNote }) {
  const [showSources, setShowSources] = useState(false);

  return <details className="route-note">
    <summary>
      <span className="route-note-place">{note.place}</span>
      <span className="route-note-title">{note.story.opening}</span>
      <span className="route-note-duration">Читать · около {note.story.duration_sec} сек <span aria-hidden="true" className="route-note-arrow">↓</span></span>
    </summary>
    <div className="route-note-body">
      <StoryText story={note.story} />
      <p className="source-note">Запись аудио готовится.</p>
      <StorySources content={note} open={showSources} onToggle={() => setShowSources((value) => !value)} />
    </div>
  </details>;
}
