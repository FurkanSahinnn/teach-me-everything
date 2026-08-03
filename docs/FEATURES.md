# Features — Sayfa Bazlı Özellik Kataloğu

> Her sayfanın amacı, UI bileşenleri, veri modelleri, etkileşimleri ve AI bağlantı noktaları. Next.js karşılıklarının implementasyonu için **tek başvuru belgesi**.

---

## 0. Shared Shell (`shared/shell.js` → `components/shell/`)

**Amaç:** Tüm uygulamada sabit — sol kenar çubuğu + üst arama bar + sağ alt "Tweaks" FAB.

**React'e dönüşüm:**
```
components/shell/
├── AppShell.tsx          # Grid layout (248px sidebar + topbar + main)
├── Sidebar.tsx           # Workspace switcher + NAV + RECENT
├── Topbar.tsx            # Search + lang toggle + Ask AI + New
├── TweaksPanel.tsx       # Theme, accent, font, density, sidebar pos
├── Brand.tsx             # Logo
└── WorkspaceSwitcher.tsx # Dropdown
```

**Önemli:**
- Theme/density `<html>` üzerinde data-* attr (shell.js'deki pattern korunur)
- Accent değiştirince CSS var `--accent` update — Tailwind JIT ile uyumlu
- `⌘K` global search kısayolu — `cmdk` kütüphanesi

---

## 1. `/` — Landing (`landing.html`)

### Amaç
Proje pazarlama sayfası. Açık kaynak, yerel çalışır vurgusu.

### UI Bölümleri
| # | Bölüm | Notlar |
|---|-------|--------|
| 1 | Nav (sticky) | Brand, Özellikler, Nasıl çalışır, Stack, Docs, GitHub, Denemek için çalıştır, Uygulamaya gir |
| 2 | Hero | Eyebrow "Açık kaynak · MIT · Yerel olarak çalışır", büyük italik serif başlık, kurşun metin, CTA buttons |
| 3 | Terminal mockup | `git clone`, `npm install`, `npm run dev` — stilize |
| 4 | Meta row | "4× hızlı", "11 kaynak formatı", "%100 yerel" |
| 5 | Features grid (3×3) | 9 özellik kartı |
| 6 | Showcase "Oku, seç, sor" | Mock reader + selection popover |
| 7 | How (4 step) | Klonla, kur, anahtar, başla |
| 8 | Stack (4×3) | Teknoloji listesi |
| 9 | Footer | GitHub / Discord / Docs / Kur |

### Etkileşim
- Smooth scroll to `#features`, `#how`, `#stack`
- Hero'da video/loop demo (gelecekte)

### AI
- Yok.

### Komponenler
- `components/landing/*` — Hero, FeatureGrid, ShowcaseMock, StackList

---

## 2. `/dashboard` — Dashboard (`dashboard.html`)

### Amaç
Kullanıcı ana paneli: streak, bugün, workspace listesi, son aktivite.

### UI Bölümleri
| # | Bölüm | Data |
|---|-------|------|
| 1 | Hello header | Tarih, kişisel selam, bugün özeti, "Yeni workspace" |
| 2 | Stat row (4) | Çalışma serisi (17 gün + 30 günlük heatmap), Bugün tekrar (4/28, SM-2 durumu), Bu hafta (6s24d, goal bar), Aktif workspace |
| 3 | Workspaces grid (2×2 + new) | Her kart: swatch, başlık, açıklama, progress bar, meta (kaynak/highlight + son güncelleme) |
| 4 | Öğrenme ipuçları (3) | Aktif recall, Feynman, Aralıklı tekrar açıklamaları |
| 5 | Bugün panel (right) | 4 planned session kartı + "Tüm planı gör" |
| 6 | Son aktivite (right) | 6 aktivite kayıt — ikon + text + timestamp |

### Veri Modelleri
```ts
type DashboardData = {
  streak: { days: number; heatmap: Array<0|1|2> /* 30 */ };
  todayReview: { done: number; total: number; delayed: number };
  weekStudy: { hoursDone: number; hoursGoal: number };
  activeWorkspaces: Array<Workspace & {
    progress: number;
    sourceCount: number;
    highlightCount: number;
    lastUpdated: ISO8601;
  }>;
  todayPlan: PlannedSession[];
  recentActivity: Array<{
    type: 'read' | 'highlight' | 'flashcard' | 'audio' | 'quiz' | 'source';
    text: string;
    workspaceId: string;
    timestamp: ISO8601;
  }>;
};
```

### Etkileşim
- Workspace kartı click → `/w/[id]`
- "Tüm yol haritasını gör" → `/w/[id]/roadmap` *(eski `/w/[id]/plan` Phase 13'te kaldırıldı)*
- "Hızlı not" → modal (`QuickNoteDialog`)

### AI
- "Bugün 4 tekrar kartın bekliyor ve X özetin yarı yolda" — Haiku ile dinamik özet. Gerekli değil, template yeterli.

### Komponenler
- `components/dashboard/{StatRow,WorkspaceCard,ActivityList,TodayCard,TipGrid}.tsx`

---

## 3. `/w/[id]` — Workspace (`workspace.html`)

### Amaç
Tek workspace'in detay görünümü: kaynaklar + mod seçici + konseptler.

### UI Bölümleri
| # | Bölüm | Detay |
|---|-------|-------|
| 1 | Header | Başlık + 4 stat (sources, highlights, cards, quiz sessions) + actions |
| 2 | Mod selector (6) | Notebook, Flashcards, Quiz, Mind Map, Podcast, Feynman — her biri preview |
| 3 | Sources list (left) | Drop zone + tipler (PDF/ARX/URL/YT/MD/IMG) + read% + highlight sayısı |
| 4 | Stats (right) | Haftalık chart, en çok highlight edilen kaynaklar |
| 5 | Concepts (right) | Chip cloud — tıklanınca mind map'e zıplar |
| 6 | Recent Q&A (right) | Son 5 soru — tıklanınca notebook'a |

### Veri
```ts
type WorkspaceDetail = Workspace & {
  stats: {
    sources: number;
    highlights: number;
    flashcards: number;
    quizSessions: number;
  };
  sources: Source[];
  concepts: Array<{
    id: string;
    label: string;
    weight: number;   // 1..10
  }>;
  recentQuestions: Array<{
    id: string;
    question: string;
    sourceRef: { sourceId: string; page?: number };
    timestamp: ISO8601;
  }>;
};
```

### Etkileşim
- **Drag & drop** dosya yükleme → `/api/ingest/*`
- Source click → `/w/[id]/read/[sourceId]`
- Mode card click → ilgili route
- Concept click → `/w/[id]/map?focus=[conceptId]`

### AI
- Kaynak yüklendiğinde **otomatik özet** (Haiku)
- Kaynaktan **otomatik konsept çıkarımı** (Sonnet)
- İlk parse sırasında **embedding** (OpenAI / Voyage)

### Komponenler
- `components/workspace/{Hero,StatTiles,ModeSelector,SourceList,ConceptCloud,RecentQA}.tsx`
- `components/workspace/DropZone.tsx`

---

## 4. `/w/[id]/read/[sourceId]` — Notebook (`notebook.html`)

### Amaç
Kaynak okurken yan tarafta Claude ile soru-cevap yapma. **Ana öğrenme döngüsü.**

### UI Bölümleri
- **Sol sidebar:** Kaynak railı (sayfa + bölüm navi)
- **Ortada Reader:** Prose (serif 17px), highlights, margin notes, selection popover
- **Sağ sidebar:** Chat thread + input

### Selection Popover
```
┌─────────────────────────────┐
│ [Highlight] [Ask] [Note] [+Card] │
└─────────────────────────────┘
```

### Chat Mesajı
```ts
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  contextSources: Array<{ sourceId: string; page?: number; chunkIds: string[] }>;
  citations: Array<{ sourceId: string; page?: number; quote: string }>;
  toolUses?: ToolUse[];
  createdAt: ISO8601;
};

type ContentBlock = { type: 'text'; text: string } | { type: 'thinking'; text: string };

type ToolUse = {
  name: 'add_flashcard' | 'open_citation' | 'simplify';
  input: Record<string, unknown>;
  result?: unknown;
};
```

### Etkileşim
- Metin seç → 200ms debounced popover
- "Ask" → chat'e context prefill
- Citation chip click → prose içinde scroll + highlight flash
- "+Card" tool use → onay modal → Dexie insert + Dashboard refresh
- `⌘J` → Ask AI odaklan

### AI
- **System prompt:** "Sen akademik bir tutorsun. Yalnızca verilen kaynak chunk'larından yanıtla. Emin değilsen söyle."
- **Cache:** Aktif kaynak chunk'ları (full source) ephemeral cache
- **Retrieval:** Seçilen metin → embedding → k=8 ilgili chunk → context
- **Streaming:** Tamamen stream; **thinking** Opus'ta açık

### Komponenler
- `components/reader/{Prose,Highlight,MarginNote,SelectionPopover}.tsx`
- `components/chat/{Thread,Message,Input,CiteChip,ToolUseRenderer}.tsx`

---

## 5. `/w/[id]/cards` — Flashcards (`flashcards.html`)

### Amaç
SRS oturumu. **SM-2 algoritması** ile kart tekrar.

### UI Bölümleri
- **Header:** Oturum progress (12/28), recall %, kalan süre
- **3D Card Stack:** Aktif kart önde; 2 soluk kart arkada
- **Card:** Soru (serif 24px) → (kullanıcı flip) → Cevap + kaynak citation + difficulty tag
- **Rating bar:** Again (`1`), Hard (`2`), Good (`3`), Easy (`4`)
- **Distribution histogram:** Oturumun reyting dağılımı
- **Deck list:** Tüm deck'ler + bugün sayısı

### Veri
Bkz. `PROJECT_INDEX.md` → `Flashcard` + `ReviewRecord`.

### SM-2 State Transitions
```
Rating 1 (Again):  reps=0, interval=0 (10dk içinde tekrar), ef -= 0.20 (min 1.3)
Rating 2 (Hard):   reps+=1, interval = interval * 1.2, ef -= 0.15
Rating 3 (Good):   reps+=1, interval = interval * ef, ef ±0
Rating 4 (Easy):   reps+=1, interval = interval * ef * 1.3, ef += 0.15
```

### Etkileşim
- `space` → flip
- `1|2|3|4` → rate
- `u` → undo last rating
- Oturum bitince summary modal (yarın tekrar: 8 kart ...)

### AI
- **Kart üretimi** (background): Notebook sohbetlerinden Sonnet ile öneri; onay modal
- **Hint generation** (opsiyonel): Zorlanılan kart için Haiku kısa ipucu

### Komponenler
- `components/flashcards/{FlashcardEditModal,FlashcardProposalModal,GenerateBatchModal,LeechBadge}.tsx`
- `components/srs/IntervalHistogram.tsx`
- Review akışı (DeckCard / ReviewSession / CardStage / RatingButton / SessionDistribution / SessionSummary) şu an `app/w/[id]/cards/page.tsx` içinde private — bkz. CLAUDE.md "File placement conventions" (~600 satır eşiği; çıkarılması bekleyen teknik borç)
- `lib/srs/sm2.ts` — pure function

---

## 6. `/w/[id]/quiz` — Quiz + Feynman (`quiz.html`)

### Amaç
Aktif recall quiz'i. Üç tip: MCQ, açık uçlu, Feynman (sesli anlatım).

### UI Bölümleri
- **Header:** Progress (6/10), accuracy, breakdown (MCQ/open/feynman)
- **MCQ:** Soru + 4 seçenek (A-D radio) → submit → correct highlight + explanation
- **Açık uçlu:** Textarea → submit → Claude değerlendirmesi
- **Feynman:**
  - Microphone record button + waveform
  - Transcript live (Whisper) — gaps kırmızı, hedges turuncu, strengths yeşil
  - Coach feedback panel

### Veri
```ts
type QuizSession = {
  id: string;
  workspaceId: string;
  questions: QuizQuestion[];
  responses: QuizResponse[];
  startedAt: ISO8601;
  completedAt?: ISO8601;
};

type QuizResponse = {
  questionId: string;
  userAnswer: string;
  correct: boolean;
  timeSpentSec: number;
  feynmanTranscript?: string;
  coachFeedback?: Array<{
    type: 'gap' | 'hedge' | 'strength';
    text: string;
    startMs: number;
    fixSuggestion?: string;
  }>;
};
```

### Etkileşim
- MCQ submit → instant feedback
- "Karta dönüştür" → flashcard ekle
- Mic permission prompt → record → Whisper → live transcript
- Coach analyzes each sentence as it arrives

### AI
- **Soru üretimi** (Sonnet, JSON schema output)
- **Açık uçlu değerlendirme** (Sonnet + kaynak context)
- **STT** Whisper API (stream or chunked)
- **Feynman coach** (Sonnet, fine-grained)

### Komponenler
- `components/quiz/{Session,MCQBlock,OpenInput,FeynmanPane,CoachPanel,Waveform}.tsx`

---

## 7. `/w/[id]/map` — Mind Map (`mindmap.html`)

### Amaç
Konseptler arası bilgi grafiği. Obsidian'dan ilham.

### UI Bölümleri
- **Canvas:** Force-directed graph (zoom/pan + minimap)
- **Nodes:** hub (merkez, büyük), primary (l1), secondary (l2), workspace bridges (dashed)
- **Inspector (right):** Seçili konsept — açıklama, bağlantı sayısı, kaynak alıntıları, user notes, cross-workspace link'ler
- **Toolbar:** Filters (Workspace / All / Sources), auto-layout, add node

### Veri
```ts
type MindMap = {
  workspaceId: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  layout: 'force' | 'hierarchical';
};

type Backlink = {
  nodeId: string;
  sourceRef: { sourceId: string; page?: number };
  quote: string;
};
```

### Etkileşim
- Node drag → position persist
- Node click → inspector update
- Edge hover → strength tooltip
- Filter toggle → nodes show/hide
- Add concept → Claude suggests edges

### AI
- **Konsept çıkarım** (Sonnet, batch)
- **İlişki önerisi** (embedding cosine + Sonnet reranking)

### Teknoloji
- **d3-force** ya da **reagraph** (React optimized)
- Canvas renderer (WebGL için `sigma.js`)

### Komponenler
- `components/concepts/{MindMapCanvas,ConceptInspector}.tsx` (klasör domain'e göre adlandırılır — `mindmap/` değil; `lib/concepts/` ile eşleşir)
- `lib/concepts/layout.ts` — force-sim, pure

---

## 8. `/w/[id]/audio/[id]` — Podcast (`podcast.html`)

### Amaç
NotebookLM tarzı 30-60 dk **iki sunuculu** ses özeti.

### UI Bölümleri
- **Cover:** Başlık (§X.Y), description, iki host avatar (isim, rol)
- **Player:** Timeline + chapter markers + waveform + speed selector
- **Chapter selector:** Tıklanabilir timestamps
- **Transcript:** Live highlight, bilingual toggle
- **Sidebar:** Key concepts + source refs + auto flashcards

### Veri
Bkz. `PROJECT_INDEX.md` → `Podcast` + `TranscriptLine`.

### Etkileşim
- Play/pause, ±15s jump, speed 0.75-1.5x
- Chapter click → seek
- Transcript search
- Waveform drag to seek

### AI
- **Senaryo üretimi** (Opus): Kaynak chunks → JSON dialog `[{speaker:'A',text:'...'},...]`
- **TTS** (local-first Piper default): İki farklı speaker için installed voice picker; ağır provider'lar Phase 12 POC
- **Mix:** WebAudio API ile silence buffer (250ms)
- **Transcript**: Zaten senaryoda var, zamanlama TTS'ten

### Komponenler
- `components/podcast/{Cover,Player,Timeline,ChapterList,Transcript,ConceptChips}.tsx`

---

## 9. `/w/[id]/research` — Research (`research.html`)

### Amaç
Akademik literatür taraması: arXiv + Semantic Scholar + Firecrawl.

### UI Bölümleri
- **Arama + filtreler:** kaynak, yıl aralığı, citation>N, open access
- **Tabs:** Results / Comparison / Thesis map / Saved / BibTeX
- **Result cards:** Title, authors, abstract, tags, relevance %, actions (Add notebook, Summarize, Compare, BibTeX)
- **Comparison matrix:** 4 makale × 4 metric (methodology, sample eff., main claim, limitations)
- **AI insight box:** Claude cross-paper analizi

### Veri
```ts
type Paper = {
  id: string;
  title: string;
  authors: string[];
  year: number;
  venue?: string;
  arxivId?: string;
  doi?: string;
  abstract: string;
  fullText?: string;
  tags: string[];
  citationsCount: number;
  relevanceScore?: number;  // computed
};

type Comparison = {
  paperIds: string[];
  metrics: Array<{
    name: string;
    values: Array<{ paperId: string; value: string; agreement: 'agree' | 'disagree' | 'neutral' }>;
  }>;
  insight: string;
};
```

### Etkileşim
- Multi-select papers → comparison auto-update
- Filter pill remove
- Tag click → add filter
- BibTeX copy

### AI
- **Query reformulation** (Haiku): kullanıcı sorgusunu arXiv API'sine uygun yap
- **Relevance scoring** (embedding cosine vs workspace concepts)
- **Cross-paper analysis** (Opus + full abstracts)
- **Auto-tagging** (Sonnet): method tags çıkar

### External
- arXiv: `http://export.arxiv.org/api/query`
- Semantic Scholar: `https://api.semanticscholar.org/`
- Firecrawl: `https://api.firecrawl.dev/`

### Komponenler
- `components/research/{SearchBar,FilterPills,ResultCard,ComparisonMatrix,InsightBox,BibtexExport}.tsx`

---

## 10. `/w/[id]/roadmap` — Roadmap (Phase 13) ✅ 2026-05-25

> ⚠️ Bu bölüm eskiden `/w/[id]/plan` — Study Plan idi. **Plan özelliği Phase 13'te
> tamamen kaldırıldı** (haftalık takvim + `.ics` dışa aktarma + hatırlatıcı hattı;
> `planBlocks` tablosu Dexie **v28**'de düşürüldü, `components/plan/*` silindi).
> Yerini ön koşul-DAG tabanlı Roadmap aldı. Detay: `ROADMAP_FEATURE_SPEC.md`.

### Amaç
AI'ın yazdığı ön koşul DAG'ı — "önce şunu, sonra bunu" omurgası.

### UI Bölümleri
- **Liste sayfası** (`/roadmap`): workspace başına birden çok roadmap, `RoadmapCard` + boş durum
- **Graf sayfası** (`/roadmap/[roadmapId]`): `RoadmapCanvas` — deterministik katmanlı
  top-down yerleşim (longest-path layering + barycenter kesişim azaltma), viewBox
  pan/zoom + fit butonu
- **`NodeInspector`:** düğümü öğrenme döngüsüne bağlar — *Bu konuyu çalış (not)*,
  *İlgili kaynaklar*, *Flashcard üret*, *Ders üret*

### Veri
`roadmaps` / `roadmapNodes` / `roadmapEdges` (Dexie **v27**). Alt düğümler **derinlik 2** ile sınırlı.
Düğüm başına opsiyonel `noteId` / `deckId` bağlantısı.

### Etkileşim
- 3 adımlı `RoadmapWizardModal` — Günlük/Haftalık/Aylık düğüm bütçesi (4-6 / 8-12 / 16-24)
- Düğüm tamamlanma: manuel toggle **veya** bağlı deck tamamen öğrenildiyse otomatik
- Döngü tespiti — DAG garanti edilir

### AI
- **Roadmap üretimi** — `lib/ai/roadmap-gen.ts` + `prompts/roadmap-gen.ts`, kullanıcı model seçer
  (Sonnet varsayılan · Haiku / Opus opsiyonel)

### Komponenler
- `components/roadmap/{RoadmapWizardModal,RoadmapCanvas,NodeInspector,RoadmapCard,RoadmapEmptyState}.tsx`

---

## 10.1 `/w/[id]/chat` — Workspace Chat (✅ 2026-06-18)

### Amaç
Çalışma alanının tamamında gezen AI eğitmen. Reader içindeki tek-kaynak sohbetinden **ayrıdır**
(o dokunulmadı).

### UI Bölümleri
- **`WorkspaceChatPanel`** — çok kaynaklı RAG sohbeti
- **`ContextBar`** — kullanıcı tarafından açılıp kapanan bağlam çipleri:
  📄 Kaynaklar (varsayılan açık) · 📝 Notlar · 🧠 Kavramlar · 🗺️ Roadmap · 🎯 Performans · 🌐 Web

### Veri
`chatThreads` / `chatMessages` yeniden kullanılır (opsiyonel `scope` / `contextScopes`; **migration yok**).

### AI
- `lib/ai/runners/workspace-chat-runner.ts` (`useWorkspaceChat`) + `prompts/workspace-chat.ts`
- Bağlam blokları token bütçeli: `lib/ai/context/{notes,concepts,roadmap,performance,budget}`
- **Hibrit topraklama** — önce kaynak + atıf; genel bilgi ayrıca işaretlenir

### Komponenler
- `components/notebook/{WorkspaceChatPanel,ContextBar}.tsx` · `ChatBubble` + `CitationChip` yeniden kullanılır

---

## 10.2 `/w/[id]/analysis` — Makale Analizi (✅ 2026-06-30)

### Amaç
Tek bir PDF makalenin **doktora seviyesi çok aşamalı AI analizi** — ana dili farklı bir okur
zor bir makaleyi hızla kavrasın.

### UI Bölümleri
- **Liste** (`/analysis`): `AnalysisCard` + `AnalysisEmptyState`
- **Detay** (`/analysis/[analysisId]`): `AnalysisDetailView` — 3 katlanabilir derinlik katmanı
  (Yönelim / Anlama / Eleştiri) + her zaman iki dilli TR/EN sözlük
- **Topraklama ayrımı:** `[S]` kaynaktan birebir alıntı (`CitationChip`) · `[G]` genel bilgi olarak işaretli

### Veri
`articleAnalyses` (Dexie **v29**, payload JSON blob). Backup **V10**.

### AI
Elle yazılmış çok-ajanlı hat (LangGraph/LangChain **değil**):
`listChunksBySource` (tüm doküman, `topKChunks` RAG değil) → **Map** (bölüm özeti + alıntı, paralel)
→ **Reduce** (anlama katmanı) → **uzman dağılımı** (hakem-persona eleştiri ‖ iki dilli sözlük ‖ yansıma,
`Promise.allSettled`) → **Sentez** (yönelim). Bozuk aşama → `status:'draft'` + `fallbackReason`.
Settings'te 3 aşama bazlı model bağlama: `analysisExtract` · `analysisSynthesize` · `analysisCritique`.

### Etkileşim
- Üretim modalı **sürükle-bırak PDF yükleme** (Sources seçici değil) + ön maliyet tahmini +
  canlı aşama ilerlemesi + iptal edilebilir
- **PDF dışa aktarma:** temalı A4 HTML → gizli iframe ile tarayıcı yazdırma (vektörel/seçilebilir metin)

### Komponenler
- `components/article-analysis/{AnalysisGenerateModal,AnalysisDetailView,AnalysisCard,AnalysisEmptyState}.tsx`

---

## 11. `/settings` — Settings (`settings.html`)

### Amaç
API anahtarları, modeller, tercihler, veri.

### Bölümler
1. **API & Models** — Anthropic / OpenAI-compatible / Gemini / local providers, Claude Code OAuth, research providers. Model seçici (Opus/Sonnet/Haiku + dynamic provider models).
2. **Preferences** — Lang, theme, density, font.
3. **Learning behavior** — Auto flashcards, SRS algorithm, daily new limit, context expansion, Feynman strictness.
4. **Data** — Storage gauge, backup/restore, export.
5. **Danger zone** — Reset progress, delete all.

> **Not:** Privacy/telemetry bölümü bilinçli olarak kaldırıldı. TME open source + local-first bir üründür; telemetri, istatistik veya analytics **hiçbir türde** toplanmaz.

### Etkileşim
- "Test" button her provider için → `/api/ai/test/[provider]`
- Anahtar kaydetme: Tauri → OS keychain · web (dev-only) → Dexie plaintext.
  *(Master password prompt Phase 9'da kaldırıldı.)*
- Export: JSON + SQLite dump (opsiyonel)
- Restore: file upload

### Komponenler
- `components/settings/{SectionCard,ApiKeyField,ProviderCard,StorageGauge,DangerZone}.tsx`
- `lib/crypto/api-keys.ts`

---

## 12. `/setup/[step]` — Onboarding (`setup.html`)

### Amaç
İlk çalıştırmada 4 adımlı kurulum.

### Adımlar
1. **Hoşgeldin** — Marka, lisans, yerel çalışma vaadi, "Başla"
2. **API Keys** — (`setup.html` mevcut) Anthropic + opsiyoneller + vector DB + scraper
3. **Workspace örnekleri** — Hazır template (QFT, Biyoloji, Fenomenoloji, ML) seç veya boş
4. **Hazır** — Tura çıkış + dashboard'a git

### Etkileşim
- Step indicator
- "Skip" her step'te (sadece keys required)
- Her step state localStorage'da tutulur

### Komponenler
- `components/setup/{Wizard,Step1Welcome,Step2Keys,Step3Workspaces,Step4Done,Stepper}.tsx`

---

## 13. Eksik Sayfalar / Akışlar

`MISSING.md`'de daha detaylı, özetle:
- Source düzenleme / silme / yeniden adlandırma
- Flashcard düzenleme modali
- Workspace ayarları (hedef, renk)
- Import/Export akışı
- Paylaşım / readonly public link
- Error sayfaları (404, 500)
- Empty states (ilk açılış, kaynaksız workspace)
- Loading / skeleton state'ler
- Mobile breakpoint'ler

---

## 14. Icon & Asset Envanteri

Mevcut iconlar (`shell.js` içinde inline SVG):
`home, grid, book, cards, quiz, map, audio, lib, cal, cog, plus, search, chev, spark, users, feyn, flag, lang, dot, pin, filter`

→ Next.js'de `lucide-react` veya **self-hosted SVG components** olarak taşınmalı. Aynı stroke-width (1.5) ve 24×24 viewBox korunmalı.

---

## 15. Ekran Yakalaması Referans Tablosu

| Sayfa | HTML | Satır aralıkları ilgi çekici bölümler |
|-------|------|---------------------------------------|
| Landing | `landing.html` | 175-200 hero, 203-221 features, 255-266 how |
| Dashboard | `dashboard.html` | 79-196 tüm render |
| Workspace | `workspace.html` | tüm |
| Notebook | `notebook.html` | reader+chat split |
| Flashcards | `flashcards.html` | card stack + rating |
| Quiz | `quiz.html` | MCQ + feynman pane |
| Mindmap | `mindmap.html` | canvas + inspector |
| Podcast | `podcast.html` | player + transcript |
| Research | `research.html` | matrix + insight |
| Plan | `plan.html` | week grid + curriculum |
| Settings | `settings.html` | bölüm bölüm |
| Setup | `setup.html` | step 2 şablonu |

---

## 16. Notes-as-Source (Phase 6.9) ✅ 2026-05-16

### Amaç
Kullanıcının yazdığı markdown notları (Phase 6 vault) RAG/chat retrieval katmanına bağlamak — bir notu "Embed as source" olarak işaretleyince mevcut PDF/URL/YouTube source'larla aynı pipeline'a girer ama editörde düzenlenebilir kalmaya devam eder. Notlar artık hem **yazılabilir hem de aranabilir/cite edilebilir**.

### Kullanıcı akışı
1. `/w/[id]/notes` → not editörünü aç.
2. Sağ üst toolbar'da `✨ Embed as source` butonu (Sparkles). Hover'da `~$0.02 (456 token)` cost preview.
3. Tıkla → spinner (`data-state="embedding"`) → başarı toast'ı → buton `✓ Embedded` rozetine döner (`data-state="synced"`).
4. Notu düzenle → autosave + 300ms hash debounce → buton kehribar `⚠ Sync embedding` (`data-state="dirty"`).
5. Tıkla → chunk-level diff sadece değişen chunk'ları re-embed eder (content-hash-cache) → `synced`.
6. Cog ▾ menüsünden **Auto-sync on save** toggle açılırsa yazma durdurulduktan ~5sn sonra otomatik tetiklenir (cost cap `prefs.costPrefs.autoEmbedCap` = $0.10 aşılırsa silently skip + toast).

### 5-state buton makinesi
| state | icon | label | renk | hover tooltip |
|-------|------|-------|------|----------------|
| `idle` | Sparkles | Embed as source | accent | cost preview |
| `synced` | Check | Embedded | emerald | "Last synced N min ago" |
| `dirty` | AlertCircle | Sync embedding | amber | "~N changed tokens" |
| `embedding` | Loader2 spinner | Embedding… | accent (disabled) | — |
| `error` | RotateCcw | Retry | red | error message |

### Note-source nerelerde görünür
- **Sources page (`/w/[id]/page.tsx`)** — Row'da `NotebookPen` inline icon + emerald "nottan" / "from note" pill (`data-testid="source-from-note-badge"`). Click → `/w/[id]/notes?id={noteId}` (`buildSourceClickHref` helper).
- **Chat citations** — `<CitationChip tone="note">` emerald NotebookPen variant; tıkla → `jumpToChunk` reader page'de note chunk'larını PDF reader yerine `/notes` route'una yönlendirir.
- **NoteTree sidebar** — Embedded notların solunda emerald `Sparkles` dot (`data-testid="tree-embedded-dot-{id}"`); tooltip "Kaynak olarak gömüldü" / "Embedded as source". Tek `useNoteSourcesByWorkspace` hook'u workspace başına bir live-query, per-row değil (perf).
- **Cmd+K FTS** — Note chunks `chunks` tablosunda zaten indeksli olduğu için bedavaya gelir.

### Veri modeli (Dexie v23)
- `SourceRecord += { type: "note", noteId: string, lastEmbeddedContentHash?: string, lastEmbeddedAt?: number }`
- `NoteRecord += { autoEmbedOnSave?: boolean }` (default `false`)
- `db/sources.ts` += `createNoteSource / getNoteSourceByNoteId / markNoteSourceDirty / markNoteSourceSynced`
- Delete cascade: `deleteNote(id)` önce `getNoteSourceByNoteId → deleteSource(linkedSource.id)` (chunks/highlights/messages dahil 10 tabloyu temizler), sonra `db.notes.delete(id)`. Sequential (Dexie nested-txn yasak) — orphan window iz `getNoteSourceByNoteId === undefined` ile bir sonraki embed click'inde self-heal eder.

### Embed pipeline (`src/lib/notes/embed-as-source.ts`)
`embedNoteAsSource(noteId, embedder)`:
1. Note + linked source resolve-or-create.
2. **Hash short-circuit:** `lastEmbeddedContentHash === currentHash` ise hiç chunker'a girmeden `{reused: true}` döner.
3. `chunkPages({pages: [{page: 1, text: content}]})` (PDF chunker content-agnostic).
4. **Per-chunk text-equality cache:** mevcut chunk'lar `Map<text, embedding>`, eşleşen chunk için provider çağrılmaz.
5. Atomic `db.transaction("rw", chunks, sources)` — chunk replace + `markNoteSourceSynced`.
6. Sonuç: `{sourceId, chunkCount, embedsRun, tokensUsed, costUsd, reused}`.

### Embedder factory (`src/lib/notes/embedder-factory.ts`)
`resolveEmbedderFromPrefs()` → `prefs.modelBindings.embedPresetId` (`openai-3-small` fallback) → `presetToProviderId` → `getEmbedProvider(...)` → vault unlock + `getApiKey` (local presets vault'u atlar) → `EmbedderHandle { embed, providerId, model, pricePerMillionTokensUsd }`. React-hooks free → setTimeout callback'lerinde de çağrılabilir.

### Test coverage
- **Vitest 1283 / 133 files** (Phase 6.9.1–6.9.8 boyunca +69 yeni test): data layer + embed orchestrator + sync helper + button state matrix + factory + Sources routing + Citation chip variant + tree embedded hook.
- **Playwright 22 E2E** (6.9.9 +2):
  - `notes-as-source-create.e2e.ts` — yeni not oluştur → embed butonuna tıkla → `data-state="synced"` + Dexie source row + chunks.
  - `notes-as-source-sync.e2e.ts` — pre-embedded not → düzenle → `data-state="dirty"` → tıkla → `data-state="synced"` + `lastEmbeddedContentHash` + `lastEmbeddedAt` advance.
  - Her ikisi de `installAiMocks` ile `/api/ai/embed`'i deterministik vektörlerle karşılar; `window.__tmeEditorView` test-affordance ile CM6 contentEditable race'lerini bypass eder.

### Phase 7 köprüsü
6.9 kasıtlı olarak Phase 7 (Tauri/PWA + filesystem `.md` export) öncesi bridge olarak inşa edildi. `SourceRecord.noteId` source-of-truth olarak kalır; Phase 7 ona ek `notePath` computed field koyar ve wikilink resolver'ı id-lookup → path-lookup swap eder. Embed state desktop swap'tan sağ çıkar.
