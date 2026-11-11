"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, CornerDownLeft, MessageCircle, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { useLocalePick } from "@/i18n/IntlProvider";
import { runBriefChat } from "@/lib/ai/article-brief-chat";
import { countUnmatchedSourceBlocks } from "@/lib/article-analysis/brief";
import type { BriefBlock, BriefSection } from "@/lib/article-analysis/brief";
import type { AnalysisCitation, ArticleAnalysisRecord, BriefChatMessage } from "@/lib/article-analysis/types";
import { appendBriefChat, appendExternalNote, applyBriefRevision, undoBriefRevision } from "@/lib/db/article-analyses";

type Mode = "answer" | "rewrite" | "research";
type Proposal = { section: BriefSection; original: BriefSection };

function createChatMessage(
  role: BriefChatMessage["role"],
  text: string,
  extra: Pick<BriefChatMessage, "sectionId" | "citations" | "externalSources"> = {},
): BriefChatMessage {
  return { id: crypto.randomUUID(), role, text, createdAt: Date.now(), ...extra };
}

function CitationLinks({
  citations,
  onJump,
  pick,
}: {
  citations?: AnalysisCitation[] | undefined;
  onJump: (chunkId: string) => void;
  pick: (tr: string, en: string) => string;
}) {
  if (!citations?.length) return null;
  return <span className="ml-1.5 inline-flex flex-wrap gap-1 align-baseline">
    {citations.map((citation, index) => {
      const usable = citation.verification !== "unverified" && !!citation.chunkId;
      const label = citation.verification === "exact" ? `§${index + 1}` : citation.verification === "fuzzy" ? `≈${index + 1}` : `?${index + 1}`;
      return <button
        key={`${citation.quote}-${index}`}
        type="button"
        disabled={!usable}
        onClick={() => citation.chunkId && onJump(citation.chunkId)}
        title={`${citation.quote} — ${citation.verification === "exact" ? pick("Metinde bulundu; iddiayı desteklediği ayrıca değerlendirilmeli.", "Found in the text; whether it supports the claim still needs judgment.") : citation.verification === "fuzzy" ? pick("Yaklaşık eşleşme", "Approximate match") : pick("Alıntı bulunamadı", "Quote not found")}`}
        className="rounded-full border border-rule-soft bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] text-accent-ink transition-colors hover:bg-accent-wash disabled:cursor-help disabled:text-warn focus-visible:outline-2 focus-visible:outline-accent"
      >{label}</button>;
    })}
  </span>;
}

function BriefBlockView({ block, onJump, pick }: {
  block: BriefBlock;
  onJump: (chunkId: string) => void;
  pick: (tr: string, en: string) => string;
}) {
  return <div className={block.kind === "caution" ? "rounded-xl border-l-[3px] border-warn bg-warn/5 px-4 py-3" : block.kind === "result" ? "border-l-[3px] border-accent bg-paper-2 px-4 py-3" : ""}>
    {block.title ? <h4 className="mb-1 font-medium text-ink">{block.title}</h4> : null}
    <p className="whitespace-pre-line text-[15px] leading-[1.8] text-ink-2">
      {block.text}
      <CitationLinks citations={block.citations} onJump={onJump} pick={pick} />
    </p>
    {block.grounding === "source" && !(block.citations ?? []).some((citation) => citation.verification === "exact" || citation.verification === "fuzzy") ? <p className="mt-1 text-[11px] text-warn">{pick("Kaynak pasajı doğrulanmadı", "Source passage not matched")}</p> : null}
    {block.why ? <p className="mt-1 text-[13px] leading-relaxed text-ink-3"><span className="font-medium">{pick("Neden: ", "Why: ")}</span>{block.why}</p> : null}
    {block.kind === "result" && (block.metric || block.comparison || block.context) ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
      {block.metric ? <span><b className="font-medium text-ink-2">{pick("Ölçüm", "Measure")}:</b> {block.metric}</span> : null}
      {block.comparison ? <span><b className="font-medium text-ink-2">{pick("Karşılaştırma", "Comparison")}:</b> {block.comparison}</span> : null}
      {block.context ? <span><b className="font-medium text-ink-2">{pick("Koşul", "Context")}:</b> {block.context}</span> : null}
    </div> : null}
    {block.grounding !== "source" ? <span className="mt-2 inline-block text-[11px] font-medium uppercase tracking-wide text-ink-4">{block.grounding === "external" ? pick("Dış bağlam", "Outside context") : pick("AI yorumu", "AI interpretation")}</span> : null}
    {block.externalSources?.length ? <div className="mt-2 flex flex-wrap gap-2">{block.externalSources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent-ink underline underline-offset-2">{source.title}</a>)}</div> : null}
  </div>;
}

export function ArticleBriefView({ analysis }: { analysis: ArticleAnalysisRecord }) {
  const brief = analysis.brief;
  const pick = useLocalePick();
  const router = useRouter();
  const articleRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | undefined>();
  const [mode, setMode] = useState<Mode>("answer");
  const [question, setQuestion] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number }>();
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localMessages, setLocalMessages] = useState<BriefChatMessage[]>([]);
  const generating = analysis.status === "generating";

  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);
  useEffect(() => {
    if (!chatOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setChatOpen(false); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [chatOpen]);

  if (!brief) return null;
  const unmatched = countUnmatchedSourceBlocks(brief);
  const lowDetail = analysis.fallbackReason?.includes("insufficient detail") ?? false;
  const onlyUnmatched = /^\d+ source claim\(s\) have no matching passage$/.test(analysis.fallbackReason ?? "");
  const onJump = (chunkId: string) => router.push(`/w/${analysis.workspaceId}/read/${analysis.sourceId}?chunk=${encodeURIComponent(chunkId)}`);
  const messages = [...(analysis.briefChat ?? []), ...localMessages.filter((local) => !analysis.briefChat?.some((saved) => saved.id === local.id))];
  const activeSection = brief.sections.find((section) => section.id === activeSectionId);

  function openChat(sectionId?: string, nextMode: Mode = "answer", selection = "", prefill = "") {
    setActiveSectionId(sectionId);
    setMode(nextMode);
    setSelectedText(selection);
    if (prefill) setQuestion(prefill);
    setSelectionPosition(undefined);
    setChatOpen(true);
    setProposal(undefined);
  }

  function captureSelection() {
    if (generating) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim().slice(0, 600) ?? "";
    if (!text || !selection?.anchorNode || !articleRef.current?.contains(selection.anchorNode)) {
      setSelectionPosition(undefined);
      return;
    }
    const node = selection.anchorNode.parentElement?.closest<HTMLElement>("[data-brief-section]");
    setSelectedText(text);
    setActiveSectionId(node?.dataset.briefSection);
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSelectionPosition({ x: Math.max(12, Math.min(rect.left, window.innerWidth - 390)), y: Math.max(12, rect.top - 56) });
  }

  async function submit() {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    setProposal(undefined);
    const userMessage = createChatMessage("user", trimmed, activeSectionId ? { sectionId: activeSectionId } : {});
    setLocalMessages((current) => [...current, userMessage]);
    setQuestion("");
    try {
      await appendBriefChat(analysis.id, userMessage);
      const result = await runBriefChat({
        analysis: { ...analysis, briefChat: messages },
        question: trimmed, mode,
        ...(activeSectionId ? { sectionId: activeSectionId } : {}),
        ...(selectedText ? { selectedText } : {}),
      });
      if (result.kind === "rewrite") {
        const original = analysis.brief?.sections.find((section) => section.id === result.section.id);
        if (original) setProposal({ section: result.section, original });
      } else {
        const message = createChatMessage("assistant", result.text, {
          ...(activeSectionId ? { sectionId: activeSectionId } : {}),
          citations: result.citations,
          ...(result.externalSources ? { externalSources: result.externalSources } : {}),
        });
        setLocalMessages((current) => [...current, message]);
        await appendBriefChat(analysis.id, message);
      }
      setSelectedText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pick("İstek başarısız oldu.", "Request failed."));
    } finally {
      setBusy(false);
    }
  }

  async function acceptProposal() {
    if (!proposal || busy) return;
    setBusy(true);
    setError("");
    try {
      await applyBriefRevision(analysis.id, proposal.section);
      setProposal(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pick("Değişiklik kaydedilemedi.", "Could not save the revision."));
    } finally {
      setBusy(false);
    }
  }

  return <div className={chatOpen ? "grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(300px,370px)]" : "mx-auto max-w-[860px]"}>
    <article ref={articleRef} onMouseUp={captureSelection} onKeyUp={captureSelection} className="min-w-0 rounded-[18px] border border-rule-soft bg-paper px-5 py-8 shadow-sm sm:px-9 sm:py-10 lg:px-12">
      {analysis.status === "draft" && lowDetail ? <div className="mb-6 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">{pick("Bu analiz hâlâ beklenenden kısa kaldı. Daha ayrıntılı bir okuma dosyası için yeniden üretmeyi dene.", "This analysis is still too brief. Try regenerating it for a more complete reading guide.")}</div> : null}
      {analysis.status === "draft" && !lowDetail && !onlyUnmatched ? <div className="mb-6 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">{pick("Kısmi analiz: bazı bölümler veya kaynak bağlantıları doğrulanamadı.", "Partial analysis: some sections or source links could not be verified.")}</div> : null}
      {unmatched > 0 ? <div className="mb-6 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-warn">{pick(`${unmatched} kaynak iddiasının alıntısı metinde bulunamadı; bu ifadeleri makaleyle karşılaştır.`, `${unmatched} source claim(s) lack a matching passage; compare these statements with the paper.`)}</div> : null}
      <div className="mb-7 flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">
        <BookOpen className="h-4 w-4" aria-hidden />
        <span>{pick("Makale okuma dosyası", "Article reading brief")}</span>
        <span aria-hidden>·</span><span>{brief.paperType}</span>
        {brief.field ? <><span aria-hidden>·</span><span>{brief.field}</span></> : null}
      </div>
      <div data-brief-section="thesis" className="article-brief-enter border-b border-rule-soft pb-8">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-accent-ink">{pick("Temel fikir", "The central idea")}</p>
        <h2 className="max-w-[68ch] font-serif text-[23px] leading-[1.45] text-ink sm:text-[29px]">{brief.thesis.text}<CitationLinks citations={brief.thesis.citations} onJump={onJump} pick={pick} /></h2>
      </div>
      {brief.coverage.omittedChunks > 0 ? <p className="mt-5 text-[11px] leading-relaxed text-ink-4">{pick(`Kaynağın ${brief.coverage.omittedChunks} parçası ana okuma penceresine sığmadı; bölüm özetleriyle işlendi.`, `${brief.coverage.omittedChunks} source chunks were outside the main reading window and processed through section summaries.`)}</p> : null}
      <nav aria-label={pick("Bölümler", "Sections")} className="mt-7 flex flex-wrap gap-x-4 gap-y-2 border-b border-rule-soft pb-5">
        {brief.sections.map((section, index) => <a key={section.id} href={`#brief-${section.id}`} className="text-[12px] text-ink-3 underline-offset-4 transition-colors hover:text-accent-ink hover:underline"><span className="mr-1 font-mono text-ink-4">0{index + 1}</span>{section.title}</a>)}
      </nav>
      {brief.sections.map((section, index) => <section key={section.id} id={`brief-${section.id}`} data-brief-section={section.id} style={{ animationDelay: `${Math.min(index + 1, 6) * 65}ms` }} className="article-brief-enter scroll-mt-6 border-b border-rule-soft py-9 last:border-0">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div><p className="mb-2 font-mono text-[11px] text-ink-4">0{index + 1} / {brief.sections.length}</p><h3 className="font-serif text-[22px] leading-tight text-ink sm:text-[25px]">{section.title}</h3></div>
          {!generating ? <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => openChat(section.id)} className="rounded-full border border-rule-soft px-2.5 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"><MessageCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden />{pick("Bu bölümü sor", "Ask about this section")}</button>
            <button type="button" onClick={() => openChat(section.id, "rewrite")} className="rounded-full border border-rule-soft px-2.5 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"><Sparkles className="mr-1 inline h-3.5 w-3.5" aria-hidden />{pick("Düzenle", "Revise")}</button>
            <button type="button" onClick={() => openChat(section.id, "research")} className="rounded-full border border-rule-soft px-2.5 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"><Search className="mr-1 inline h-3.5 w-3.5" aria-hidden />{pick("Araştır", "Research")}</button>
            {analysis.briefRevisions?.some((revision) => revision.sectionId === section.id) ? <button type="button" onClick={() => void undoBriefRevision(analysis.id, section.id).catch((cause: unknown) => setError(String(cause)))} className="rounded-full border border-rule-soft px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-accent-ink"><RotateCcw className="mr-1 inline h-3.5 w-3.5" aria-hidden />{pick("Geri al", "Undo")}</button> : null}
          </div> : null}
        </header>
        <div className="space-y-5">{section.blocks.map((block) => <BriefBlockView key={block.id} block={block} onJump={onJump} pick={pick} />)}</div>
      </section>)}
      <p className="mt-5 text-[11px] leading-relaxed text-ink-4">{pick("Kaynak işaretleri metin eşleşmesini gösterir; yorumun doğruluğunu tek başına kanıtlamaz.", "Source markers show a text match; they do not by themselves prove the interpretation.")}</p>
    </article>

    {!generating && selectionPosition ? <div style={{ left: selectionPosition.x, top: selectionPosition.y }} className="fixed z-40 flex max-w-[calc(100vw-24px)] flex-wrap gap-1 rounded-xl border border-rule-soft bg-paper p-1 shadow-lg">
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openChat(activeSectionId, "answer", selectedText)} className="rounded-full px-3 py-1.5 text-[11px] text-ink hover:bg-paper-2">{pick("Seçimi sor", "Ask selection")}</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openChat(activeSectionId === "thesis" ? undefined : activeSectionId, activeSectionId === "thesis" ? "answer" : "rewrite", selectedText)} className="rounded-full px-3 py-1.5 text-[11px] text-ink hover:bg-paper-2">{pick("Derinleştir", "Deepen")}</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openChat(activeSectionId === "thesis" ? undefined : activeSectionId, activeSectionId === "thesis" ? "answer" : "rewrite", selectedText, pick("Seçili kısmı daha basit, sezgisel bir örnekle anlat.", "Explain the selected text more simply with an intuitive example."))} className="rounded-full px-3 py-1.5 text-[11px] text-ink hover:bg-paper-2">{pick("Basitleştir", "Simplify")}</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => openChat(activeSectionId === "thesis" ? undefined : activeSectionId, "research", selectedText, pick("Seçili iddia/yöntem için dış kaynaklarda ek bağlam ara.", "Find outside context for the selected claim or method."))} className="rounded-full px-3 py-1.5 text-[11px] text-ink hover:bg-paper-2">{pick("Web'de ara", "Search web")}</button>
    </div> : null}

    {!generating && !chatOpen ? <button type="button" onClick={() => openChat()} className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-[12px] font-medium text-white shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><MessageCircle className="h-4 w-4" aria-hidden />{pick("Analize soru sor", "Ask about the analysis")}</button> : null}
    {chatOpen ? <>
      <button type="button" aria-label={pick("Sohbeti kapat", "Close assistant")} onClick={() => setChatOpen(false)} className="fixed inset-0 z-40 bg-black/35 lg:hidden" />
      <aside aria-label={pick("Analiz asistanı", "Analysis assistant")} className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col border-l border-rule-soft bg-paper shadow-xl lg:sticky lg:top-5 lg:z-auto lg:h-[min(780px,calc(100vh-180px))] lg:min-h-[360px] lg:rounded-[18px] lg:border lg:shadow-sm">
        <header className="flex items-center justify-between border-b border-rule-soft px-4 py-3">
          <div><p className="font-serif text-[17px] text-ink">{pick("Okuma asistanı", "Reading assistant")}</p><p className="text-[11px] text-ink-4">{activeSection ? activeSection.title : pick("Tüm makale", "Whole paper")}</p></div>
          <button type="button" aria-label={pick("Sohbeti kapat", "Close assistant")} onClick={() => setChatOpen(false)} className="rounded-lg p-2 text-ink-3 hover:bg-paper-2"><X className="h-4 w-4" aria-hidden /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
          {messages.length === 0 ? <div className="rounded-xl bg-paper-2 p-4 text-[13px] leading-relaxed text-ink-3">{pick("Anlamadığın bir noktayı sor veya bir bölümü daha açık yazdır.", "Ask about a difficult point or revise a section to make it clearer.")}</div> : null}
          {messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-7 rounded-xl bg-accent-wash px-3 py-2.5 text-[13px] leading-relaxed text-ink" : "mr-5 border-l-2 border-accent px-3 py-1 text-[13px] leading-relaxed text-ink-2"}>
            <p className="whitespace-pre-wrap">{message.text}</p>
            {message.role === "assistant" ? <CitationLinks citations={message.citations} onJump={onJump} pick={pick} /> : null}
            {message.externalSources?.length ? <div className="mt-2 space-y-1"><p className="text-[11px] text-ink-4">{pick("Dış arama sonuçları · tam metin doğrulaması yapılmadı", "External search results · full texts not verified")}</p>{message.externalSources.filter((source) => /^https?:\/\//i.test(source.url)).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[11px] text-accent-ink underline">{source.title}</a>)}<button type="button" onClick={() => void appendExternalNote(analysis.id, message.text, message.externalSources ?? [], message.sectionId).catch((cause: unknown) => setError(String(cause)))} className="mt-1 rounded-lg border border-rule-soft px-2 py-1 text-[11px] text-accent-ink">{pick("Analize dış bağlam olarak ekle", "Add as outside context")}</button></div> : null}
          </div>)}
          {busy ? <p className="animate-pulse text-[12px] text-ink-4">{pick("Kaynaklar inceleniyor…", "Reading sources…")}</p> : null}
          {proposal ? <div className="rounded-xl border border-accent-soft bg-accent-wash/40 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-accent-ink">{pick("Önerilen değişiklik", "Proposed revision")}</p>
            <p className="mb-2 text-[11px] text-ink-4">{pick("Önce", "Before")}: {proposal.original.blocks.map((block) => block.text).join(" ")}</p>
            <div className="space-y-2 border-t border-accent-soft pt-2">{proposal.section.blocks.map((block) => <BriefBlockView key={block.id} block={block} onJump={onJump} pick={pick} />)}</div>
            <div className="mt-3 flex gap-2"><button type="button" onClick={() => void acceptProposal()} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] text-white"><Check className="mr-1 inline h-3 w-3" aria-hidden />{pick("Metne uygula", "Apply to brief")}</button><button type="button" onClick={() => setProposal(undefined)} className="rounded-lg px-3 py-1.5 text-[11px] text-ink-3">{pick("Vazgeç", "Discard")}</button></div>
          </div> : null}
          {error ? <p role="alert" className="rounded-lg bg-err/10 px-3 py-2 text-[12px] text-err">{error}</p> : null}
        </div>
        <div className="border-t border-rule-soft p-3">
          <div className="mb-2 flex gap-1" role="group" aria-label={pick("Asistan eylemi", "Assistant action")}>{(["answer", "rewrite", "research"] as const).map((value) => <button key={value} type="button" onClick={() => setMode(value)} disabled={value === "rewrite" && !activeSection} className={`rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${mode === value ? "bg-accent-wash text-accent-ink" : "text-ink-4 hover:bg-paper-2"}`}>{value === "answer" ? pick("Sor", "Ask") : value === "rewrite" ? pick("Bölümü düzenle", "Revise section") : <><Search className="mr-1 inline h-3 w-3" aria-hidden />{pick("Web araştır", "Research")}</>}</button>)}</div>
          {selectedText ? <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-paper-2 px-2 py-1.5 text-[11px] text-ink-3"><span className="truncate">“{selectedText}”</span><button type="button" aria-label={pick("Seçimi kaldır", "Clear selection")} onClick={() => setSelectedText("")}><X className="h-3 w-3" /></button></div> : null}
          <label htmlFor="brief-chat-input" className="sr-only">{pick("Soru veya talimat", "Question or instruction")}</label>
          <textarea id="brief-chat-input" ref={inputRef} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} rows={3} placeholder={mode === "rewrite" ? pick("Bu bölümü nasıl değiştireyim?", "How should I revise this section?") : mode === "research" ? pick("Neyi dış kaynaklarda araştırayım?", "What should I research beyond this paper?") : pick("Makaleyle ilgili neyi merak ediyorsun?", "What would you like to ask about the paper?")} className="w-full resize-none rounded-xl border border-rule-soft bg-paper-2 p-3 text-[13px] text-ink outline-none focus:border-accent" />
          <div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-ink-4">{pick("Enter gönder · Shift+Enter yeni satır", "Enter to send · Shift+Enter for a new line")}</span><button type="button" disabled={!question.trim() || busy} onClick={() => void submit()} aria-label={pick("Gönder", "Send")} className="grid h-8 w-8 place-items-center rounded-full bg-accent text-white disabled:opacity-40"><CornerDownLeft className="h-4 w-4" aria-hidden /></button></div>
        </div>
      </aside>
    </> : null}
  </div>;
}
