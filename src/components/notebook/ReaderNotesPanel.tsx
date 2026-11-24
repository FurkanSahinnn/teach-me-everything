"use client";

import { ExternalLink, NotebookPen, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useLocalePick } from "@/i18n/IntlProvider";
import { useNotesByWorkspace } from "@/lib/db/hooks";
import { createNote, updateNote } from "@/lib/db/notes";
import { newId } from "@/lib/utils/id";
import { usePrefs } from "@/stores/prefs";

export function ReaderNotesPanel({ workspaceId, sourceId, sourceTitle }: {
  workspaceId: string;
  sourceId: string;
  sourceTitle: string;
}) {
  const pick = useLocalePick();
  const { toast } = useToast();
  const workspaceNotes = useNotesByWorkspace(workspaceId);
  const notes = workspaceNotes.filter((note) => note.readerSourceId === sourceId);
  const prefs = usePrefs((state) => state.noteEditor);
  const setPrefs = usePrefs((state) => state.setNoteEditorPrefs);
  const pushColor = usePrefs((state) => state.pushNoteEditorRecentColor);
  const [selectedId, setSelectedId] = useState<string>();
  const [freshId, setFreshId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const note = notes.find((item) => item.id === selectedId) ?? notes[0];
  const label = pick("Doküman notu", "Document note");
  const createLabel = pick("Yeni not", "New note");

  async function addNote() {
    if (creating) return;
    const id = newId("note");
    setCreating(true);
    setFreshId(id);
    try {
      const title = pick(`${sourceTitle} notları`, `Notes on ${sourceTitle}`).replace(/\s+/g, " ").trim();
      await createNote({
        id,
        workspaceId,
        readerSourceId: sourceId,
        content: `# ${title}\n\n`,
      });
      setSelectedId(id);
    } catch {
      setFreshId(undefined);
      toast({ title: pick("Not oluşturulamadı", "Could not create note"), variant: "error" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <section aria-label={pick("Doküman notları", "Document notes")} className="flex h-full min-h-0 min-w-0 flex-col">
      {note ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-rule px-3 py-2">
            <select
              className="h-8 min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 text-sm text-ink"
              aria-label={label}
              value={note.id}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setFreshId(undefined);
              }}
            >
              {notes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            <Button size="icon-sm" variant="ghost" aria-label={createLabel} title={createLabel} onClick={addNote} disabled={creating}>
              <Plus className="size-4" aria-hidden />
            </Button>
            <Link
              href={`/w/${workspaceId}/notes?id=${encodeURIComponent(note.id)}`}
              aria-label={pick("Notlar ekranında aç", "Open in Notes")}
              title={pick("Notlar ekranında aç", "Open in Notes")}
              className="grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <ExternalLink className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="min-h-0 flex-1">
            <NoteEditor
              key={note.id}
              initialContent={note.content}
              placeholder={pick("Notunu yaz…", "Write your note…")}
              onChange={(content) => updateNote(note.id, { content })}
              prefs={prefs}
              onPrefsChange={setPrefs}
              onColorUsed={pushColor}
              autoFocus={note.id === freshId}
              compactStatus
              className="[&_.cm-editor_.cm-content]:px-4 [&_.cm-editor_.cm-content]:pt-5"
            />
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <NotebookPen className="size-6 text-ink-3" aria-hidden />
          <p className="text-sm text-ink-3">{pick("Bu dokümana ait henüz not yok.", "No notes for this document yet.")}</p>
          <Button size="sm" onClick={addNote} disabled={creating}>
            <Plus className="size-4" aria-hidden />
            {createLabel}
          </Button>
        </div>
      )}
    </section>
  );
}
