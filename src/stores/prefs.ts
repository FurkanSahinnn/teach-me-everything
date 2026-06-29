import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  clampCurriculumChunkDetail,
  DEFAULT_CURRICULUM_CHUNK_DETAIL,
  type CurriculumChunkDetailLevel,
} from "@/lib/ai/curriculum-budget";
import type { EmbedPresetId } from "@/lib/ai/providers/embed-presets";
import type { WebSearchOptions } from "@/lib/ai/web-search/types";
import type { ResearchProviderId } from "@/lib/research/providers/types";
import {
  DEFAULT_SEARCH_PROVIDERS,
  isValidSearchProviders,
  type SearchProviderEntry,
  type SearchProviderEntryConfig,
} from "@/lib/research/search/types";
import {
  DEFAULT_CONFLICT_POLICY,
  isConflictPolicy,
  type ConflictPolicy,
} from "@/lib/vault/conflict-policy";
import type { TtsProviderId } from "@/lib/podcast/adapter";

export type Theme = "white" | "sepia" | "dark";
export type Density = "compact" | "normal" | "comfy";
export type Locale = "tr" | "en";
export type AnthropicAuthPreference = "oauth" | "api-key";
export type AiResponseLocale = "tr" | "en" | "follow_source";
export type ReaderWidth = "narrow" | "full";

// Custom endpoints widen the chat surface to user-supplied OpenAI-compat /
// Gemini servers (self-hosted Ollama in a homelab, a private cloud llama.cpp,
// etc). They live in prefs because they are user-specific configuration, not
// secrets — the API key (if any) goes through the encrypted vault under a
// `custom:${id}` provider literal.
export type CustomEndpointFamily = "openai-compat" | "gemini";

export type CustomEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  family: CustomEndpointFamily;
  hasKey: boolean;
  createdAt: number;
};

// Selection layer is pref-state, not chat-state — Settings persist across
// reloads; the chat composer can still override per-call without mutating
// the default. embedPresetId widens to plain string so the runtime can
// accept future preset additions or migration leftovers without losing the
// stored value.
export type ModelBindings = {
  chat: string;
  summary: string;
  quick: string;
  embedPresetId: EmbedPresetId | string;
  flashcardGen: string;
  // Model used by the Roadmap wizard's single-shot generation (and per-node
  // "Create subtasks"). Configured in Settings → Default models so the wizard
  // itself stays a clean Level/Goal step instead of a cramped 3-model picker.
  roadmapGen: string;
  // Article Analysis pipeline — three per-stage model bindings so the cheap,
  // high-volume Map stage and the strong reviewer-lens critic can use
  // different tiers (and so the user can point any stage at an OpenRouter
  // model). All configured in Settings → Default models.
  //   analysisExtract    → Stage 1 Map (per-section summary + quote extraction)
  //   analysisSynthesize → Stage 2 Reduce + Stage 4 final synthesis
  //   analysisCritique   → reviewer-persona critic + threats-to-validity
  analysisExtract: string;
  analysisSynthesize: string;
  analysisCritique: string;
  // Research provider id used by the AddUrl pipeline. Widened to plain
  // string so the store accepts future preset additions or migration
  // leftovers without losing the user's choice.
  researchProvider: ResearchProviderId | string;
};

export const DEFAULT_MODEL_BINDINGS: ModelBindings = {
  chat: "anthropic::claude-sonnet-4-6",
  summary: "anthropic::claude-sonnet-4-6",
  quick: "anthropic::claude-haiku-4-5",
  embedPresetId: "openai-3-small",
  flashcardGen: "anthropic::claude-sonnet-4-6",
  roadmapGen: "anthropic::claude-sonnet-4-6",
  analysisExtract: "anthropic::claude-haiku-4-5",
  analysisSynthesize: "anthropic::claude-sonnet-4-6",
  analysisCritique: "anthropic::claude-sonnet-4-6",
  researchProvider: "readability",
};

// SRS daily caps for the session builder. dailyNew = how many never-reviewed
// cards to mix into today's session; dailyReview = soft ceiling on already-due
// cards. Both clamp to [0, 200] at the action layer to keep the spaced-rep
// loop sane (Anki's defaults are 20/200 for context).
export type SrsPrefs = {
  dailyNew: number;
  dailyReview: number;
};

export const DEFAULT_SRS_PREFS: SrsPrefs = {
  dailyNew: 20,
  dailyReview: 200,
};

// Phase 5.5.C — User-configurable defaults for the chat reader's web-search
// feature. `enabled` is the sticky toggle: in 5.5.C.A it stores the user's
// preferred starting state, in 5.5.C.B the chat composer reads it as the
// initial value for the per-message toggle. `maxUses` / `recencyDays` /
// domain lists are passed through to `getWebSearchAdapter(...).buildToolBlock(opts)`
// at call time via `webSearchPrefsToOptions(...)`. `recencyDays: 0` means "no
// filter" — distinct from a small positive number that would map to hour/day.
export type WebSearchPrefs = {
  enabled: boolean;
  maxUses: number;
  searchMode: "default" | "deep";
  recencyDays: number;
  allowedDomains: string[];
  blockedDomains: string[];
};

export const DEFAULT_WEB_SEARCH_PREFS: WebSearchPrefs = {
  enabled: false,
  maxUses: 5,
  searchMode: "default",
  recencyDays: 0,
  allowedDomains: [],
  blockedDomains: [],
};

const WEB_SEARCH_MAX_USES_MIN = 1;
const WEB_SEARCH_MAX_USES_MAX = 10;
const WEB_SEARCH_RECENCY_MAX = 365;

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function isValidWebSearchPrefs(value: unknown): value is WebSearchPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return false;
  if (typeof r.maxUses !== "number") return false;
  if (r.searchMode !== "default" && r.searchMode !== "deep") return false;
  if (typeof r.recencyDays !== "number") return false;
  if (!Array.isArray(r.allowedDomains)) return false;
  if (!Array.isArray(r.blockedDomains)) return false;
  return true;
}

/**
 * Convert stored prefs into the partial `WebSearchOptions` shape adapters
 * accept. `recencyDays: 0` is dropped (treated as "no filter"); empty domain
 * lists are dropped so adapters don't emit empty arrays into provider
 * payloads (Anthropic returns 400 on `allowed_domains: []`).
 */
export function webSearchPrefsToOptions(prefs: WebSearchPrefs): WebSearchOptions {
  const out: WebSearchOptions = {
    maxUses: prefs.maxUses,
    searchMode: prefs.searchMode,
  };
  if (prefs.recencyDays > 0) out.recencyDays = prefs.recencyDays;
  if (prefs.allowedDomains.length > 0) out.allowedDomains = [...prefs.allowedDomains];
  if (prefs.blockedDomains.length > 0) out.blockedDomains = [...prefs.blockedDomains];
  return out;
}

const SRS_LIMIT_MIN = 0;
const SRS_LIMIT_MAX = 200;

function clampSrsLimit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < SRS_LIMIT_MIN) return SRS_LIMIT_MIN;
  if (n > SRS_LIMIT_MAX) return SRS_LIMIT_MAX;
  return Math.round(n);
}

function isValidSrsPrefs(value: unknown): value is SrsPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.dailyNew === "number" && typeof rec.dailyReview === "number";
}

// Phase 6.4 — Notes folder tree UI state. `expandedFolders` is a flat list of
// folder ids that the user has opened in the sidebar tree. Stored in prefs
// (not Dexie) because it's pure UI state, doesn't need to round-trip in the
// backup payload, and is per-device by intent (the same workspace might want
// different folders open on a phone vs. a laptop).
//
// Phase 6.7 — `dailyTemplate` and `dailyFolderName` extend the same record
// so the "Bugünün notu" button and the Settings preview share one source of
// truth. Empty string means "use the locale-aware default" so a future
// locale flip (TR↔EN) doesn't strand the user with stale copy.
export type NotesUiPrefs = {
  expandedFolders: string[];
  dailyTemplate: string;
  dailyFolderName: string;
};

export const DEFAULT_NOTES_UI_PREFS: NotesUiPrefs = {
  expandedFolders: [],
  dailyTemplate: "",
  dailyFolderName: "",
};

// Validates the v14 (pre-Phase-6.7) shape — only `expandedFolders`. Kept
// permissive so the v14→v15 patch can layer the new fields on top of an
// existing payload without resetting the user's open-folder state.
function isValidNotesUi(value: unknown): value is { expandedFolders: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.expandedFolders)) return false;
  return r.expandedFolders.every((e) => typeof e === "string");
}

// Phase 6.9.5 — Cost guard for note auto-sync. Default cap chosen to roughly
// match "one full re-embed of a ~5000-token note at OpenAI 3-small list price"
// — slightly above so a normal authoring session under the cap, but a
// runaway loop tops out at ~10¢ before the user has to manually approve
// further syncs. Stored as a plain dollar amount; UI formats it.
export type CostPrefs = {
  autoEmbedCap: number;
};

export const DEFAULT_COST_PREFS: CostPrefs = {
  autoEmbedCap: 0.1,
};

function isValidCostPrefs(value: unknown): value is CostPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return typeof r.autoEmbedCap === "number" && Number.isFinite(r.autoEmbedCap);
}

export type CurriculumGenerationPrefs = {
  chunkDetailLevel: CurriculumChunkDetailLevel;
};

export const DEFAULT_CURRICULUM_GENERATION_PREFS: CurriculumGenerationPrefs = {
  chunkDetailLevel: DEFAULT_CURRICULUM_CHUNK_DETAIL,
};

function isValidCurriculumGenerationPrefs(
  value: unknown,
): value is CurriculumGenerationPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return typeof r.chunkDetailLevel === "number";
}

// Phase 7.3 — Filesystem vault sync foundation. `vaultRootPath` is the
// absolute directory the user chose in the setup wizard (or null for
// IndexedDB-only mode). `vaultSetupCompleted` flips true once the user
// has either picked a directory or explicitly clicked "later" — so the
// wizard only nags on first Tauri launch. `vaultAutoSync` lets users
// disable the implicit export-on-change while keeping the path config
// around for manual "Re-export now" usage. All fields safe on web (the
// store ignores them when `isTauriEnv()` is false).
export type VaultPrefs = {
  rootPath: string | null;
  setupCompleted: boolean;
  autoSync: boolean;
  /**
   * Phase 7.4.D — Conflict resolution policy for the two-way file
   * watcher reconciliation. `lww` is last-write-wins (mtime vs
   * updatedAt). `always-disk` forces disk to win even when Dexie is
   * newer. `always-dexie` forces Dexie to win even when disk is newer.
   * Defaults to `lww` for both new installs and v17 upgrades.
   */
  conflictPolicy: ConflictPolicy;
};

export const DEFAULT_VAULT_PREFS: VaultPrefs = {
  rootPath: null,
  setupCompleted: false,
  autoSync: true,
  conflictPolicy: DEFAULT_CONFLICT_POLICY,
};

function isValidVaultPrefs(value: unknown): value is VaultPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (r.rootPath !== null && typeof r.rootPath !== "string") return false;
  if (typeof r.setupCompleted !== "boolean") return false;
  if (typeof r.autoSync !== "boolean") return false;
  if (!isConflictPolicy(r.conflictPolicy)) return false;
  return true;
}

const PREFS_VERSION = 24;

// Phase 11.A — Local-first TTS. `piper` is the default because it ships
// as a Tauri sidecar with a ~63MB Turkish voice (lazy-installed on first
// use). Web builds can pick `web-speech` if they only want live preview.
// The union mirrors `TtsProviderId` from `lib/podcast/adapter.ts`.
const VALID_TTS_PROVIDERS: readonly TtsProviderId[] = [
  "piper",
  "web-speech",
  "kokoro",
  "xtts",
  "vibevoice",
];
const DEFAULT_TTS_PROVIDER: TtsProviderId = "piper";
const VALID_THEMES: readonly Theme[] = ["white", "sepia", "dark"];
const VALID_AI_LOCALES: readonly AiResponseLocale[] = ["tr", "en", "follow_source"];
const VALID_READER_WIDTHS: readonly ReaderWidth[] = ["narrow", "full"];
const MODEL_BINDING_KEYS: readonly (keyof ModelBindings)[] = [
  "chat",
  "summary",
  "quick",
  "embedPresetId",
  "flashcardGen",
  "roadmapGen",
  "analysisExtract",
  "analysisSynthesize",
  "analysisCritique",
  "researchProvider",
];

function isValidModelBindings(value: unknown): value is ModelBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  for (const k of MODEL_BINDING_KEYS) {
    if (typeof rec[k] !== "string") return false;
  }
  return true;
}

// Exported so the migration is unit-testable without spinning up Zustand's
// persist middleware. Keeps the migrate path declarative and side-effect free.
export function migratePrefs(
  persistedState: unknown,
  version: number,
): PrefsState {
  if (!persistedState || typeof persistedState !== "object") {
    return persistedState as PrefsState;
  }
  const next = { ...(persistedState as Record<string, unknown>) };
  if (version < 2) {
    next.preferredAnthropicAuth = "oauth" satisfies AnthropicAuthPreference;
  }
  if (version < 3) {
    next.strictAnthropicAuth = false;
  }
  if (version < 4 && next.theme === "dark") {
    next.theme = "white" satisfies Theme;
  }
  if (version < 5) {
    if (next.theme === "light") next.theme = "white" satisfies Theme;
    if (typeof next.themeFollowsSystem !== "boolean") {
      next.themeFollowsSystem = false;
    }
  }
  if (version < 6) {
    if (
      typeof next.aiResponseLocale !== "string" ||
      !VALID_AI_LOCALES.includes(next.aiResponseLocale as AiResponseLocale)
    ) {
      next.aiResponseLocale = "follow_source" satisfies AiResponseLocale;
    }
  }
  if (version < 7) {
    if (!Array.isArray(next.customEndpoints)) {
      next.customEndpoints = [];
    }
  }
  if (version < 8) {
    // Accept both the v8-shape (5 keys, no researchProvider) and the v11
    // strict shape — the v11 branch below upgrades legacy bindings if needed
    // so this branch only has to guard against truly broken state.
    if (
      !isLegacyModelBindings(next.modelBindings) &&
      !isValidModelBindings(next.modelBindings)
    ) {
      next.modelBindings = { ...DEFAULT_MODEL_BINDINGS };
    }
  }
  if (version < 9) {
    if (!isValidSrsPrefs(next.srs)) {
      next.srs = { ...DEFAULT_SRS_PREFS };
    } else {
      const cur = next.srs as SrsPrefs;
      next.srs = {
        dailyNew: clampSrsLimit(cur.dailyNew),
        dailyReview: clampSrsLimit(cur.dailyReview),
      };
    }
  }
  if (version < 10) {
    if (
      typeof next.readerWidth !== "string" ||
      !VALID_READER_WIDTHS.includes(next.readerWidth as ReaderWidth)
    ) {
      next.readerWidth = "narrow" satisfies ReaderWidth;
    }
  }
  if (version < 11) {
    // Three-way branch ordered most-specific-first: full v11 shape stays
    // untouched, v8 shape gets researchProvider patched in, anything else
    // is reset to defaults.
    if (isValidModelBindings(next.modelBindings)) {
      // already v11 — no-op
    } else if (isLegacyModelBindings(next.modelBindings)) {
      next.modelBindings = {
        ...(next.modelBindings as Record<string, unknown>),
        researchProvider: "readability",
      };
    } else {
      next.modelBindings = { ...DEFAULT_MODEL_BINDINGS };
    }
  }
  if (version < 12) {
    // Phase 5.5.C — additive: webSearchPrefs default-seeded. Pre-existing
    // shapes (rare in the wild, but possible for users who hand-edited the
    // localStorage payload) get clamped to the published ranges so the
    // Settings sliders never read a wild value.
    if (isValidWebSearchPrefs(next.webSearchPrefs)) {
      const cur = next.webSearchPrefs;
      next.webSearchPrefs = {
        enabled: cur.enabled,
        maxUses: clampInt(
          cur.maxUses,
          WEB_SEARCH_MAX_USES_MIN,
          WEB_SEARCH_MAX_USES_MAX,
          DEFAULT_WEB_SEARCH_PREFS.maxUses,
        ),
        searchMode: cur.searchMode,
        recencyDays: clampInt(cur.recencyDays, 0, WEB_SEARCH_RECENCY_MAX, 0),
        allowedDomains: cur.allowedDomains.filter(
          (d) => typeof d === "string" && d.trim().length > 0,
        ),
        blockedDomains: cur.blockedDomains.filter(
          (d) => typeof d === "string" && d.trim().length > 0,
        ),
      };
    } else {
      next.webSearchPrefs = { ...DEFAULT_WEB_SEARCH_PREFS };
    }
  }
  if (version < 13) {
    // Phase 5.5.G — additive: priority chain for the "Konu ara" modal.
    // Existing users keep the pre-5.5.G behaviour (Brave-only); new entries
    // can be added via Settings → Models → Search providers.
    if (isValidSearchProviders(next.searchProviders)) {
      // Already populated — leave the user's order untouched. Deduplicate
      // by id (in case a previous build emitted a duplicate entry).
      const seen = new Set<string>();
      const cur = next.searchProviders as SearchProviderEntry[];
      next.searchProviders = cur.filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      });
    } else {
      next.searchProviders = DEFAULT_SEARCH_PROVIDERS.map((e) => ({ ...e }));
    }
  }
  if (version < 14) {
    // Phase 6.4 — additive: notesUi state for folder tree (expanded folder
    // ids). Existing users get the empty default (everything collapsed) so
    // first paint after upgrade matches first paint for new installs. Any
    // hand-edited / partially-typed payload is reset to defaults — this
    // surface has no user-tunable knobs that would survive a bad shape.
    if (isValidNotesUi(next.notesUi)) {
      // Already populated — dedupe ids in place to keep the list compact.
      const cur = next.notesUi;
      const seen = new Set<string>();
      next.notesUi = {
        expandedFolders: cur.expandedFolders.filter((id) => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }),
      };
    } else {
      next.notesUi = { expandedFolders: [] };
    }
  }
  if (version < 15) {
    // Phase 6.7 — additive: dailyTemplate + dailyFolderName layered on top
    // of the v14 notesUi shape. Patches missing keys rather than resetting
    // the whole record so an upgrading user keeps their open-folder state.
    // Empty-string defaults mean "fall back to the locale-aware default at
    // use-time" — a future locale change therefore swaps TR↔EN copy without
    // requiring the user to reset anything.
    const cur = next.notesUi;
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      const obj = cur as Record<string, unknown>;
      next.notesUi = {
        expandedFolders: Array.isArray(obj.expandedFolders)
          ? (obj.expandedFolders as unknown[]).filter(
              (e): e is string => typeof e === "string",
            )
          : [],
        dailyTemplate:
          typeof obj.dailyTemplate === "string" ? obj.dailyTemplate : "",
        dailyFolderName:
          typeof obj.dailyFolderName === "string" ? obj.dailyFolderName : "",
      };
    } else {
      next.notesUi = { ...DEFAULT_NOTES_UI_PREFS };
    }
  }
  if (version < 16) {
    // Phase 6.9.5 — additive: costPrefs.autoEmbedCap for the notes auto-sync
    // guard. Clamp to ≥ 0 so a hand-edited negative value can't cause the
    // guard to flip inverted ("any cost is over the cap").
    if (isValidCostPrefs(next.costPrefs)) {
      const cur = next.costPrefs;
      next.costPrefs = {
        autoEmbedCap: cur.autoEmbedCap < 0 ? 0 : cur.autoEmbedCap,
      };
    } else {
      next.costPrefs = { ...DEFAULT_COST_PREFS };
    }
  }
  if (version < 17) {
    // Phase 7.3 — additive: vault prefs for the Tauri filesystem sync.
    // Web users keep the default (null path, setupCompleted:false, autoSync:on)
    // and the Tauri-only setup wizard takes it from there on first launch.
    // v17 payloads predate `conflictPolicy`; the v18 step below seeds it.
    if (isValidVaultPrefs(next.vault)) {
      const cur = next.vault;
      next.vault = {
        rootPath:
          typeof cur.rootPath === "string" && cur.rootPath.length === 0
            ? null
            : cur.rootPath,
        setupCompleted: cur.setupCompleted,
        autoSync: cur.autoSync,
        conflictPolicy: cur.conflictPolicy,
      };
    } else if (
      next.vault &&
      typeof next.vault === "object" &&
      !Array.isArray(next.vault)
    ) {
      // Pre-v18 shape — valid keys minus conflictPolicy. Patch additively
      // instead of resetting so the user's path/setupCompleted/autoSync
      // survive the version bump.
      const cur = next.vault as Record<string, unknown>;
      next.vault = {
        rootPath:
          typeof cur.rootPath === "string" && cur.rootPath.length > 0
            ? cur.rootPath
            : null,
        setupCompleted: cur.setupCompleted === true,
        autoSync: cur.autoSync !== false,
        conflictPolicy: DEFAULT_CONFLICT_POLICY,
      };
    } else {
      next.vault = { ...DEFAULT_VAULT_PREFS };
    }
  }
  if (version < 19) {
    // Phase 11.A — additive: ttsProvider + podcastFeatureEnabled.
    // ElevenLabs removed; default flips to local-first Piper. Users who
    // hand-edited their prefs to a stale value get coerced back to the
    // default rather than silently failing on a missing adapter.
    if (
      typeof next.ttsProvider !== "string" ||
      !VALID_TTS_PROVIDERS.includes(next.ttsProvider as TtsProviderId)
    ) {
      next.ttsProvider = DEFAULT_TTS_PROVIDER;
    }
    if (typeof next.podcastFeatureEnabled !== "boolean") {
      next.podcastFeatureEnabled = true;
    }
  }
  if (version < 20) {
    if (isValidCurriculumGenerationPrefs(next.curriculumGeneration)) {
      const cur = next.curriculumGeneration;
      next.curriculumGeneration = {
        chunkDetailLevel: clampCurriculumChunkDetail(cur.chunkDetailLevel),
      };
    } else {
      next.curriculumGeneration = { ...DEFAULT_CURRICULUM_GENERATION_PREFS };
    }
  }
  if (version < 18) {
    // Phase 7.4.D — additive: conflictPolicy on VaultPrefs.
    // For v17 payloads (vault was valid back then) the field is missing —
    // patch it onto whatever the user currently has rather than resetting
    // the whole vault slice (rootPath / setupCompleted / autoSync survive).
    if (
      next.vault &&
      typeof next.vault === "object" &&
      !Array.isArray(next.vault)
    ) {
      const cur = next.vault as Record<string, unknown>;
      if (!isConflictPolicy(cur.conflictPolicy)) {
        next.vault = {
          ...cur,
          conflictPolicy: DEFAULT_CONFLICT_POLICY,
        } as VaultPrefs;
      }
    } else {
      next.vault = { ...DEFAULT_VAULT_PREFS };
    }
  }
  if (!VALID_THEMES.includes(next.theme as Theme)) {
    next.theme = "white" satisfies Theme;
  }
  if (version < 21) {
    // Roadmap gets its own default-model binding (Settings → Default models).
    // Backfill from `summary` (a balanced model) so existing users keep a
    // sensible default and a valid bindings object — without this, the newly
    // required `roadmapGen` key would fail isValidModelBindings and reset all
    // bindings to defaults.
    if (next.modelBindings && typeof next.modelBindings === "object") {
      const mb = next.modelBindings as Record<string, unknown>;
      if (typeof mb.roadmapGen !== "string") {
        mb.roadmapGen =
          typeof mb.summary === "string"
            ? mb.summary
            : DEFAULT_MODEL_BINDINGS.roadmapGen;
      }
    }
  }
  if (version < 22) {
    // Gemini text-embedding-004 was RETIRED 2026-01-14 (now 404). Migrate the
    // `gemini-004` embed binding to the GA gemini-embedding-2 so new embeds
    // don't fail. (gemini-embedding-001 / `gemini-001` is deprecated but still
    // works + has an incompatible space, so it is intentionally NOT migrated.)
    if (next.modelBindings && typeof next.modelBindings === "object") {
      const mb = next.modelBindings as Record<string, unknown>;
      if (mb.embedPresetId === "gemini-004") {
        mb.embedPresetId = "gemini-embed-2";
      }
    }
  }
  if (version < 23) {
    // Additive: opt-in auto-check for desktop updates on launch (Tauri only).
    if (typeof next.autoCheckUpdates !== "boolean") {
      next.autoCheckUpdates = true;
    }
  }
  if (version < 24) {
    // Article Analysis gets three per-stage default-model bindings
    // (Settings → Default models). Backfill each from a sensible sibling tier
    // — extract from `quick` (cheap/Haiku), synthesize + critique from
    // `summary` (balanced/Sonnet) — else the per-key default. Without this,
    // the newly required keys would fail isValidModelBindings and reset ALL
    // bindings to defaults. Same shape as the v21 roadmapGen branch.
    if (next.modelBindings && typeof next.modelBindings === "object") {
      const mb = next.modelBindings as Record<string, unknown>;
      if (typeof mb.analysisExtract !== "string") {
        mb.analysisExtract =
          typeof mb.quick === "string"
            ? mb.quick
            : DEFAULT_MODEL_BINDINGS.analysisExtract;
      }
      if (typeof mb.analysisSynthesize !== "string") {
        mb.analysisSynthesize =
          typeof mb.summary === "string"
            ? mb.summary
            : DEFAULT_MODEL_BINDINGS.analysisSynthesize;
      }
      if (typeof mb.analysisCritique !== "string") {
        mb.analysisCritique =
          typeof mb.summary === "string"
            ? mb.summary
            : DEFAULT_MODEL_BINDINGS.analysisCritique;
      }
    }
  }
  return next as PrefsState;
}

// Pre-v11 ModelBindings shape (no researchProvider). Used by the v11
// migration to detect "looks like a valid bindings object but is missing the
// new field" so we can patch instead of resetting all five keys.
function isLegacyModelBindings(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.chat === "string" &&
    typeof rec.summary === "string" &&
    typeof rec.quick === "string" &&
    typeof rec.embedPresetId === "string" &&
    typeof rec.flashcardGen === "string"
  );
}

type PrefsState = {
  theme: Theme;
  themeFollowsSystem: boolean;
  density: Density;
  locale: Locale;
  preferredAnthropicAuth: AnthropicAuthPreference;
  strictAnthropicAuth: boolean;
  aiResponseLocale: AiResponseLocale;
  customEndpoints: CustomEndpoint[];
  modelBindings: ModelBindings;
  srs: SrsPrefs;
  readerWidth: ReaderWidth;
  webSearchPrefs: WebSearchPrefs;
  /**
   * Phase 5.5.G — ordered priority chain of search backends for the "Konu
   * ara" modal. The first enabled entry whose API key is available wins;
   * subsequent entries act as fallbacks on error / empty result.
   */
  searchProviders: SearchProviderEntry[];
  /**
   * Phase 6.4 — Notes folder tree UI state. Per-device (the same workspace
   * may want different folders open on phone vs. laptop), so it lives in
   * prefs rather than Dexie or the backup payload.
   */
  notesUi: NotesUiPrefs;
  /**
   * Phase 6.9.5 — Cost guard for note auto-sync. `autoEmbedCap` is the USD
   * ceiling per debounced sync — over the cap, the auto-sync timer skips
   * and surfaces a "manual sync required" toast.
   */
  costPrefs: CostPrefs;
  /**
   * Phase 7.3 — Filesystem vault sync. `rootPath` is the absolute directory
   * the user chose during the Tauri setup wizard (null = IndexedDB-only).
   * Web users keep the defaults; the Tauri-only wizard manages the lifecycle.
   */
  vault: VaultPrefs;
  /**
   * Phase 11.A — Active TTS provider for podcast synthesis. Defaults to
   * `piper` (local sidecar). The Settings → Modeller panel will surface
   * a dropdown in Phase 11.C; until then the user can flip the value
   * via `setTtsProvider`.
   */
  ttsProvider: TtsProviderId;
  /**
   * Phase 11.A — Master toggle for the podcast / audio surface. Off
   * removes the sidebar entry and gates the modal so users who don't
   * want TTS at all can hide the feature.
   */
  podcastFeatureEnabled: boolean;
  /** When true (desktop only), silently check GitHub Releases for a newer
   *  build on launch and toast if one is found. Never auto-installs. */
  autoCheckUpdates: boolean;
  curriculumGeneration: CurriculumGenerationPrefs;
  setTheme: (theme: Theme) => void;
  setThemeFollowsSystem: (follow: boolean) => void;
  setDensity: (density: Density) => void;
  setLocale: (locale: Locale) => void;
  setPreferredAnthropicAuth: (preference: AnthropicAuthPreference) => void;
  setStrictAnthropicAuth: (strict: boolean) => void;
  setAiResponseLocale: (value: AiResponseLocale) => void;
  addCustomEndpoint: (endpoint: CustomEndpoint) => void;
  removeCustomEndpoint: (id: string) => void;
  setCustomEndpointHasKey: (id: string, hasKey: boolean) => void;
  setModelBinding: (task: keyof ModelBindings, value: string) => void;
  setSrsDailyLimit: (key: keyof SrsPrefs, value: number) => void;
  setReaderWidth: (value: ReaderWidth) => void;
  setWebSearchPrefs: (patch: Partial<WebSearchPrefs>) => void;
  /** Replace the entire ordered search-provider priority list. */
  setSearchProviders: (list: SearchProviderEntry[]) => void;
  /** Append a provider to the end of the list with `enabled: true`. No-op if already present. */
  addSearchProvider: (id: string) => void;
  /** Remove a provider from the list. No-op if absent. */
  removeSearchProvider: (id: string) => void;
  /** Toggle the enabled flag for a single entry. No-op if absent. */
  setSearchProviderEnabled: (id: string, enabled: boolean) => void;
  /** Reorder a single entry to a new index (0-based). Clamps to bounds. */
  reorderSearchProvider: (id: string, newIndex: number) => void;
  /**
   * Set / patch the per-entry config for a search provider. Currently only
   * `openrouter-search` reads `config.modelId`; the action stays generic so
   * future per-provider overrides can reuse it. Pass `modelId: ""` (or
   * `undefined`) to clear back to the catalog default.
   */
  setSearchProviderConfig: (
    id: string,
    patch: { modelId?: string | undefined },
  ) => void;
  /** Toggle the expanded state for a single folder id. */
  toggleNotesFolderExpanded: (folderId: string) => void;
  /** Force-set the expanded state for a folder id. */
  setNotesFolderExpanded: (folderId: string, expanded: boolean) => void;
  /** Replace the entire expanded-folder list (used by "Collapse all"). */
  setNotesExpandedFolders: (ids: string[]) => void;
  /** Phase 6.7 — set the daily-note template (empty = use locale default). */
  setNotesDailyTemplate: (template: string) => void;
  /** Phase 6.7 — set the daily-note folder name (empty = use locale default). */
  setNotesDailyFolderName: (name: string) => void;
  /** Phase 6.7 — clear template + folder name back to locale defaults. */
  resetNotesDailyDefaults: () => void;
  /** Phase 6.9.5 — set the auto-embed USD cost cap (clamps to ≥ 0). */
  setAutoEmbedCap: (value: number) => void;
  /** Phase 7.3 — set the vault root directory (null = clear). */
  setVaultRootPath: (path: string | null) => void;
  /** Phase 7.3 — mark setup complete so the wizard stops nagging. */
  setVaultSetupCompleted: (value: boolean) => void;
  /** Phase 7.3 — toggle implicit auto-sync (keep path, suspend writes). */
  setVaultAutoSync: (value: boolean) => void;
  /** Phase 7.4.D — set the watcher conflict resolution policy. */
  setVaultConflictPolicy: (policy: ConflictPolicy) => void;
  /** Phase 7.3 — clear vault prefs back to defaults (e.g. "Disable vault"). */
  resetVault: () => void;
  /** Phase 11.A — set active TTS provider (validated against the registry). */
  setTtsProvider: (provider: TtsProviderId) => void;
  /** Phase 11.A — toggle whether the podcast feature surface is shown at all. */
  setPodcastFeatureEnabled: (value: boolean) => void;
  setAutoCheckUpdates: (value: boolean) => void;
  setCurriculumChunkDetail: (value: number) => void;
};

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "white";
}

function syncHtmlAttr(attr: string, value: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(attr, value);
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "dark",
      themeFollowsSystem: false,
      density: "normal",
      locale: "tr",
      preferredAnthropicAuth: "oauth",
      strictAnthropicAuth: false,
      aiResponseLocale: "follow_source",
      customEndpoints: [],
      modelBindings: { ...DEFAULT_MODEL_BINDINGS },
      srs: { ...DEFAULT_SRS_PREFS },
      readerWidth: "narrow",
      webSearchPrefs: { ...DEFAULT_WEB_SEARCH_PREFS },
      searchProviders: DEFAULT_SEARCH_PROVIDERS.map((e) => ({ ...e })),
      notesUi: { ...DEFAULT_NOTES_UI_PREFS },
      costPrefs: { ...DEFAULT_COST_PREFS },
      vault: { ...DEFAULT_VAULT_PREFS },
      ttsProvider: DEFAULT_TTS_PROVIDER,
      podcastFeatureEnabled: true,
      autoCheckUpdates: true,
      curriculumGeneration: { ...DEFAULT_CURRICULUM_GENERATION_PREFS },
      setTheme: (theme) => {
        set({ theme, themeFollowsSystem: false });
        syncHtmlAttr("data-theme", theme);
      },
      setThemeFollowsSystem: (follow) => {
        set({ themeFollowsSystem: follow });
        if (follow) {
          const sys = getSystemTheme();
          set({ theme: sys });
          syncHtmlAttr("data-theme", sys);
        }
      },
      setDensity: (density) => {
        set({ density });
        syncHtmlAttr("data-density", density);
      },
      setLocale: (locale) => {
        set({ locale });
        syncHtmlAttr("lang", locale);
      },
      setPreferredAnthropicAuth: (preference) => {
        set({ preferredAnthropicAuth: preference });
      },
      setStrictAnthropicAuth: (strict) => {
        set({ strictAnthropicAuth: strict });
      },
      setAiResponseLocale: (value) => {
        set({ aiResponseLocale: value });
      },
      addCustomEndpoint: (endpoint) => {
        set((s) => ({ customEndpoints: [...s.customEndpoints, endpoint] }));
      },
      removeCustomEndpoint: (id) => {
        set((s) => ({
          customEndpoints: s.customEndpoints.filter((e) => e.id !== id),
        }));
      },
      setCustomEndpointHasKey: (id, hasKey) => {
        set((s) => ({
          customEndpoints: s.customEndpoints.map((e) =>
            e.id === id ? { ...e, hasKey } : e,
          ),
        }));
      },
      setModelBinding: (task, value) => {
        set((s) => ({
          modelBindings: { ...s.modelBindings, [task]: value },
        }));
      },
      setSrsDailyLimit: (key, value) => {
        set((s) => ({
          srs: { ...s.srs, [key]: clampSrsLimit(value) },
        }));
      },
      setReaderWidth: (value) => {
        set({ readerWidth: value });
      },
      setWebSearchPrefs: (patch) => {
        set((s) => {
          const merged: WebSearchPrefs = { ...s.webSearchPrefs, ...patch };
          // Re-clamp on every update so a Settings slider can't push past
          // the published range, and so domain textareas can't persist
          // whitespace-only entries.
          return {
            webSearchPrefs: {
              enabled: merged.enabled,
              maxUses: clampInt(
                merged.maxUses,
                WEB_SEARCH_MAX_USES_MIN,
                WEB_SEARCH_MAX_USES_MAX,
                DEFAULT_WEB_SEARCH_PREFS.maxUses,
              ),
              searchMode: merged.searchMode,
              recencyDays: clampInt(
                merged.recencyDays,
                0,
                WEB_SEARCH_RECENCY_MAX,
                0,
              ),
              allowedDomains: merged.allowedDomains
                .map((d) => (typeof d === "string" ? d.trim() : ""))
                .filter((d) => d.length > 0),
              blockedDomains: merged.blockedDomains
                .map((d) => (typeof d === "string" ? d.trim() : ""))
                .filter((d) => d.length > 0),
            },
          };
        });
      },
      setSearchProviders: (list) => {
        // Dedupe by id, preserve order. Invalid entries (non-object, missing
        // fields) are dropped silently — UI is the source of correctness.
        const seen = new Set<string>();
        const clean = list.filter((e) => {
          if (!e || typeof e.id !== "string" || e.id.length === 0) return false;
          if (typeof e.enabled !== "boolean") return false;
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });
        set({ searchProviders: clean });
      },
      addSearchProvider: (id) => {
        set((s) => {
          if (s.searchProviders.some((e) => e.id === id)) return s;
          return {
            searchProviders: [
              ...s.searchProviders,
              { id, enabled: true },
            ],
          };
        });
      },
      removeSearchProvider: (id) => {
        set((s) => ({
          searchProviders: s.searchProviders.filter((e) => e.id !== id),
        }));
      },
      setSearchProviderEnabled: (id, enabled) => {
        set((s) => ({
          searchProviders: s.searchProviders.map((e) =>
            e.id === id ? { ...e, enabled } : e,
          ),
        }));
      },
      reorderSearchProvider: (id, newIndex) => {
        set((s) => {
          const idx = s.searchProviders.findIndex((e) => e.id === id);
          if (idx === -1) return s;
          const next = s.searchProviders.slice();
          const [entry] = next.splice(idx, 1);
          if (!entry) return s;
          const clamped = Math.max(0, Math.min(newIndex, next.length));
          next.splice(clamped, 0, entry);
          return { searchProviders: next };
        });
      },
      setSearchProviderConfig: (id, patch) => {
        set((s) => ({
          searchProviders: s.searchProviders.map((e) => {
            if (e.id !== id) return e;
            const cur = e.config ?? {};
            const nextCfg: SearchProviderEntryConfig = { ...cur };
            if ("modelId" in patch) {
              const v = patch.modelId;
              if (typeof v === "string" && v.trim().length > 0) {
                nextCfg.modelId = v.trim();
              } else {
                delete nextCfg.modelId;
              }
            }
            // If config has no keys left, drop the field entirely so the
            // persisted shape stays minimal.
            if (Object.keys(nextCfg).length === 0) {
              const { config: _drop, ...rest } = e;
              void _drop;
              return rest;
            }
            return { ...e, config: nextCfg };
          }),
        }));
      },
      toggleNotesFolderExpanded: (folderId) => {
        set((s) => {
          const cur = s.notesUi.expandedFolders;
          const has = cur.includes(folderId);
          return {
            notesUi: {
              ...s.notesUi,
              expandedFolders: has
                ? cur.filter((id) => id !== folderId)
                : [...cur, folderId],
            },
          };
        });
      },
      setNotesFolderExpanded: (folderId, expanded) => {
        set((s) => {
          const cur = s.notesUi.expandedFolders;
          const has = cur.includes(folderId);
          if (expanded === has) return s;
          return {
            notesUi: {
              ...s.notesUi,
              expandedFolders: expanded
                ? [...cur, folderId]
                : cur.filter((id) => id !== folderId),
            },
          };
        });
      },
      setNotesExpandedFolders: (ids) => {
        // Dedupe + drop empty entries; UI is the source of correctness.
        const seen = new Set<string>();
        const clean = ids.filter((id) => {
          if (typeof id !== "string" || id.length === 0) return false;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        set((s) => ({ notesUi: { ...s.notesUi, expandedFolders: clean } }));
      },
      setNotesDailyTemplate: (template) => {
        set((s) => ({
          notesUi: { ...s.notesUi, dailyTemplate: template },
        }));
      },
      setNotesDailyFolderName: (name) => {
        set((s) => ({
          notesUi: { ...s.notesUi, dailyFolderName: name },
        }));
      },
      resetNotesDailyDefaults: () => {
        set((s) => ({
          notesUi: { ...s.notesUi, dailyTemplate: "", dailyFolderName: "" },
        }));
      },
      setAutoEmbedCap: (value) => {
        const clamped =
          !Number.isFinite(value) || value < 0 ? 0 : value;
        set((s) => ({ costPrefs: { ...s.costPrefs, autoEmbedCap: clamped } }));
      },
      setVaultRootPath: (path) => {
        const next: string | null =
          typeof path === "string" && path.trim().length > 0
            ? path.trim()
            : null;
        set((s) => ({ vault: { ...s.vault, rootPath: next } }));
      },
      setVaultSetupCompleted: (value) => {
        set((s) => ({ vault: { ...s.vault, setupCompleted: value } }));
      },
      setVaultAutoSync: (value) => {
        set((s) => ({ vault: { ...s.vault, autoSync: value } }));
      },
      setVaultConflictPolicy: (policy) => {
        const safe: ConflictPolicy = isConflictPolicy(policy)
          ? policy
          : DEFAULT_CONFLICT_POLICY;
        set((s) => ({ vault: { ...s.vault, conflictPolicy: safe } }));
      },
      resetVault: () => {
        set({ vault: { ...DEFAULT_VAULT_PREFS } });
      },
      setTtsProvider: (provider) => {
        const safe: TtsProviderId = VALID_TTS_PROVIDERS.includes(provider)
          ? provider
          : DEFAULT_TTS_PROVIDER;
        set({ ttsProvider: safe });
      },
      setPodcastFeatureEnabled: (value) => {
        set({ podcastFeatureEnabled: value });
      },
      setAutoCheckUpdates: (value) => {
        set({ autoCheckUpdates: value });
      },
      setCurriculumChunkDetail: (value) => {
        set((s) => ({
          curriculumGeneration: {
            ...s.curriculumGeneration,
            chunkDetailLevel: clampCurriculumChunkDetail(value),
          },
        }));
      },
    }),
    {
      name: "tme:prefs",
      version: PREFS_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => migratePrefs(persistedState, version),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const effective: Theme = state.themeFollowsSystem
          ? getSystemTheme()
          : state.theme;
        syncHtmlAttr("data-theme", effective);
        syncHtmlAttr("data-density", state.density);
        syncHtmlAttr("lang", state.locale);

        if (typeof window !== "undefined") {
          const mq = window.matchMedia("(prefers-color-scheme: dark)");
          const handler = (event: MediaQueryListEvent): void => {
            const cur = usePrefs.getState();
            if (!cur.themeFollowsSystem) return;
            const sys: Theme = event.matches ? "dark" : "white";
            usePrefs.setState({ theme: sys });
            syncHtmlAttr("data-theme", sys);
          };
          mq.addEventListener("change", handler);
        }
      },
    },
  ),
);

// Imperative helper for non-React callers (registry.ts) that need to look up
// a custom endpoint by id without subscribing to the store. Returns undefined
// during SSR or when the store has not rehydrated yet.
export function findCustomEndpoint(id: string): CustomEndpoint | undefined {
  return usePrefs.getState().customEndpoints.find((e) => e.id === id);
}
