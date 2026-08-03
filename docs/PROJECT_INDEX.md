# Teach Me Everything — Project Index

> **UI durumu:** UI v2 baseline (3 tema, mobile-first shell) çalışıyor; tüm sayfalar Dexie hook'larına bağlı. Settings'te EmbedSection + ReembedModal + per-görev ModelRow (sağlayıcı bazlı dinamik model listesi, OpenRouter + özel model ID dahil).
> **Lisans:** MIT (açık kaynak, yerel çalışır — BYOK)
> **Versiyon:** v1.0.0-rc13 · Phase 0–13 ✅ · Dexie **v29** · prefs **v24** · Backup **V10** · Vitest 195 test dosyası + 17 Playwright spec · `npm run typecheck` 0 hata

---

## 1. Projenin Amacı

**Teach Me Everything (TME)**, NotebookLM'in ötesine geçen, aktif öğrenmeye odaklanmış açık kaynaklı bir çalışma alanıdır. Notlarınızı, PDF'lerinizi ve akademik makalelerinizi şunlara dönüştürür:

- **Aktif recall alıştırmaları** (flashcard + SM-2 / FSRS)
- **Aralıklı tekrar** planlaması
- **Aktif recall quizleri** (çoktan seçmeli + açık uçlu + Feynman)
- **Zihin haritaları** ve backlink tabanlı bilgi grafiği
- **İki sunuculu podcast** özetleri
- **Akademik araştırma** (arXiv/DOI tarama + kaynak karşılaştırma)
- **Otomatik müfredat** ve çalışma planlaması

**Temel felsefe:**
- Yerel-öncelikli — tüm veri kullanıcının makinesinde
- BYOK (Bring Your Own Key) — API anahtarları kullanıcıda
- Açık kaynak, hackable, Tauri/Electron ya da tarayıcı dostu

---

## 2. Mevcut Dosya Yapısı

```
teach-me-everything/
├── docs/                       # + CODEMAPS/ (architecture, backend, frontend, data, dependencies)
│   ├── PROJECT_INDEX.md        # Bu dosya
│   ├── ARCHITECTURE.md         # Next.js mimari planı
│   ├── FEATURES.md             # Sayfa bazlı özellik kataloğu
│   ├── DESIGN_SYSTEM.md        # Tasarım token ↔ Tailwind mapping
│   ├── MISSING.md              # Eksiklikler punch list
│   ├── ROADMAP.md              # Faz bazlı yol haritası
│   └── *_SPEC.md               # ARTICLE_ANALYSIS / ROADMAP_FEATURE / WORKSPACE_CHAT
├── src-tauri/                  # Rust kabuk: keychain.rs, sysinfo.rs, tts.rs, lib.rs
├── src/
│   ├── app/                    # App Router
│   │   ├── page.tsx            # Landing
│   │   ├── dashboard/page.tsx · workspaces/page.tsx
│   │   ├── w/[id]/             # read · chat · analysis · roadmap · study · cards
│   │   │                       #   quiz · map · notes · audio · research
│   │   ├── settings/page.tsx
│   │   ├── setup/[step]/page.tsx
│   │   ├── api/ai/              # chat · chat-oauth · chat-responses · embed · test · research
│   │   └── not-found.tsx · error.tsx · layout.tsx
│   ├── components/             # 22 grup, ~105 bileşen (ui, shell, notebook, notes,
│   │                           #   article-analysis, roadmap, settings, …)
│   ├── lib/
│   │   ├── ai/                 # providers/ · prompts/ · runners/ · context/ · web-search/
│   │   ├── db/                 # schema.ts (v29), types.ts, 20 repo, hooks.ts (55 hook)
│   │   ├── notes/ · vault/     # CM6 notlar + iki yönlü .md dosya senkronu
│   │   ├── article-analysis/ · roadmap/ · study/ · quiz/ · srs/ · concepts/
│   │   ├── ingest/ · research/ · podcast/ · backup/ · markdown/ · storage/
│   │   └── utils/              # cn.ts, id.ts (ULID-benzeri), route-params.ts
│   ├── stores/                 # prefs.ts (v24), selection.ts, vault.ts (Phase 9 stub)
│   ├── hooks/                  # useApiKeyManager, useProviderChatModels, useSystemCheck
│   └── i18n/                   # messages.ts, IntlProvider.tsx
├── tests/e2e/                  # Playwright (17 spec)
├── CLAUDE.md                   # Claude Code rehberi
└── next.config.ts · tsconfig.json · eslint.config.mjs · postcss.config.mjs · vitest.config.ts
```

---

## 3. Sayfa Envanteri

Tüm prototip HTML sayfaları React'a port edildi (Phase 1–6). Mevcut canlı rotalar:

| Route (Next.js) | Durum |
|---|---|
| `/` | Landing |
| `/dashboard` | Kontrol paneli (workspace cap 4 + Tümünü gör) |
| `/workspaces` | Tüm çalışma alanları (Phase 8 follow-up) |
| `/w/[id]` | Workspace özet |
| `/w/[id]/notes` | Notlar (CM6 + wikilinks + backlinks) |
| `/w/[id]/read/[sourceId]` | Reader + chat |
| `/w/[id]/cards` | Flashcards (SM-2 + leech) |
| `/w/[id]/quiz` | Quiz (MCQ + open + Feynman) |
| `/w/[id]/map` | Mind map |
| `/w/[id]/audio/[podcastId]` | Podcast (local-first Piper TTS; heavier providers deferred to Phase 12) |
| `/w/[id]/research` | Araştırma (Firecrawl/Exa/Tavily/Jina) |
| `/w/[id]/study` + `/study/[lessonId]` + `/study/journal` | Guided Study |
| `/w/[id]/chat` | Workspace sohbeti (çok kaynaklı RAG + bağlam çipleri) |
| `/w/[id]/analysis` + `/analysis/[analysisId]` | Makale analizi (çok aşamalı AI) |
| `/w/[id]/roadmap` + `/roadmap/[roadmapId]` | Roadmap (ön koşul DAG) |
| `/settings` | Ayarlar (BYOK + OS keychain + vault sync) |
| `/setup/[step]` | 4 adımlı wizard |

> **Kaldırılan rota:** `/w/[id]/plan` (haftalık takvim + .ics + hatırlatıcı) Phase 13'te
> tamamen kaldırıldı; `planBlocks` tablosu Dexie v28'de düşürüldü. Yerini `/w/[id]/roadmap`
> aldı — bkz. `ROADMAP_FEATURE_SPEC.md`.

**Hâlâ eksik akışlar** (`MISSING.md`'de detay):
- Workspace oluşturma / silme / ayar modali
- Kaynak içe aktarma modal akışları (PDF/DOCX/URL/YouTube/arXiv/...)
- Flashcard / quiz düzenleme ekranları
- Empty state'ler ve granular hata UI'leri
- Grup çalışma / paylaşım UI (Phase 6+)

---

## 4. Veri Modelleri (özet)

Detaylı şemalar için `FEATURES.md`'ye bakın. Özet:

```ts
type Workspace = {
  id: string;
  name: string;        // TR
  nameEn?: string;     // EN (opsiyonel)
  color: string;       // hex
  initials: string;    // 1 harf
  goal?: StudyGoal;
  createdAt: ISO8601;
  updatedAt: ISO8601;
};

type Source = {
  id: string;
  workspaceId: string;
  type: 'pdf' | 'arxiv' | 'url' | 'youtube' | 'markdown' | 'image' | 'docx' | 'epub';
  title: string;
  author?: string;
  metadata: Record<string, unknown>;
  filePath?: string;       // yerel dosya
  chunks: Chunk[];         // parse sonrası
  readPercentage: number;
  highlightCount: number;
};

type Chunk = {
  id: string;
  sourceId: string;
  text: string;
  page?: number;
  section?: string;
  embedding?: number[];    // LanceDB/local
};

type Highlight = {
  id: string;
  chunkId: string;
  sourceId: string;
  text: string;
  color?: string;
  userNote?: string;
  createdAt: ISO8601;
};

type Flashcard = {
  id: string;
  workspaceId: string;
  sourceRef?: { sourceId: string; page?: number };
  question: string;
  answer: string;
  difficulty: 'easy' | 'medium' | 'hard';
  // SM-2 state
  interval: number;
  easeFactor: number;
  repetitions: number;
  dueDate: ISO8601;
  reviewHistory: ReviewRecord[];
};

type ReviewRecord = {
  date: ISO8601;
  rating: 1 | 2 | 3 | 4;  // Again | Hard | Good | Easy
  intervalBefore: number;
  intervalAfter: number;
  easeFactorBefore: number;
  easeFactorAfter: number;
};

type QuizQuestion = {
  id: string;
  workspaceId: string;
  type: 'mcq' | 'open' | 'feynman';
  question: string;
  options?: string[];
  correctAnswer: string | number;
  explanation: string;
  sourceRefs: Array<{ sourceId: string; page?: number }>;
  difficulty: 'easy' | 'medium' | 'hard';
};

type MindMapNode = {
  id: string;
  workspaceId: string;
  label: string;
  type: 'hub' | 'primary' | 'secondary';
  description?: string;
  sourceRefs: Array<{ sourceId: string; page?: number }>;
  position?: { x: number; y: number };
};

type MindMapEdge = {
  fromId: string;
  toId: string;
  strength: 1 | 2 | 3;
  type: 'concept' | 'workspace';
};

type Podcast = {
  id: string;
  workspaceId: string;
  title: string;
  sourceIds: string[];
  audioPath: string;      // yerel dosya
  durationSec: number;
  chapters: Chapter[];
  transcript: TranscriptLine[];
};

type TranscriptLine = {
  speaker: 'A' | 'B';
  timeSec: number;
  textTr: string;
  textEn?: string;
};

type StudyGoal = {
  objective: string;
  targetDate: ISO8601;
  weeklyGoalHours: number;
};

type PlannedSession = {
  id: string;
  workspaceId: string;
  day: ISO8601;
  startHour: number;       // 7..22
  durationMin: number;
  type: 'read' | 'review' | 'quiz' | 'feynman' | 'research' | 'podcast';
  title: string;
  completed: boolean;
};

type UserPrefs = {
  theme: 'light' | 'dark' | 'sepia';
  density: 'compact' | 'comfy';
  accent: string;
  font: 'serif' | 'sans' | 'mono';
  sidebar: 'left' | 'right';
  lang: 'tr' | 'en';
  learning: {
    autoFlashcards: boolean;
    algorithm: 'sm2' | 'fsrs';
    dailyNewLimit: number;
    aiContextExpansion: 'narrow' | 'section' | 'chapter';
    feynmanStrictness: 'lenient' | 'balanced' | 'strict';
  };
};
```

---

## 5. Tasarım Sistemi Özeti

Mevcut uygulama Tailwind v4 token'larını `src/app/globals.css` içinde tutar. Eski warm parchment + deep ink prototip dili hâlâ bazı sayfalarda hissediliyor; yeni tasarım yönü dark-first premium akademik workspace olarak `UI_REDESIGN_PLAN.md` içinde tanımlandı.

**Mevcut baseline:**
- **Renkler:** `--color-paper`, `--color-ink`, `--color-accent`, `--color-accent-hot`
- **Temalar:** `white`, `sepia`, `dark` — `<html data-theme="...">` üzerinden
- **Yoğunluk:** `compact`, `normal`, `comfy` — `<html data-density="...">`
- **Yazı tipi:** Source Serif 4, Inter, JetBrains Mono
- **Köşe:** 12px merkezli radius sistemi
- **Gölgeler:** tema bazlı soft/medium/deep/lift token'ları

**Planlanan redesign:**
- Varsayılan tema dark premium
- Sepia özellikle reader/notebook için güçlü mod
- Dashboard ve operational ekranlarda sans-serif ağırlığı
- Reader ve akademik alıntılarda serif karakter
- Sayfa-içi responsive düzenlerin yeniden kurulması

Tailwind eşleşmeleri için → `DESIGN_SYSTEM.md`.

---

## 6. Teknoloji Yığını

### Dondurulan kararlar
| Katman | Seçim | Gerekçe |
|--------|-------|---------|
| Framework | **Next.js 15 · App Router** | SSR gerek yok; App Router, RSC, route organizasyonu |
| Dil | **TypeScript (strict)** | Tip güvenliği, domain modellerinin netliği |
| Stil | **Tailwind CSS v4** | design.css token'ları direkt `@theme` ile eşlenir |
| State | **Zustand** + **TanStack Query** | Hafif, client-side, localStorage sync |
| DB | **SQLite (better-sqlite3)** veya tarayıcıda **IndexedDB** | Açık kaynak — PostgreSQL gereksiz |
| Vektör | **LanceDB (lokal)** veya **sqlite-vec** | Gömlü, kurulum gerekmiyor |
| LLM | **Anthropic SDK** (Claude Opus/Sonnet/Haiku) | Ana model ailesi |
| Embedding | **OpenAI** veya **Voyage AI** | BYOK |
| TTS | **Piper local TTS** (Tauri sidecar) | Podcast için; Kokoro/XTTS/VibeVoice Phase 12 POC |
| STT | **Whisper** (OpenAI API veya `whisper.cpp`) | Feynman için |
| Scraping | **Firecrawl** (BYOK) veya lokal `pdf.js` + `cheerio` | arXiv / DOI |
| PDF parse | **pdf.js** + **mammoth** (DOCX) | Client-side |
| i18n | **next-intl** | TR/EN desteği |

### Açık uçlu sorular
- **Tauri mı Electron mı sadece web mi?** — Başlangıçta `npm run dev` ile sadece web yeterli. Native shell Phase 5+.
- **better-sqlite3 vs. IndexedDB?** — Electron/Tauri varsa SQLite; salt web ise IndexedDB (Dexie).
- **FSRS** eklensin mi SM-2 zaten yeterli mi? — SM-2 ile başlamak mantıklı, FSRS v5 ileride.

---

## 7. AI Entegrasyon Noktaları

| Özellik | Provider | Modeller |
|---------|----------|----------|
| Contextual Q&A | Anthropic | Opus 4.7 (derin), Sonnet 4.6 (hızlı) |
| Özetleme / başlık / etiket | Anthropic | Haiku 4.5 |
| Flashcard üretimi | Anthropic | Sonnet 4.6 |
| Quiz üretimi | Anthropic | Sonnet 4.6 |
| Feynman değerlendirme | Anthropic + Whisper | Sonnet 4.6 |
| Podcast senaryosu | Anthropic | Opus 4.7 (iki ses diyalog) |
| Podcast TTS | Piper local TTS | Free/default local runtime |
| Embedding | OpenAI / Voyage | `text-embedding-3-large` / `voyage-3` |
| Araştırma tarama | Firecrawl + Claude | Sonnet 4.6 (reranking) |
| Müfredat üretimi | Anthropic | Opus 4.7 |
| STT | Whisper | `whisper-1` veya yerel `whisper.cpp` |

**Kaçırılmaması gerekenler:**
- **Prompt caching** — Kaynak metinleri sabit; her Q&A'da cache'le.
- **Extended thinking / reasoning** — Derin sorular için Opus'ta devrede.
- **Tool use** — Notebook chat'ta "Add flashcard", "Open citation" tool'ları.
- **Streaming** — Tüm chat yanıtları stream ile.

---

## 8. Dokümantasyon Yol Haritası

1. **`PROJECT_INDEX.md`** (bu dosya) — Üst düzey envanter
2. **`ARCHITECTURE.md`** — Next.js klasör yapısı, routing, state, persistence
3. **`FEATURES.md`** — Sayfa bazlı tam özellik kataloğu
4. **`DESIGN_SYSTEM.md`** — Token ↔ Tailwind eşlemesi
5. **`MISSING.md`** — Eksik UI/backend/logic punch list
6. **`ROADMAP.md`** — Fazlı uygulama planı
7. **`CLAUDE.md`** (root) — Claude Code oturumları için rehber

---

## 9. Sonraki Adımlar

Phase 3.5 itibarıyla tamamlananlar (kronolojik):

1. ✅ Phase 0 — Next.js + TS + Tailwind v4 scaffold
2. ✅ Phase 1 — 12 sayfa static port (mock fixtures)
3. ✅ Phase 2 — Dexie persistence (10 tablo + 19 hook), API key vault (PBKDF2 + AES-GCM + recovery key), PDF + DOCX ingest, Anthropic chat streaming + tool use, OpenAI embedding + k-NN retrieval, Setup Wizard 4-step, Backup/restore, OPFS, CSP, IndexedDB quota, sayfa-içi mobile (6 sayfa), AI yanıt dili
4. ✅ Phase 2.5 — cmdk + Dexie FTS, Flashcard edit, Chat thread mgmt, AI cost UI, Leech (Schema v4), Dashboard dinamik, Empty state, Shortcuts help
5. ✅ Phase 3.0 — Provider abstraction (`ChatProvider` / `EmbedProvider` / `ToolTranslator` interface'leri)
6. ✅ Phase 3.1 — 12 cloud chat preset + `OpenAICompatChatProvider` + `GeminiChatProvider` + provider-aware `/api/ai/chat` proxy + Schema v5 + 35 model pricing
7. ✅ Phase 3.2 — `local-bypass.ts` `isLocalUrl()` + 3 local preset (ollama / lm-studio / llama-cpp) + custom endpoints + degraded tool use (JSON-via-prompt)
8. ✅ Phase 3.3.A — Schema v7 (`embeddingDim/Provider/Model`) + 14 embed preset registry
9. ✅ Phase 3.3.B — 5 cloud embed adapter (voyage / gemini / cohere / jina / hf · 41 mock-fetch test)
10. ✅ Phase 3.3.C — `embed-openai-compat.ts` (cloud proxy + local Ollama bypass) + registry branching
11. ✅ Phase 3.3.D — Retrieval dim guard `{ chunks, skippedCount }` + legacy fallback + eager embed-dim persist
12. ✅ Phase 3.3.E — Reembed flow (`planReembed` + `runReembed` + `ReembedModal`) + worker BATCH 64 + reader skippedCount banner
13. ✅ Phase 3.3.F — Family-aware `/api/ai/embed` proxy (7 cloud aile) + `deriveConnectOrigins()` build-time CSP
14. ✅ **Phase 3.4** — Settings UI default embed picker + per-task model binding (Schema v7→v8 `modelBindings` + `setModelBinding` + exported `migratePrefs` + `src/lib/ai/model-options.ts` `listChatOptions` / `listEmbedOptions` / `badgesForChat` / `badgesForEmbed` + 4 ModelRow native select capability badges + SourceUploader prefs callsite + 14 yeni test)
15. ✅ **Phase 3.5-tail (kısmen)** — `docs/PROVIDERS.md` (~150 satır cloud sağlayıcı anahtar/CORS rehberi) + `pricing.ts` `PRICING_SNAPSHOT_DATE` + `PRICING_FRESHNESS_DAYS_MAX = 90` + `pricingSnapshotAgeDays()` + `isPricingSnapshotStale()` + `pricing-freshness.test.ts` 6 case (CI 90-gün gate). **⚠️ Freshness kapısı 2026-08-03'te kaldırıldı** — BYOK'ta her sağlayıcının fiyat temposu farklı (+ OpenRouter / custom endpoint oranları bilinemez), tek bir repo-geneli snapshot tarihi kullanıcının faturalandığı satır hakkında hiçbir şey söylemiyordu; takvime bağlı test CI'ı sahte kırmızıya düşürüyordu. `PRICING` map'i duruyor.
16. ✅ **Phase 3.5 — E2E altyapısı + smoke + wizard** — Playwright `@playwright/test ^1.59.1` + Chromium headless shell + `playwright.config.ts` (testDir `tests/e2e`, testMatch `**/*.e2e.ts`, webServer `npm run dev` reuseExistingServer + CI 1 worker / 2 retry) + `tests/e2e/smoke.e2e.ts` (4 case · `/`, `/dashboard`, `/setup`, `/settings` body non-empty + uncaught-exception gate) + `tests/e2e/setup-wizard.e2e.ts` (4 case · 4 wizard step reachable + step 2 password input + step 4 CTA count) + `vitest.config.ts` `tests/e2e/**` defensive exclude + `package.json` `test:e2e` / `test:e2e:ui` scripts. **E2E ile yakalanan 2 bug aynı oturumda düzeltildi:** (1) `next.config.ts` `LOCAL_ORIGINS` IPv6 wildcard `[::1]:*` (CSP3 `<host-source>` invalid) kaldırıldı, (2) Dexie schema v8 eklendi (`chatMessages: "id, threadId, workspaceId, createdAt, [threadId+createdAt]"` — CostChip `useTotalCost.where("createdAt").above(since)` SchemaError'ı çözdü).
17. ✅ **Phase 3.5 — PDF→Q&A E2E (2026-05-01)** — `tests/e2e/notebook-happy-path.e2e.ts` tek case 180s timeout. Pipeline: `installAiMocks(page)` (Anthropic SSE message_start → text_delta → message_stop · `Math.sin(i + seed * 0.31)` deterministic embed vector) → `seedUnlockedVault(page)` (PBKDF2 600k → AES-GCM verifier+openai+anthropic apiKeys → JWK round-trip + `page.addInitScript` cross-nav vault restore via `window.__useVault.setState`) → `goto /w/{id}` → `setInputFiles fixture/sample.pdf` (837B hand-rolled PDF via `build-pdf.mjs`) → wait for `ready|hazır` badge (120s) → close upload modal → click "sample" link → "Yeni sohbet" → fill textarea + Send → assert "this document is about" + `[data-citation-ref]` chip + `chatHits === 1`. **2 production bug E2E ile yakalandı + aynı oturumda düzeltildi:** (1) `SourceUploader` self-cancelling effect — processing useEffect cleanup `setQueue` re-render'da tetiklenip parsePdf IIFE'yi öldürüyordu, `queueRef`-based guard ile kuyruktaki item'lar için cleanup atlanıyor; (2) `pdfjs-dist v5` empty `workerSrc` fake-worker mode artık desteklenmiyor, side-effect `import "pdfjs-dist/legacy/build/pdf.worker.mjs"` eklendi (worker dosyası bundle'a dahil oluyor). `CitationChip` `data-citation-ref={ref}` attr (E2E selector için stable handle) + `vault.ts` `window.__useVault` debug surface (cross-nav restore için). E2E **9 case toplam** (smoke 4 + wizard 4 + notebook 1).
18. ✅ **Phase 3.5+ — Quick-start preset shortcuts + Setup Wizard Step 2 redesign + Settings tek-tıkla (2026-05-01)** — 4 alt-faz:
    - **3.5+.A** `src/lib/ai/quick-start-presets.ts` — 5 curated preset (Gemini / Ollama / Groq / Anthropic / OpenRouter) + `QuickStartPreset` type (`requiresKey` / `isLocal` / `freeTier` / `defaultBindings: Partial<ModelBindings>`) + `getQuickStartPreset(id)`. Chat-only sağlayıcılar (Groq/Anthropic/OpenRouter) `embedPresetId` yazmaz. Test: `quick-start-presets.test.ts` 13 case (registry shape + freeTier kaynak doğruluğu + EMBED_PRESETS lookup + bilingual tagline).
    - **3.5+.B** `src/components/setup/PresetChooser.tsx` — radiogroup primitive: 5 tile grid (sm:grid-cols-3), `role="radio"` + roving tabindex (sadece seçili tile tab order'da), klavye nav (←↑→↓ + Home + End), seçim controlled. Sibling `DynamicKeyField` (cloud → password input + "Anahtar al" external link; local → "Anahtar gerekmiyor" + install guide link). **Repo'nun ilk component testi**: `@testing-library/react` + user-event, vitest `globals: false` olduğundan açık `cleanup()` afterEach hook gerekti. Test: `PresetChooser.test.tsx` 12 case.
    - **3.5+.C** Setup Wizard Step 2 wire-up — `app/setup/[step]/page.tsx` `ApiStep` refactor: `QuickStartSection` accent card üstte, manuel `ProviderRow` form altta `border-t border-rule-soft pt-6` ile ayrılmış. `useApiKeyManager(WIZARD_PROVIDERS)` 4 → 8 sağlayıcıya genişledi (gemini/groq/openrouter/ollama dahil). Apply flow: `setDraft(providerId, key)` → `setModelBinding(task, model)` her binding için → `keys.saveAll()` (vault locked ise mevcut `MasterPasswordModal` açılır) → `useToast` success. E2E setup-wizard 4 → 5 case (+1 quick-start chooser tile sayımı 5).
    - **3.5+.D** Settings → Models tab — `QuickStartRow` 4 ModelRow'un üstünde, aynı `PresetChooser`/`DynamicKeyField` paylaşıyor. `SETTINGS_PROVIDERS` constant (8 sağlayıcı) ile `keys.modalOpen` API ve Models tab'leri arasında paylaşılıyor.
    - Vitest **38 dosya / 391 test (~17s)** + Playwright **10 E2E case** = 401 test toplam · `npm run typecheck` ✅ 0 hata · production bug yok (saf additive).


**Tamamlanan son Guided Study alt-fazı — Phase 4.5.H (2026-05-22): AI curriculum hardening / draft-first refine**
- ✅ AI curriculum akışı deterministic draft-first: önce kaynak temelli taslak, sonra AI refine
- ✅ AI JSON/parse/schema/ref hatasında kullanıcıya failure dönmeden draft kaydediliyor
- ✅ Kaynak/chunk id'leri modelden beklenmiyor; sistem draft id'lerini koruyor, model title/objective/order/prerequisite/minutes refine ediyor
- ✅ UI sonucu açık gösteriyor: "AI ile iyileştirildi" veya "kaynak temelli taslak oluşturuldu"

**Güncel sıradaki — Phase 11 smoke/release gate → Phase 12 Heavy Local TTS Runtime POCs**
- ⏳ Manual Piper TR synthesis smoke test in real Tauri runtime
- ⏳ Tauri updater signing key / GitHub release secrets / endpoint cleanup
- ⏳ Phase 12 runtime POCs: real Kokoro sidecar, XTTS Python server, VibeVoice Python server, VibeVoice Turkish quality POC

**Phase 3.5+:**
- ⏳ Per-call model picker chat composer'da (kapasite matrix wiring)
- ⏳ Topbar `CostChip` ücretsiz model davranışı + free-tier 429 backoff toast
- ⏳ Migration banner + Backup/restore v3 format (`providerSettings` + `modelBindings`)
- ⏳ Hybrid retrieval / cross-encoder rerank

**Phase 4:** SRS polish + flashcard generation + Quiz MCQ + Mind map concept extraction tamamlandı; `ROADMAP.md` daha güncel kabul edilir.
**Phase 4.5:** Guided Study / AI Course Builder — kaynaklardan müfredat ve ders notu üretimi. Detay → `docs/GUIDED_STUDY_CAPABILITY.md`.
**Phase 5+:** Phase 5 / 5.5 advanced work is already implemented in the current app history; do not treat it as the next phase. Current unresolved track is Tauri/TTS smoke + Phase 12 runtime POCs, then release hygiene.

Audit detayları için → `MISSING.md` §19-20. Faz planı için → `ROADMAP.md`.

---

## 10. Referanslar

- **Claude API dokümantasyonu:** https://docs.claude.com/en/api/
- **Next.js App Router:** https://nextjs.org/docs/app
- **Tailwind CSS v4:** https://tailwindcss.com/docs
- **LanceDB:** https://lancedb.github.io/lancedb/
- **SM-2 algoritması:** https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
- **FSRS v5:** https://github.com/open-spaced-repetition/fsrs4anki
