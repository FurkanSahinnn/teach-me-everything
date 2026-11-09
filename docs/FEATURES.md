# Özellikler

Uygulamanın bugün çalışan sayfaları ve özellikleri. Mimari için [ARCHITECTURE.md](ARCHITECTURE.md), dosya haritası için [CODEMAPS](CODEMAPS/frontend.md), tasarım token'ları için [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) belgesine bakın.

Bileşen yolları `src/components/<alan>/` altındadır, repo'lar `src/lib/db/` altında, AI modülleri `src/lib/ai/` altındadır. "Binding", kullanıcı tercihlerindeki `modelBindings` anahtarıdır (`src/stores/prefs.ts`): `chat`, `summary`, `quick`, `flashcardGen`, `roadmapGen`, `analysisExtract`, `analysisSynthesize`, `analysisCritique`, `embedPresetId`, `researchProvider`. Veri tamamen cihazdadır (Dexie, şema `src/lib/db/schema.ts`).

## Rota haritası

| Rota | Dosya |
|---|---|
| `/` | `src/app/page.tsx` |
| `/dashboard`, `/workspaces`, `/settings` | `src/app/<ad>/page.tsx` |
| `/setup/[step]` | `src/app/setup/[step]/page.tsx` |
| `/w/[id]` | `src/app/w/[id]/page.tsx` |
| `/w/[id]/read/[sourceId]` | `src/app/w/[id]/read/[sourceId]/page.tsx` |
| `/w/[id]/chat`, `notes`, `cards`, `quiz`, `map`, `research` | `src/app/w/[id]/<ad>/page.tsx` |
| `/w/[id]/study/[lessonId]`, `/w/[id]/study/journal` | `src/app/w/[id]/study/...` |
| `/w/[id]/audio/[podcastId]` | `src/app/w/[id]/audio/[podcastId]/page.tsx` |
| `/w/[id]/roadmap`, `/w/[id]/roadmap/[roadmapId]` | `src/app/w/[id]/roadmap/...` |
| `/w/[id]/analysis`, `/w/[id]/analysis/[analysisId]` | `src/app/w/[id]/analysis/...` |

Çalışma alanı rotaları statik export nedeniyle `useRouteParams()` ile okunur; ayrıntı için [STATIC_EXPORT_WORKSPACE_ROUTING.md](STATIC_EXPORT_WORKSPACE_ROUTING.md).

## Landing (`/`)

Tanıtım sayfası. `Brand` (shell) ve `FirstRunGate` (setup) kullanır; ilk çalıştırmada kurulum sihirbazına yönlendirmek `FirstRunGate`'in işidir. Veri ve AI çağrısı yok.

## Dashboard (`/dashboard`)

Çalışma alanı kartları, öğrenme ipuçları, bugün ve son aktivite bölümleri. Bileşenler: `AppShell`, `WorkspaceCard`, `WorkspaceFormModal`. Okur: `workspaces` (`useWorkspaces`). Yazar: çalışma alanı oluşturma/düzenleme. AI yok. Bazı bölümler `src/lib/fixtures/dashboard.ts` içindeki örnek veriye dayanır.

## Çalışma alanları (`/workspaces`)

Çalışma alanlarını listeler; oluşturma, düzenleme, silme. `WorkspaceCard`, `WorkspaceFormModal`. Tablo: `workspaces`. AI yok.

## Ayarlar (`/settings/*`)

Solda gruplu menü (`SettingsSidebarNav`, arama kutulu), sağda başlık + kart satırları (`SettingsPage` / `SettingsSection` / `SettingsGroup` / `SettingsRow`, `src/components/settings/layout/`). Her bölüm statik bir rota; menü ve eski `#hash` bağlantılarının yönlendirmesi `settings-nav.ts` içinde.

- `/settings` Genel: arayüz dili, AI çıktı dili (`AILocaleSection`), otomatik başlatma.
- `/settings/appearance` tema, yazı tipi, yoğunluk · `/settings/learning` SRS sınırları.
- `/settings/providers` **Sağlayıcılar** (`ProvidersManager`): solda liste (Bu bilgisayarda / Yerel sunucular / Bulut / Özel uç noktalar), her satırda durum ve açma-kapama anahtarı (`disabledProviders`; kapalı sağlayıcı model seçicilerde görünmez). Sağda ayrıntı:
  - Claude Code ve Codex CLI (`CliProviderDetail`): kurulu sürüm, oturum durumu, e-posta ve plan (ör. "Claude Max", "ChatGPT Plus"), kullanım limitleri, ikili dosya yolu, `CLAUDE_CONFIG_DIR` / `CODEX_HOME` klasörü, vekil sunucu değişkenleri. Bilgiler CLI'ların kendisinden okunur (`lib/ai/agent-status`); token dosyası okunmaz.
  - Bulut ve yerel sağlayıcılar (`ApiProviderDetail`): anahtar alanları (`ApiKeyRow`), adres, araç kullanımı, model sayısı; özel uç noktalar için bilgi ve silme. "Sağlayıcı ekle" `CustomEndpointModal` açar.
- `/settings/models` varsayılan model binding'leri: her görev tek satır; sağdaki seçici (`ChatModelPicker`) solda sağlayıcılar, sağda aranabilir model listesi, altta katalog durumu/yenile, özel model ID alanı ve eksik anahtar uyarısı olan bir panel açar. Embedding satırı aynı görünümde tek listeli `ListPicker` kullanır. · `/settings/embedding` `EmbedSection`, `RechunkSection`.
- `/settings/usage` **Kullanım** (`UsageView`): Maliyet / Token / Limitler sekmeleri, 24 saat–90 gün aralığı. Bu bilgisayardaki Claude Code ve Codex günlüklerini yalnız okuyarak (`usage_scan`) toplam, sağlayıcı ve model dökümü, günlük grafik, türe göre dağılım ve önbellek tasarrufu gösterir; maliyet liste fiyatlarıyla API tahminidir. Limitler sekmesi oturum / haftalık / model bazlı pencereleri ve sıfırlanma süresini gösterir. Altında uygulama içi maliyet tercihleri (`CostSection`).
- `/settings/research` araştırma anahtarları, `SearchProvidersSection`, `WebSearchSection` · `/settings/audio` `TtsProviderSection`, `PodcastFeatureSection`.
- `/settings/concepts` `ConceptsSection` · `/settings/notes` `NoteEditorSection`, `VaultSection`, `DailyNotesSection`.
- `/settings/data` `BackupSection`, `QuotaSection` · `/settings/updates` `UpdatesSection` · `/settings/about`.

## Kurulum sihirbazı (`/setup/[step]`)

Dört adım: Hoş geldiniz, API anahtarları, Örnekler, Hazırsın. `WelcomeStep`, `PresetChooser`, `ExamplesStep`, `DoneStep`. Yazar: `apiKeys`, tercihler, örnek veri (yalnız Örnekler adımında açıksa, `src/lib/db/seed.ts`). AI yalnızca anahtar testi (`lib/ai/upstream/test-key`).

## Çalışma alanı özeti (`/w/[id]`)

Çalışma alanının ana sayfası: sayaçlar (kaynak, vurgu, kart), hızlı eylem kartları (okumaya başla, kart tekrarı, quiz, zihin haritası) ve kaynak tablosu.

- Kaynak tablosu: sıralama (başlık, tür, güncellenme, özel sıra), sayfalama, silme, yeniden gömme (`lib/ingest/reembed`). Masaüstü tabloda sürükle-bırak ile elle sıralama (`reorderSources`, `lib/utils/reorder`; sıra `sources.sortOrder`).
- Ekleme: `SourceUploader` (PDF, DOCX, MD, TXT; dosya sürükle-bırak dahil), `AddUrlModal` (URL, DOI, arXiv, YouTube), `SearchSourcesModal` (konu araması), `GenerateScriptModal` (podcast betiği, `podcast/`).
- Okur/yazar: `sources`, `chunks`, `sourceBlobs`, `highlights`, `flashcards`, `podcasts`.
- AI: gömme `embedPresetId`; URL içe aktarma `researchProvider`; podcast betiği `chat` binding'i.

## Okuyucu (`/w/[id]/read/[sourceId]`)

Kaynak okuyucu ve kaynağa bağlı sohbet. Masaüstünde yan yana, mobilde Kaynak/Sohbet sekmesi.

- Okuma: `PdfViewer` (`sources/`, PDF), `MarkdownPreview` (diğer türler), metin seçerek vurgu, `TweaksPanel` (görünüm).
- Sohbet: `ChatThreadSidebar`, `ChatBubble`, `CitationChip` (tıklanınca ilgili parçaya atlar, `.citation-pulse`), `WebCitationChip` (`ChatBubble` içinde) / `WebCitationPeekModal`. İstek sahibi `ChatSession` (`useChatSession`): uygulama içi gezinme akışı iptal etmez; yazımı `stream-writer` yapar.
- Araçlar (`lib/ai/tools.ts`, `tool-handlers.ts`): `add_flashcard`, `open_citation`. Ayrıca sohbeti çatallama, `GenerateBatchModal` ile toplu kart, `SaveJournalEntryModal` ile günlüğe kayıt.
- Okur/yazar: `chunks`, `highlights`, `chatThreads`, `chatMessages`, `flashcards`, `notes`, `studyJournalEntries`.
- AI: `chat` binding'i; RAG `lib/ai/retrieval` (`topKChunks`); isteğe bağlı web araması (`lib/ai/web-search`); araştırma içe aktarma `researchProvider`.

## Çalışma alanı sohbeti (`/w/[id]/chat`)

Çok kaynaklı sohbet: `WorkspaceChatPanel`, `useWorkspaceChat` (`lib/ai/runners/workspace-chat-runner.ts`). `ContextBar` bağlam çipleri (Kaynaklar, Notlar, Kavramlar, Roadmap, Performans) ve web araması anahtarı; `SourceScopePicker` ile kaynak kapsamı. Bağlam blokları `lib/ai/context/` altında token bütçesiyle eklenir. Araç: yalnız `add_flashcard` (`generate_flashcards` / `generate_quiz` tanımlı ama bilerek sunulmuyor). Okur/yazar: `sources`, `chunks`, `chatThreads`, `chatMessages`. AI: `chat` binding'i.

## Notlar (`/w/[id]/notes`)

Obsidian tarzı üç bölmeli çalışma alanı. Sol: `NoteTree` / `TagPanel` (yeniden boyutlanır, gizlenir; mobilde çekmece). Orta: `NoteHeader` (klasör yolu, Canlı / Kaynak / Okuma anahtarı, odak modu, `EmbedAsSourceButton` / `EmbedAsSourceMenu`) ve `NoteEditor` ya da `NoteReadingView`. Sağ: `OutlinePanel` üstte, `BacklinksPanel` altta. Bölme genişlikleri ve açık/kapalı durumu `prefs.noteEditor` içinde.

- **Editör** (CodeMirror 6, `lib/notes/live-preview/`): canlı önizleme başlıkları, madde işaretlerini, işaretli görevleri, callout'ları (katlanır), tabloları, yatay çizgiyi, resimleri, KaTeX matematiği, dipnotları ve wikilink'leri (çözülmeyen bağlantı soluk) işler; imleç satırında ham markdown görünür, editör odakta değilken her şey işlenir. `==vurgu==` için Lezer uzantısı (`highlight-syntax.ts`); token renkleri `highlight-style.ts`.
- **Code Styler** (`lib/notes/code-styler/`, `live-preview/code-block.ts`, okuma için `lib/markdown/code-styler.ts`): fence parametreleri `title:`, `ln:`, `hl:`, `fold`, `wrap`/`unwrap`, `ignore`; başlık, dil, satır numarası, kopyala, katla. Diller `@codemirror/language-data` ile tembel yüklenir.
- **Renkli metin ve biçim** (`lib/notes/format-edits.ts`, `format-commands.ts`, `inline-html-tags.ts`): `<span style="color:…">`, `<mark style="background:…">`, `<u>`, `<sup>`, `<sub>`, `<p align>` / `<center>`; Obsidian eklentileriyle uyumlu. Okuma görünümü yalnız doğrulanmış etiketleri yeniden üretir (`inline-html-allowlist.ts`, `html: false` korunur).
- **Araç çubuğu** (`components/notes/toolbar/`): tek satırlık şerit, sığmayanlar » menüsüne (`toolbar-layout.ts`); başlık, renk ve vurgu paletleri, hizalama, callout, tablo ızgarası, kod bloğu, matematik, dipnot, biçim boyacısı. Konum: üstte / seçimde / ikisi / gizli.
- **Durum çubuğu** (`editor/EditorStatusBar.tsx`): kelime, karakter, okuma süresi, kayıt durumu, editör genişliği kaydırıcısı (not bazında `editor-width: 0-100` frontmatter'ı geçersiz kılar).
- Kısayollar: Ctrl+B/I/U, Ctrl+Shift+X üstü çizili, Ctrl+Shift+H vurgu, Ctrl+. / Ctrl+, üst/alt simge, Ctrl+K bağlantı, Ctrl+Enter görev, Ctrl+Alt+1-6 başlık, Ctrl+E okuma görünümü (web'de tarayıcı kısayolu öne geçebilir). Boş liste maddesinde Enter Obsidian gibi girintiyi azaltır ya da listeyi bitirir (`list-keymap.ts`).

Tablolar: `notes`, `noteFolders`, `sources`, `concepts`. Gömme `embedPresetId` ile; üretken AI çağrısı yok.

## Kartlar (`/w/[id]/cards`)

SM-2 aralıklı tekrar (`lib/srs/sm2`). Desteler, vadesi gelenler ve deste bazlı tekrar oturumu; günlük yeni/tekrar sınırları tercihlerden gelir. Klavye: 1-4 derecelendirme, Boşluk çevir, E düzenle, Ctrl/Cmd+Z geri al. Bileşenler: `FlashcardEditModal`, `GenerateBatchModal` (`flashcardGen`), `FlashcardProposalModal`, `LeechBadge`, `IntervalHistogram` (`srs/`). Tablolar: `decks`, `flashcards`, `reviewLogs`.

## Quiz (`/w/[id]/quiz`)

Kaynaktan çoktan seçmeli (`mcq`), açık uçlu (`open`) veya karışık (`mixed`) oturum üretir; açık uçlu cevapları AI değerlendirir. `SessionReportModal` oturum raporu, `GenerateBatchModal` kart üretimi. Modüller: `quiz-gen`, `quiz-eval`, `translate`, `content-language`. Binding'ler: `chat` (üretim), `summary` (değerlendirme). Tablolar: `quizSessions`, `chunks`, `sources`.

## Zihin haritası (`/w/[id]/map`)

Konsept grafı: `MindMapCanvas`, `ConceptInspector`. Okur: `concepts`, `conceptEdges`. Konseptler Ayarlar'daki `ExtractConceptsModal` ile çıkarılır (`lib/ai/concept-extraction`, `summary`); sayfanın kendisi AI çağırmaz.

## Araştırma (`/w/[id]/research`)

Web araması yapar, sonuçları listeler, seçilenleri kaynak olarak içe aktarır (`lib/research/ingest`) ve karşılaştırma matrisi ile içgörü sentezi üretir (`lib/research/synthesis`). Arama sağlayıcıları `lib/research/search/`, içe aktarma sağlayıcıları `lib/research/providers/`. Binding'ler: `chat` (sentez), `researchProvider`. Tablolar: `sources`, `chunks`.

## Çalışma / Study

- `/w/[id]/study/[lessonId]`: müfredat dersinin notu. `MarkdownPreview`, `RegenerateLessonModal` (`lesson-note-generation`, `summary`), dışa aktarma (`lib/study/export`). Okur: `curriculumItems`, `lessonNotes`, `chunks`, `studyJournalEntries`.
- `/w/[id]/study/journal`: çalışma günlüğü; giriş listesi, silme, dışa aktarma. Girişler okuyucudaki `SaveJournalEntryModal` ile kaydedilir (`study-journal-generation`, `quick`). Tablolar: `studyJournalEntries`, `lessonNotes`.
- Eksik: `GenerateCurriculumModal` (`study/`) ve `curriculum-generation` kodda var ama hiçbir sayfa modalı bağlamıyor; müfredat oluşturmak için UI giriş noktası yok.

## Sesli özet (`/w/[id]/audio/[podcastId]`)

İki sunuculu podcast oynatıcı ve sentez. Betik özet sayfasındaki `GenerateScriptModal` ile üretilir (`podcast-generation`, `chat`) ve bu rotaya yönlendirir. Sentez `lib/podcast/synthesize`; adaptörler `lib/podcast/adapters/` (Piper, Web Speech, deneysel yerel). `CompatibilityChip`, `InstallModelModal`. Tablolar: `podcasts`, `podcastBlobs`. Bu rotanın indeks sayfası yok; kenar çubuğundaki "Ses Özeti" öğesi `/w/{id}/audio` adresine bağlıdır ve karşılığında bir `page.tsx` bulunmaz.

## Yol haritası (`/w/[id]/roadmap`, `/roadmap/[roadmapId]`)

- Liste: `RoadmapCard`, `RoadmapEmptyState`, `RoadmapWizardModal` (seviye/hedef; `runRoadmapGen`, `roadmapGen`).
- Detay: `RoadmapCanvas` (ön koşul DAG, `lib/roadmap/layout`), `NodeInspector` (ilerleme, alt görev üretimi `summary`, kart üretimi `flashcardGen`; `lib/roadmap/lesson-gen`). Tablolar: `roadmaps`, `roadmapNodes`, `roadmapEdges`.

## Makale analizi (`/w/[id]/analysis`, `/analysis/[analysisId]`)

Tüm belgeyi çok aşamalı işler: Map, Reduce, uzmanlar, Synthesize. Elle yazılmış boru hattı: `lib/ai/article-analysis.ts`, `stage-runner.ts`, `runners/article-analysis-runner.ts`. Bozuk aşama taslak olarak işaretlenir; alıntılar `lib/article-analysis/citation-verify` ile kodda doğrulanır.

- Liste: `AnalysisCard`, `AnalysisEmptyState`, `AnalysisGenerateModal` (kaynak veya yükleme, aşama ilerlemesi, maliyet tahmini).
- Detay: `AnalysisDetailView`, `ConfirmDeleteModal` ile silme, PDF dışa aktarma (`lib/article-analysis/pdf-export`).
- Binding'ler: `analysisExtract` (Map), `analysisSynthesize` (Reduce + final), `analysisCritique` (eleştirmen). Tablo: `articleAnalyses`.
- Yalnızca arka uç: `lib/ai/cross-analysis.ts`, `lib/db/cross-analyses.ts` (`crossAnalyses` tablosu, yedeğe dahil). `src/app` ve `src/components` içinde UI referansı yok.

## Ortak özellikler

- **Komut paleti:** `CommandPalette` (`palette/`), Ctrl/Cmd+K. Arama `lib/db/fts.ts`: çalışma alanı, kaynak, vurgu, kart, parça, not.
- **Kısayollar:** `?` yardım penceresini açar (`ShortcutsHelpModal`); Esc kapatır ve sohbeti durdurur; sohbette Ctrl/Cmd+Enter gönderir; kartlarda 1-4, Boşluk, E.
- **Temalar:** white, sepia, dark, github; yoğunluk compact/normal/comfy; `ThemeToggle`, `TweaksPanel`, sistemi takip seçeneği. Ayrıntı [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- **i18n:** TR/EN, `messages/{tr,en}.json`, `useLocalePick`; AI çıktı dili `AILocaleSection` ile ayrıca seçilir.
- **Kaynak içe aktarma:** PDF (pdf.js worker), DOCX (mammoth), Markdown/TXT, URL, DOI, arXiv, YouTube transkripti (`lib/ingest/`, `lib/research/ingest`). Parçalama `lib/ingest/chunker.ts`, ardından gömme.
- **Yeniden parçalama / gömme:** `RechunkSection` (`lib/ingest/rechunk`); `ReembedModal` ve kaynak başına yeniden gömme (`lib/ingest/reembed`).
- **Vault senkronu:** çalışma alanı `.md` klasörüyle iki yönlü senkron (`lib/vault/`; `VaultSection`, `VaultSetupModal`, `WorkspaceVaultMount`); `VaultSection` Tauri ortamını denetler.
- **Yedek:** `BackupSection`, `lib/backup/export.ts` / `import.ts` (JSON; ikili blob'lar ve vault hariç).
- **Kaynak sürükle-bırak sıralama:** özet sayfasında, bkz. `/w/[id]`.
- **Masaüstü kabuğu:** tray, derin bağlantı, menü, güncelleme denetimi (`components/mounts/`).
