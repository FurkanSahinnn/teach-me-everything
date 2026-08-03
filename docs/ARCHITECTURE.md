# Architecture — Teach Me Everything

> Bu dosya, HTML prototiplerinden **Next.js 16 + TypeScript + Tailwind CSS v4** tabanlı, yerel-öncelikli (open source) mimariye geçiş planını anlatır. PostgreSQL gibi sunucu tabanlı DB kullanılmaz; her şey kullanıcının makinesinde.
>
> ⚠️ **Tarihsel plan belgesi.** Bölümlerin bir kısmı Phase 0–3 döneminde yazıldı ve
> sonraki fazlarda aşıldı. Kod düzeyinde güncel harita için `docs/CODEMAPS/` (özellikle
> `architecture.md` + `backend.md`) tek doğruluk kaynağıdır.

---

## 1. High-Level Topology

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser (Next.js App)                       │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  Server      │   │  Client      │   │  Route Handlers   │  │
│  │  Components  │◄─►│  Components  │◄─►│  (AI proxying)    │  │
│  │  (layout)    │   │  (interactive)│  │  /api/ai/*        │  │
│  └──────────────┘   └──────────────┘   └────────┬──────────┘  │
│                              │                   │              │
│                   ┌──────────▼──────────┐   ┌───▼─────────┐   │
│                   │  Zustand stores     │   │  Anthropic  │   │
│                   │  + TanStack Query   │   │  SDK (server)│   │
│                   └──────────┬──────────┘   └───┬─────────┘   │
│                              │                   │              │
│       ┌──────────────────────▼───────────┐      │              │
│       │  Persistence Layer (client)       │      │              │
│       │  • IndexedDB (Dexie)              │      │              │
│       │  • OR better-sqlite3 (if Tauri)   │      │              │
│       │  • LanceDB (embeddings)           │      │              │
│       │  • File System Access API (PDF)   │      │              │
│       └───────────────────────────────────┘      │              │
└──────────────────────────────────────────────────┼──────────────┘
                                                    │
                              ┌─────────────────────┼──────────────┐
                              │ External (BYOK)     │              │
                              │  • Anthropic        │              │
                              │  • OpenAI (emb+STT) │              │
                              │  • Local TTS runtime │             │
                              │  • Firecrawl        │              │
                              └────────────────────────────────────┘
```

**Prensipler:**
- **Veri yerelde kalır.** Kullanıcının makinesi dışına yalnızca LLM istekleri gider.
- **API anahtarları tarayıcıda şifrelenir** (Web Crypto API, AES-GCM, kullanıcı parolası ile türetilmiş key).
- **Route Handler'lar** (`/api/ai/*`) sadece LLM isteklerini proxyler — CORS/anahtar ifşa derdini azaltır.
- **Sunucu state yok.** PostgreSQL, Redis, session store yok.
- **Çoklu hedef:** Web (default), sonra Tauri/Electron shell (Phase 6+).

---

## 2. Klasör Yapısı

```
teach-me-everything/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # Root layout (theme, fonts, i18n)
│   ├── page.tsx                      # Landing (/)
│   ├── setup/
│   │   └── [[...step]]/page.tsx      # Setup sihirbazı (step 1-4)
│   ├── dashboard/
│   │   └── page.tsx                  # Dashboard
│   ├── w/
│   │   └── [workspaceId]/
│   │       ├── layout.tsx            # Workspace shell (sidebar)
│   │       ├── page.tsx              # Workspace overview
│   │       ├── read/
│   │       │   └── [sourceId]/page.tsx   # Notebook
│   │       ├── cards/page.tsx        # Flashcards
│   │       ├── quiz/page.tsx         # Quiz + Feynman
│   │       ├── map/page.tsx          # Mind Map
│   │       ├── audio/
│   │       │   └── [podcastId]/page.tsx  # Podcast
│   │       ├── research/page.tsx     # Literatür
│   │       └── plan/page.tsx         # Çalışma planı
│   ├── settings/page.tsx             # Ayarlar
│   └── api/
│       ├── ai/
│       │   ├── chat/route.ts         # Claude chat (streaming)
│       │   ├── summarize/route.ts    # Haiku özet
│       │   ├── flashcards/route.ts   # Kart üretimi
│       │   ├── quiz/route.ts         # Quiz üretimi
│       │   ├── feynman/route.ts      # Feynman değerlendirme
│       │   ├── podcast/route.ts      # Podcast senaryo + TTS
│       │   ├── curriculum/route.ts   # Müfredat planlama
│       │   ├── embed/route.ts        # Embedding proxy
│       │   └── research/route.ts     # Firecrawl + arXiv
│       └── ingest/
│           ├── pdf/route.ts          # PDF parse
│           ├── arxiv/route.ts        # arXiv fetch
│           ├── youtube/route.ts      # YouTube transcript
│           └── url/route.ts          # URL scrape
├── components/
│   ├── shell/                        # Sidebar, Topbar, Tweaks, Brand
│   ├── ui/                           # Button, Chip, Input, Card, Kbd, ...
│   ├── reader/                       # Prose, Highlight, SelectionPopover
│   ├── chat/                         # ChatThread, Message, CiteChip
│   ├── cards/                        # FlashcardStack, RatingBar
│   ├── quiz/                         # MCQBlock, OpenInput, FeynmanPane
│   ├── mindmap/                      # GraphCanvas, NodeInspector
│   ├── podcast/                      # Player, Transcript
│   ├── research/                     # PaperCard, ComparisonMatrix
│   └── plan/                         # WeekGrid, MilestoneList
├── lib/
│   ├── db/
│   │   ├── schema.ts                 # Dexie tabloları (veya SQLite)
│   │   ├── workspaces.ts
│   │   ├── sources.ts
│   │   ├── highlights.ts
│   │   ├── flashcards.ts
│   │   ├── quiz.ts
│   │   ├── mindmap.ts
│   │   ├── podcasts.ts
│   │   └── prefs.ts
│   ├── vectors/
│   │   ├── lancedb.ts                # yerel vektör
│   │   └── search.ts                 # k-NN + reranking
│   ├── srs/
│   │   ├── sm2.ts                    # SM-2
│   │   └── fsrs.ts                   # FSRS v5 (opsiyonel)
│   ├── ingest/
│   │   ├── pdf.ts                    # pdf.js wrapper
│   │   ├── docx.ts                   # mammoth
│   │   ├── epub.ts
│   │   ├── arxiv.ts
│   │   └── youtube.ts
│   ├── ai/
│   │   ├── anthropic.ts              # SDK wrapper + cache config
│   │   ├── openai.ts
│   │   ├── firecrawl.ts
│   │   └── prompts/                  # Sistem promptları
│   │       ├── notebook-chat.ts
│   │       ├── flashcard-gen.ts
│   │       ├── quiz-gen.ts
│   │       ├── feynman-eval.ts
│   │       ├── podcast-script.ts
│   │       └── curriculum.ts
│   ├── crypto/
│   │   └── api-keys.ts               # Web Crypto API ile anahtar şifre
│   ├── i18n/
│   │   ├── tr.json
│   │   └── en.json
│   └── utils/
├── stores/
│   ├── prefs.ts                      # Zustand — tema, dil, yoğunluk
│   ├── workspace.ts                  # Aktif workspace
│   ├── session.ts                    # Chat session, quiz session
│   └── player.ts                     # Audio player state
├── hooks/
│   ├── useWorkspace.ts
│   ├── useSources.ts
│   ├── useFlashcards.ts
│   └── useAI.ts
├── public/
│   ├── fonts/                        # (gerekirse Google Fonts self-host)
│   └── icons/
├── styles/
│   └── globals.css                   # Tailwind @theme + design tokens
├── tailwind.config.ts
├── next.config.mjs
├── tsconfig.json                     # strict
├── package.json
├── CLAUDE.md
└── docs/                             # Bu index dosyaları
```

---

## 3. Routing Stratejisi

### Public
- `/` — Landing (SSG)
- `/setup/[step]` — Onboarding (client)

### Authenticated (aslında yerel — auth yok)
- `/dashboard` — Ana sayfa
- `/w/[workspaceId]` — Workspace özeti
- `/w/[workspaceId]/read/[sourceId]` — Notebook okuyucu
- `/w/[workspaceId]/cards` — SRS oturumu
- `/w/[workspaceId]/quiz` — Quiz
- `/w/[workspaceId]/map` — Zihin haritası
- `/w/[workspaceId]/audio/[podcastId]` — Podcast
- `/w/[workspaceId]/research` — Literatür
- `/w/[workspaceId]/plan` — Plan
- `/settings` — Ayarlar

### API (Route Handlers)
- `POST /api/ai/chat` — Stream Claude yanıtı
- `POST /api/ai/summarize` — Özet
- `POST /api/ai/flashcards` — Kart üret
- `POST /api/ai/quiz` — Soru üret
- `POST /api/ai/feynman` — Anlatım değerlendir
- `POST /api/ai/podcast` — Senaryo + TTS
- `POST /api/ai/curriculum` — Müfredat
- `POST /api/ai/embed` — Embedding
- `POST /api/ai/research` — Arama + rerank
- `POST /api/ingest/pdf` — PDF parse
- `POST /api/ingest/arxiv` — arXiv metadata + PDF
- `POST /api/ingest/youtube` — Transcript
- `POST /api/ingest/url` — URL scrape

> **Not:** Route handler'lar anahtarı request body'de alır veya HttpOnly cookie'de saklar. Anahtarlar **sunucuda disk'e yazılmaz** — sadece proxy amaçlı.

---

## 4. State Management

| Kapsam | Araç | Açıklama |
|--------|------|----------|
| UI tercihleri (tema, dil, yoğunluk) | Zustand + localStorage persist | `shell.js` eşdeğeri |
| Aktif workspace / session | Zustand (session) | Route değişince resetlenir |
| Veri fetch (sources, flashcards...) | TanStack Query | Dexie üstüne cache |
| Form state (settings, kart düzenleme) | React Hook Form | Zod ile validation |
| URL state (filtreler, tab, ?q=) | `useSearchParams` | Shareable |
| Chat stream | Custom hook (`useStream`) | ReadableStream tüketimi |

---

## 5. Persistence — Local-First

### Seçenek A: Salt Web (başlangıç)
- **IndexedDB** üzerinden **Dexie.js** ile tablo modeli
- **LanceDB-node / sqlite-vec** mümkün değil → embeddingler IndexedDB'de `Float32Array` olarak tutulur
- **k-NN** WebWorker'da JS ile (hnswlib-wasm veya `voy-search`)
- **PDF'ler OPFS'e** (Origin Private File System) yazılır

### Seçenek B: Tauri / Electron (Phase 6+)
- **better-sqlite3** ile `~/.tme/tme.db`
- **LanceDB** ile `~/.tme/vectors/`
- **File System** ile `~/.tme/sources/`
- Native menu, multi-window, tray vs.

### Migration yolu
Başlangıçta Dexie üzerine bir **repository pattern** yaz — `IWorkspaceRepo`, `ISourceRepo` vb. — böylece sonra `SqliteWorkspaceRepo` eklemek basit olur.

```ts
// lib/db/repo.ts
export interface ISourceRepo {
  list(workspaceId: string): Promise<Source[]>;
  get(id: string): Promise<Source | null>;
  create(input: NewSource): Promise<Source>;
  update(id: string, patch: Partial<Source>): Promise<void>;
  delete(id: string): Promise<void>;
}
```

---

## 6. API Key Yönetimi

Anahtarlar hassas. **Güncel akış (Phase 8–9 sonrası):**

1. Kullanıcı `/setup` veya Settings içinde anahtarları girer.
2. **Tauri (dağıtılan yapı):** anahtar doğrudan **OS keychain**'e yazılır — `keyring-rs`
   üzerinden `keychain_set` / `keychain_get` / `keychain_delete` / `keychain_list`
   Rust komutları (`src-tauri/src/keychain.rs`), köprü `lib/tauri/keychain.ts`.
3. **Web (yalnızca geliştirme):** anahtar Dexie `apiKeys` tablosunda **plaintext** durur.
   Web üretimde dağıtılmadığı için bu kabul edilmiş bir geliştirme kolaylığıdır.
4. Sunucu tarafında anahtar **asla disk'e yazılmaz** — yalnızca request header olarak
   provider'a iletilir. Tauri yapısında `/api/*` proxy'si tümüyle atlanır (`plugin-http`).

> **Kaldırılan tasarım:** Master password + PBKDF2 → AES-GCM + `.tmekey` recovery
> **Phase 9'da tamamen silindi** (14 dosya; Dexie v24 `vault` tablosunu düşürdü ve
> çözülemez hale gelen `apiKeys` satırlarını temizledi). Aşağıdaki kod örneği
> yalnızca tarihsel bağlam içindir; `decryptKey()` artık mevcut değildir.

```ts
// Client
const body = { messages, apiKeyRef: 'anthropic' }; // key id, not value
const key = await decryptKey('anthropic');         // client'ta decrypt
await fetch('/api/ai/chat', {
  method: 'POST',
  headers: { 'x-provider-key': key },              // tek seferlik iletim
  body: JSON.stringify(body),
});
```

> **Not:** Bu bölümdeki "alternatif" olarak işaretlenen OS keychain yaklaşımı
> **Phase 8'de hayata geçti ve tek yol hâline geldi** — artık alternatif değil, varsayılan.

---

## 7. AI Katmanı

### Anthropic SDK
```ts
// lib/ai/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';

export function client(apiKey: string) {
  return new Anthropic({ apiKey });
}

export const MODELS = {
  deep:    'claude-opus-4-7',
  fast:    'claude-sonnet-4-6',
  tiny:    'claude-haiku-4-5-20251001',
} as const;
```

### Prompt caching
Kaynak metinleri **system prompt** içine sabit olarak konulur ve `cache_control: { type: 'ephemeral' }` ile işaretlenir:

```ts
messages: [{ role: 'user', content: question }],
system: [
  { type: 'text', text: 'Sen akademik bir tutorsun...' },
  {
    type: 'text',
    text: `Kaynak: ${sourceChunks}`,
    cache_control: { type: 'ephemeral' },
  },
],
```

### Streaming
```ts
const stream = await anthropic.messages.stream({
  model: MODELS.fast,
  messages,
  system,
  max_tokens: 4096,
});
for await (const chunk of stream) {
  if (chunk.type === 'content_block_delta') writer.write(chunk.delta.text);
}
```

### Tool use (Notebook chat)
```ts
tools: [
  {
    name: 'add_flashcard',
    description: 'Sohbetten bir flashcard oluşturur',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        answer: { type: 'string' },
        sourceRef: { type: 'object' },
      },
      required: ['question', 'answer'],
    },
  },
  { name: 'open_citation', ... },
  { name: 'simplify_explanation', ... },
],
```

### Extended thinking
Zor sorular için Opus'ta `thinking: { type: 'enabled', budget_tokens: 8000 }`.

---

## 8. i18n Stratejisi

`next-intl` kullanılır; mevcut `shell.js` içindeki `data-tr` / `data-en` pattern'i JSON message'lara dönüştürülür.

```ts
// lib/i18n/tr.json
{
  "nav": { "dashboard": "Dashboard", "workspace": "Workspace", ... },
  "setup": { "title": "Hoşgeldin", ... }
}
```

Kaynak dili **Türkçe**; İngilizce eş zamanlı korunur. AI yanıtları kullanıcı tercihine göre ya **kaynağın dili** ya da **UI dili** seçilebilir (setting flag'i).

---

## 9. Güvenlik Notları

- **CSP**: `connect-src` artık elle yazılmaz — `lib/ai/csp-origins.ts` `deriveConnectOrigins()` ile seçili sağlayıcı preset'lerinden **build-time** türetilir (Phase 3.3.F). ElevenLabs kaynağı Phase 11'de listeden çıktı (sağlayıcı tamamen kaldırıldı; TTS artık yerel Piper sidecar).
- **XSS**: Prose rendering → `dompurify` veya React escape (sanitize markdown).
- **Kullanıcı yüklediği PDF** → sandboxed iframe ya da worker içinde parse.
- **Anahtar logging yasak** — hiçbir logger anahtar veya prompt içeriğini yazmaz.

---

## 10. Performans

- **Prompt caching**: Aynı kaynak üzerinden her yeni soruda 2-5× ucuzlar.
- **SSG** landing + setup; geri kalan `'use client'`.
- **Suspense boundaries**: Sidebar, topbar ayrı ayrı stream.
- **Virtualization**: Uzun source listesi → `@tanstack/react-virtual`.
- **Web Workers**: PDF parse, k-NN, TTS chunk mixing.
- **Lazy load**: Podcast player, mind map canvas (heavy libs).

---

## 11. Test Stratejisi

| Katman | Araç |
|--------|------|
| Unit (pure fn) | Vitest |
| SRS algoritması | Vitest + fixture |
| Component | Vitest + Testing Library |
| E2E | Playwright |
| Tip | `tsc --noEmit` CI'da |
| Lint/format | ESLint + Prettier |

Öncelik: SM-2 mantığı, persistence layer, AI prompt kontratları.

---

## 12. Dağıtım

| Hedef | Nasıl |
|-------|-------|
| Self-hosted web | `npm run build && npm run start` (Docker opsiyonel) |
| GitHub Pages static | `next export` — ama route handler'lar gider, uygun değil |
| Vercel / Cloudflare Pages | Edge runtime ile; DB client-side olduğundan sorunsuz |
| Tauri | `cargo tauri build` — Phase 6+ |
| Electron | `electron-builder` — alternatif |

---

Devamı için → `FEATURES.md`, `ROADMAP.md`.
