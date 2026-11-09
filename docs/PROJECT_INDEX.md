# Teach Me Everything (TME) — Proje Dizini

Üst düzey envanter: proje nedir, hangi sayfalar var, hangi terimler ne anlama gelir, güncel sürümler. Sayfa ayrıntıları için [FEATURES.md](FEATURES.md), dosya düzeyinde haritalar için [CODEMAPS](CODEMAPS/architecture.md) kullanın.

## Nedir

TME, aktif öğrenmeye odaklı, yerel öncelikli bir çalışma alanı uygulamasıdır. Kullanıcı PDF, DOCX, URL, arXiv, YouTube veya not ekler; AI ile sohbet eder, flashcard (SM-2), quiz, zihin haritası, iki sunuculu podcast, rehberli müfredat, roadmap ve çok aşamalı makale analizi üretir.

İlkeler:

- **Yerel öncelikli:** tüm veri cihazda (IndexedDB / Dexie). Sunucu veya bulut veritabanı yok.
- **BYOK:** AI anahtarlarını kullanıcı getirir. Tauri'de OS keychain'de, web (yalnız geliştirme) modunda Dexie'de tutulur.
- **Bulut dağıtımı yok:** yalnız Tauri masaüstü uygulaması, GitHub Releases üzerinden. Telemetri yok.
- **TR / EN:** her kullanıcı metni `messages/{tr,en}.json` üzerinden; Türkçe birinci sınıf dildir.
- **Lisans:** MIT ([LICENSE](../LICENSE)).

## Yığın

Next.js 16 (App Router) + React 19 + TypeScript strict · Tailwind v4 (4 tema, `data-theme`) · Zustand · Dexie 4 · Zod 4 · next-intl · CodeMirror 6 · pdfjs-dist, mammoth · Tauri 2 (Rust, `src-tauri/`) · Vitest + Playwright. Ayrıntı: [dependencies](CODEMAPS/dependencies.md), [ARCHITECTURE.md](ARCHITECTURE.md).

## Sürümler

| Ne | Değer | Nerede |
|---|---|---|
| Uygulama | 1.0.0 | `package.json` `version`, `src-tauri/tauri.conf.json` `version` |
| Dexie şeması | v30 | `src/lib/db/schema.ts`, en yüksek `this.version(30)` |
| Tercihler (persist) | 26 | `PREFS_VERSION`, `src/stores/prefs.ts` |
| Yedek biçimi | 11 | `BACKUP_SCHEMA_VERSION`, `src/lib/backup/export.ts` |

## Sayfalar

`src/app` altındaki tüm `page.tsx` dosyaları. `/w/[id]/...` rotalarının statik export davranışı için [STATIC_EXPORT_WORKSPACE_ROUTING.md](STATIC_EXPORT_WORKSPACE_ROUTING.md).

| Rota | Amaç |
|---|---|
| `/` | Giriş sayfası; ilk çalıştırmada kuruluma yönlendirir |
| `/setup/[step]` | 4 adımlı kurulum sihirbazı (`/setup/1` ... `/setup/4`) |
| `/dashboard` | Çalışma alanlarına genel bakış ve hızlı eylemler |
| `/workspaces` | Çalışma alanı listesi ve yönetimi |
| `/settings` | Sağlayıcılar, anahtarlar, model bağlamaları, yedek, vault, tercihler |
| `/w/[id]` | Çalışma alanı ana sayfası: kaynaklar ve kısayollar |
| `/w/[id]/read/[sourceId]` | Kaynak okuyucu + kaynak sohbeti, vurgular |
| `/w/[id]/chat` | Çok kaynaklı çalışma alanı sohbeti (RAG) |
| `/w/[id]/notes` | Not editörü (wikilink, günlük not, klasörler) |
| `/w/[id]/cards` | Flashcard tekrarı (SM-2) |
| `/w/[id]/quiz` | Quiz oturumları |
| `/w/[id]/map` | Kavram zihin haritası |
| `/w/[id]/research` | Literatür araması ve sentez; sonuçlar kaynak olarak içe aktarılır |
| `/w/[id]/study/[lessonId]` | Müfredat dersi |
| `/w/[id]/study/journal` | Çalışma günlüğü |
| `/w/[id]/audio/[podcastId]` | Podcast oynatıcı |
| `/w/[id]/roadmap` | Roadmap listesi |
| `/w/[id]/roadmap/[roadmapId]` | Roadmap tuvali (ön koşul grafı) |
| `/w/[id]/analysis` | Makale analizi listesi |
| `/w/[id]/analysis/[analysisId]` | Analiz detayı |

`src/app/api/ai/` yalnız web/dev için LLM proxy'leridir; Tauri'de kullanılmaz ([PROVIDERS.md](PROVIDERS.md)).

## Sözlük

- **Workspace:** en üst düzey kapsayıcı (`workspaces`); kaynaklar, notlar, kartlar, roadmap'ler hepsi bir çalışma alanına aittir.
- **Source:** eklenen belge (PDF, DOCX, URL, arXiv, YouTube, not). İkili içerik `sourceBlobs`'ta tutulur.
- **Chunk:** kaynağın parçalanmış metni (`chunks`); gömme (embedding) ve RAG getirimi (`topKChunks`) bunun üzerinden çalışır.
- **Highlight:** kaynak metninde kullanıcı vurgusu (`highlights`).
- **Flashcard / SRS:** kartlar `flashcards` tablosunda, desteler `decks`'te; SM-2 aralıklı tekrar (`src/lib/srs/`), tekrarlar `reviewLogs`'ta.
- **Concept:** kaynaklardan çıkarılan kavram ve aralarındaki ilişki (`concepts`, `conceptEdges`); zihin haritasını besler.
- **Note / wikilink / daily note:** Markdown notlar (`notes`, `noteFolders`), `[[wikilink]]` ile bağlanır; günlük not `src/lib/notes/daily.ts`.
- **Vault:** çalışma alanının `.md` klasörüyle iki yönlü senkronu (`src/lib/vault/`, yalnız Tauri). Kaldırılan "master-password vault" ile karıştırmayın; eski `vault` Dexie tablosu şemada silinmiştir.
- **Roadmap:** düğüm ve kenarlardan oluşan ön koşul grafı (`roadmaps`, `roadmapNodes`, `roadmapEdges`).
- **Lesson / Curriculum:** rehberli çalışma planı (`curricula`, `curriculumItems`) ve ders notları (`lessonNotes`); günlük kayıtları `studyJournalEntries`.
- **Analysis / Cross-analysis:** bir makalenin çok aşamalı analizi (`articleAnalyses`); birden çok analizin karşılaştırması (`crossAnalyses`).
- **Podcast:** iki sunuculu sesli özet (`podcasts`, ses `podcastBlobs`).

## Sonra nereye bakmalı

- [CLAUDE.md](../CLAUDE.md): geliştirici kuralları ve komutlar
- [README.md](README.md): dokümantasyon girişi
- [ARCHITECTURE.md](ARCHITECTURE.md): katmanlar ve ana akışlar
- [FEATURES.md](FEATURES.md): özellik başına ayrıntı
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): token'lar ve bileşen kuralları
- [PROVIDERS.md](PROVIDERS.md), [PROVIDERS_LOCAL.md](PROVIDERS_LOCAL.md): AI sağlayıcıları ve yerel/CLI sağlayıcılar
- [STATIC_EXPORT_WORKSPACE_ROUTING.md](STATIC_EXPORT_WORKSPACE_ROUTING.md): Tauri export'ta çalışma alanı rotaları
- Kod haritaları: [architecture](CODEMAPS/architecture.md), [backend](CODEMAPS/backend.md), [frontend](CODEMAPS/frontend.md), [data](CODEMAPS/data.md), [dependencies](CODEMAPS/dependencies.md)
