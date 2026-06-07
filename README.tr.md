# Teach Me Everything

[English version](README.md)

Yerel öncelikli öğrenme uygulaması. Kendi PDF, DOCX, Markdown, metin ve notlarını içe aktararak çalışma alanları, kaynak okuma, AI destekli sohbet, flashcard, quiz, zihin haritası ve guided study akışları oluşturur.

## Özellikler

- Workspace tabanlı kaynak yönetimi
- PDF, DOCX, Markdown ve düz metin içe aktarma
- Kaynaklardan chunk üretme, embedding oluşturma ve citation destekli AI sohbet
- Flashcard üretimi, SM-2 aralıklı tekrar ve leech takibi
- Quiz oturumları ve değerlendirme akışı
- Konsept çıkarımı ve zihin haritası görünümü
- Guided study / ders notu kayıtları
- Backup ve restore akışı
- TR / EN arayüz
- Yerel veri saklama: Dexie / IndexedDB
- BYOK API key yönetimi: masaüstünde (Tauri) OS keychain'de saklanır; web build yalnızca yerel geliştirme içindir

## Teknoloji

| Alan | Teknoloji |
| --- | --- |
| Framework | Next.js 16 App Router |
| Dil | TypeScript |
| UI | React 19, Tailwind CSS v4, lucide-react |
| State | Zustand |
| Persistence | Dexie.js / IndexedDB |
| i18n | next-intl |
| AI Providers | Anthropic, OpenAI-compatible, Gemini ve diğer preset sağlayıcılar |

## Kurulum

Node.js 20 veya üstü gerekir.

```bash
npm install
npm run dev
```

Uygulama varsayılan olarak şu adreste açılır:

```text
http://localhost:3000
```

Production build için:

```bash
npm run build
npm run start
```

## API Key Saklama

BYOK (kendi anahtarını getir): uygulama API key'leri `.env` dosyasına yazmaz. Anahtarın nerede saklandığı build'e göre değişir.

### Tauri build (masaüstü) — önerilen

API key'ler işletim sisteminin yerel credential store'unda saklanır — macOS Keychain, Windows Credential Manager veya Linux Secret Service — `com.tme.byok` servis kimliği altında. Master password yoktur: OS oturumun + disk şifrelemesi (FileVault / BitLocker / LUKS) koruma katmanını sağlar.

### Web build (tarayıcı) — yalnızca geliştirme

Web build yerel geliştirme içindir, gerçek/uzun ömürlü anahtarları saklamak için değil. Girdiğin anahtarlar tarayıcı IndexedDB'sindeki Dexie `apiKeys` tablosuna **düz metin** olarak yazılır — master password ve tarayıcı tarafı şifreleme yoktur. Günlük kullanım için masaüstü build'i kullan.

Backup export akışı her iki build'de de API key tablosunu dışarı aktarmaz.

## Masaüstü build (Tauri)

Asıl dağıtım hedefi masaüstü uygulamasıdır (GitHub Releases üzerinden). Web build yalnızca yerel geliştirme içindir.

```bash
npm run tauri:dev     # masaüstü uygulamasını dev'de çalıştır
npm run tauri:build   # masaüstü binary üret
```

## Repo Kapsamı

Repo; app source (`src/`), Tauri masaüstü kabuğu (`src-tauri/`), test paketleri + config'leri ve CI workflow'larını içerir. Git dışı bırakılanlar: yerel çalışma dosyaları, agent konfigürasyonları (`CLAUDE.md`, `AGENTS.md`), iç notlar (`docs/`), build çıktıları, cache'ler, büyük önceden derlenmiş binary'ler (ör. build sırasında indirilen Piper TTS sidecar) ve secret dosyaları.

## Komutlar

```bash
npm run dev          # web dev sunucusu (http://localhost:3000)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test:run     # birim testleri (Vitest)
npm run test:e2e     # uçtan uca testler (Playwright)
```

## Lisans

MIT — bkz. [LICENSE](LICENSE).

Masaüstü build yerel bir metin-okuma motoru (Piper) içerir. Paketlenen üçüncü taraf bileşenler ve lisansları — **espeak-ng (GPL-3.0)** dahil — [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) dosyasında listelenir.
