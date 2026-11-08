# Bulut Sağlayıcılar

Teach Me Everything (TME) BYOK çalışır: kendi API anahtarını girersin, istekler doğrudan sağlayıcıya gider. Bu sayfa hangi bulut sağlayıcıların koda dahil olduğunu, anahtarların nerede saklandığını ve yeni bir sağlayıcı eklerken nelere dokunulacağını anlatır. Yerel sunucular ve yerel agent CLI'ları için bkz. [PROVIDERS_LOCAL.md](./PROVIDERS_LOCAL.md). Genel mimari için [ARCHITECTURE.md](./ARCHITECTURE.md).

## 1. Hızlı bakış

Gerçek kaynak: `src/lib/ai/providers/presets.ts` (`PROVIDER_PRESETS`), `src/lib/ai/providers/embed-presets.ts` (`EMBED_PRESETS`), `src/lib/research/providers/presets.ts` (`RESEARCH_PRESETS`).

### Sohbet (chat)

| Preset id | Aile | Anahtar nereden |
|---|---|---|
| `anthropic` | `anthropic` | console.anthropic.com (API Keys) |
| `openai` | `openai-compat` | platform.openai.com/api-keys |
| `google-gemini` | `gemini` | aistudio.google.com/apikey |
| `openrouter` | `openai-compat` | openrouter.ai/keys |
| `groq`, `deepseek`, `glm`, `xai`, `mistral`, `together`, `cerebras`, `perplexity` | `openai-compat` | sağlayıcının kendi konsolu (preset'teki `docsUrl` alanı) |

Anahtar gerektirmeyen preset'ler (`claude-cli`, `codex-cli`, `ollama`, `lm-studio`, `llama-cpp`) [PROVIDERS_LOCAL.md](./PROVIDERS_LOCAL.md) içindedir. Anthropic için ayrıca `claude-code-oauth` anahtar kaydı vardır (`claude setup-token` çıktısı); `src/lib/ai/anthropic-credential.ts` (`resolveAnthropicCredential`) OAuth ile API anahtarı arasındaki tercihi uygular. Her preset'in modelleri `availableModels`, varsayılanı `defaultModels` alanındadır.

### Embedding

`EMBED_PRESETS` aileleri: `openai-compat` (OpenAI, OpenRouter, Mistral, Ollama), `voyage`, `gemini`, `cohere`, `jina`, `huggingface`. Preset id örnekleri: `openai-3-small`, `voyage-3`, `gemini-embed-2`, `cohere-multilingual`, `jina-v3`, `mistral-embed`, `hf-bge-m3`, `ollama-nomic`. `deprecated: true` olan preset seçiciden gizlenir ama mevcut çalışma alanları bozulmasın diye çözümlenmeye devam eder. Embedding modelini değiştirmek mevcut chunk'ları yeniden gömmeyi gerektirir (Settings → Embedding → Reembed).

### Araştırma ve arama

| Alan | Sağlayıcılar |
|---|---|
| Sayfa çıkarımı (`RESEARCH_PRESETS`) | `readability` (yerel, anahtarsız), `firecrawl`, `exa`, `jina-reader`, `tavily`, `diffbot`, `brightdata` |
| "Konu ara" zinciri (`src/lib/research/search/registry.ts`) | `brave`, `exa-search`, `tavily-search`; sohbet sağlayıcısının web aramasını kullanan `anthropic-search`, `openai-search`, `gemini-search`, `perplexity-search`, `xai-search`, `mistral-search`, `glm-search`, `openrouter-search` |

Arama sırası Settings'te (`SearchProvidersSection`) ayarlanır; zincir kullanıcı sırasıyla yürür, hata ya da boş sonuçta sıradakine düşülür. Brave için ayrı `brave` anahtarı gerekir.

### TTS (podcast)

Bulut TTS sağlayıcısı yoktur. `TtsProviderId` (`src/lib/podcast/adapter.ts`): `piper`, `web-speech`, `kokoro`, `xtts`, `vibevoice`; hepsi yerel çalışır. Piper ses modelleri ilk kullanımda `huggingface.co` üzerinden indirilir.

## 2. Anahtarlar nerede saklanır

- **Tauri (dağıtılan uygulama):** işletim sistemi anahtar zinciri. Rust tarafı `src-tauri/src/keychain.rs` (`keychain_get/set/delete/list`, servis adı `com.tme.byok`), JS tarafı `src/lib/crypto/keychain.ts`; erişim `src-tauri/permissions/keychain.toml` ile verilir.
- **Web (yalnız `npm run dev`):** Dexie `apiKeys` tablosunda **düz metin**. Web build dağıtılmaz; bu yalnız geliştirme içindir.
- Seçim `src/lib/db/api-keys-repo.ts` içinde yapılır (`isKeychainAvailable()`); `setApiKey`, `getApiKey`, `hasApiKey`, `deleteApiKey`, `listStoredProviders` iki arka uca da aynı arayüzü sunar. Kayıt anahtarı tipi `ApiKeyProvider` (`src/lib/db/schema.ts`).

## 3. İstek yolu: proxy mı, doğrudan mı

HTTP sağlayıcıları ortama göre dallanır (`isTauriEnvWithOverride()`, `src/lib/tauri/env.ts`):

| Ortam | Yol |
|---|---|
| Web dev | Tarayıcı bulut API'lerine CORS yüzünden doğrudan gidemez; istek `src/app/api/ai/*` proxy'lerinden geçer (`chat`, `chat-oauth`, `chat-responses`, `embed`, `test`, `research`). Proxy anahtarı `Authorization: Bearer` ile alır ve upstream'in beklediği başlığa çevirir. |
| Tauri | Statik export'ta sunucu yoktur; istek `@tauri-apps/plugin-http` ile doğrudan upstream'e gider (`src/lib/tauri/fetch.ts`: `tauriFetch`, `smartFetch`). URL, başlık ve gövde web proxy'siyle aynı ortak oluşturucudan çıkar (`buildChatUpstream`). |
| Yerel adres | Her iki ortamda proxy atlanır; bkz. [PROVIDERS_LOCAL.md](./PROVIDERS_LOCAL.md). |

`custom:*` sağlayıcı id'leri (kullanıcı tanımlı uç noktalar) embed proxy'sinde `custom_endpoint_forbidden` ile reddedilir.

## 4. Yeni bulut sağlayıcı eklemek

1. `presets.ts` (gerekirse `embed-presets.ts` / research preset'i) içine kaydı ekle, id'yi `CloudProviderId` tipine yaz, anahtar kaydı için `ApiKeyProvider` listesini güncelle.
2. Fiyatları `src/lib/ai/pricing.ts` içine gir (§ 5); model listesi için `model-fetch/` altına adapter ekle (§ 6).
3. **CSP:** `next.config.ts` `connect-src` değerini `deriveConnectOrigins()` (`src/lib/ai/csp-origins.ts`) üretir; preset'lerin `baseUrl` alanlarını tarar, yerel adresleri dışarıda bırakır. Elle ek yapmak gerekmez.
4. **Tauri HTTP izin listesi:** `src-tauri/capabilities/default.json` içindeki `http:default` `allow` listesi **otomatik türetilmez**. Yeni host'u elle `{ "url": "https://api.ornek.com/*" }` olarak ekle; aksi halde masaüstünde istek, web'de çalışsa bile izin hatasıyla düşer.
5. `presets.test.ts` testini güncelle.

## 5. Fiyatlandırma

`src/lib/ai/pricing.ts` içindeki `PRICING` haritası model id'sine göre USD / 1M token oranlarını tutar (`input`, `output`, `cacheRead`, `cacheCreation`) ve yalnızca kullanıcıya gösterilen **tahmini** maliyet (`computeCostUsd`) içindir. Fatura otoritesi sağlayıcının kendi faturasıdır.

- **Global bir "tazelik" kapısı bilinçli olarak yoktur.** BYOK'ta her sağlayıcının fiyat tempo'su farklıdır; OpenRouter ve özel uç noktaların oranları ise hiç bilinemez. Tek bir tarih yanlış kesinlik verirdi. Değişen girişler tek tek güncellenir.
- Güncelleme: sağlayıcının fiyat sayfasına bak, ilgili model girişindeki oranları değiştir, `npm run typecheck` ve `npm run test:run` çalıştır. Claude ve güncel OpenAI girişleri resmi sayfalardan alınmıştır (kaynak bağlantıları `pricing.ts` yorumunda); `pricing.test.ts` içindeki "PRICING list prices" tablosu bu değerleri sabitler, fiyat değişince ikisi birlikte güncellenir.
- `cacheCreation` 5 dakikalık (OpenAI'de 30 dakikalık) önbellek yazma ücretidir. Claude Code çoğunlukla 1 saatlik önbellek yazar; Kullanım ekranındaki maliyet bu yüzden biraz düşük tahmin edilir.
- Önbellek okuma oranı her modelde 0.1× değildir: Fable 5.1 0.025×, Opus 5.5 ve Sonnet 5.5 0.05×.
- `PRICING` içinde olmayan model 0 USD sayılır ve tek seferlik `console.warn` düşer; hata fırlatılmaz.
- **Abonelik CLI takma adları kasten yoktur.** `claude-cli` takma adları (`opus`, `sonnet`, `haiku`) ve `opencode-cli` model id'leri (`opencode/…`, `opencode-go/…`) `PRICING`'e girmez; böylece uygulama içi maliyet çipi gizlenir. Abone token başına ödemez; yanlış bir dolar tutarı ya da "Free" yazmak yanıltıcı olurdu. Kullanım ekranı ise CLI günlüklerindeki gerçek model id'lerini (`claude-opus-5-5`, `gpt-6-astra` …) fiyatlandırır ve bunu açıkça "API tahmini" olarak etiketler.
- Web arama maliyeti ayrı hesaplanır: `computeWebSearchCostUsd`.

## 6. Dinamik model listeleri

Seçici statik `availableModels` ile açılır, sonra sağlayıcının kataloğu çekilir: `src/lib/ai/providers/model-fetch/` (`adapter.ts` kayıt defteri, sağlayıcı başına bir adapter, `tier-infer.ts` katman çıkarımı). Hook: `src/hooks/useProviderChatModels.ts`. Sonuç Dexie'de önbelleğe alınır, TTL 7 gün (`PROVIDER_MODELS_CACHE_TTL_MS`, `src/lib/db/provider-models-repo.ts`); `baseUrl` değişirse önbellek geçersiz olur. Adapter'ı olmayan preset (ör. `perplexity`) ve hata durumunda statik liste kullanılır. Adapter `requiresApiKey` alanıyla anahtar isteyip istemediğini bildirir. OpenRouter'da `:free` model varyantları kasten öne çıkarılmaz; istenen model id'si elle yazılabilir.

## 7. Özel uç nokta

Listede olmayan OpenAI-uyumlu (veya resmi Gemini) bir uç nokta Settings'teki özel sağlayıcılar bölümünden eklenir (`CustomEndpointSection`, `CustomEndpointModal`; tip `CustomEndpoint`, `src/stores/prefs.ts`). `src/lib/ai/providers/registry.ts` (`synthesizeCustomPreset`) bundan `custom:<id>` preset'i üretir: araç kullanımı `json` varsayılır, vision kapalıdır. Uç nokta yerel değilse bulut upstream'idir; Tauri'de host'un § 4 madde 4'teki izin listesinde olması gerekir.

## 8. Sık hatalar

| Belirti | Olası neden | Çözüm |
|---|---|---|
| `401` / `missing_key` | Anahtar boş, yanlış veya iptal | Settings'te anahtarı yenile, bağlantıyı test et |
| `429` | Hız sınırı (özellikle ücretsiz katman) | Bekle, daha küçük model dene |
| Masaüstünde istek düşüyor, web'de çalışıyor | Host `http:default` izin listesinde yok | § 4 madde 4 |
| Web dev'de CORS hatası | İstek proxy'yi atlamış | `isLocalUrl` ve sağlayıcının yol seçimini kontrol et |
| `custom_endpoint_forbidden` | `custom:*` id'si embed proxy'sine gitti | Özel uç nokta yerel olmalı |
| `unknown_provider` | Preset id'si bilinmiyor | Preset kaydı ve `CloudProviderId` tipi |
| Embedding boyut uyuşmazlığı | Çalışma alanı başka boyutlu modelle gömülmüş | Settings → Embedding → Reembed |
