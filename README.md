# Teach Me Everything

[Türkçe sürüm](README.tr.md)

A local-first learning app. Import your own PDFs, DOCX files, Markdown, text, and notes, then turn them into workspaces, source reading flows, AI-assisted chat, flashcards, quizzes, mind maps, and guided study sessions.

## Features

- Workspace-based source management
- PDF, DOCX, Markdown, and plain text import
- Chunking, embeddings, and citation-aware AI chat over sources
- Flashcard generation, SM-2 spaced repetition, and leech tracking
- Quiz sessions and answer evaluation
- Concept extraction and mind map view
- Guided study and lesson note records
- Backup and restore flow
- English / Turkish UI
- Local data storage with Dexie / IndexedDB
- BYOK API keys stored in the OS keychain on desktop (Tauri); the web build is for local development only

## Stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 16 App Router |
| Language | TypeScript |
| UI | React 19, Tailwind CSS v4, lucide-react |
| State | Zustand |
| Persistence | Dexie.js / IndexedDB |
| i18n | next-intl |
| AI Providers | Anthropic, OpenAI-compatible providers, Gemini, and other preset providers |

## Setup

Node.js 20 or newer is required.

```bash
npm install
npm run dev
```

The app runs at:

```text
http://localhost:3000
```

For a production build:

```bash
npm run build
npm run start
```

## API Key Storage

BYOK (bring your own key): the app never writes API keys to a `.env` file. Where a key lives depends on the build.

### Desktop build (Tauri) — recommended

API keys are stored in the OS-native credential store — macOS Keychain, Windows Credential Manager, or Linux Secret Service — under the service identifier `com.tme.byok`. There is no master password: your OS login session plus disk encryption (FileVault / BitLocker / LUKS) provide the protection layer.

### Web build (browser) — development only

The web build is intended for local development, not for storing long-lived secrets. Keys you enter are written **in plaintext** to the Dexie `apiKeys` table in browser IndexedDB — there is no master password and no browser-side encryption. Use the desktop build for day-to-day use.

Backup export deliberately excludes the API key table on both builds.

## Desktop build (Tauri)

The desktop app is the primary distribution target (via GitHub Releases). The web build is for local development only.

```bash
npm run tauri:dev     # run the desktop app in dev
npm run tauri:build   # build a desktop binary
```

## Repository Scope

The repository ships the app source (`src/`), the Tauri desktop shell (`src-tauri/`), the test suites + their config, and the CI workflows. Excluded from git: local working files, agent configs (`CLAUDE.md`, `AGENTS.md`), internal notes (`docs/`), build output, caches, large prebuilt binaries (e.g. the Piper TTS sidecar, fetched at build time), and any secret files.

## Commands

```bash
npm run dev          # web dev server (http://localhost:3000)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test:run     # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright)
```

## License

MIT — see [LICENSE](LICENSE).

The desktop build bundles a local text-to-speech engine (Piper). Bundled third-party components and their licenses — including **espeak-ng (GPL-3.0)** — are listed in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
