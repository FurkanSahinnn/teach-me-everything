# Bulut Sağlayıcılar — Anahtar & CORS Rehberi

> Teach Me Everything (TME) Phase 3.1 / 3.3 itibarıyla **12 cloud chat preset + 7 cloud embed family** ile çalışır. Bu sayfa her ailesi için anahtar nasıl alınır, CORS nasıl kurulur, hangi hata mesajına ne karşılık gelir — kısa kısa anlatır.
>
> **Gizlilik garantisi:** Bulut adresi (`api.openai.com`, `api.anthropic.com`, …) tespit edildiğinde TME `/api/ai/chat` ya da `/api/ai/embed` Edge proxy'sini **kullanır** — Authorization header tarayıcıda kalmaz, log'lanmaz, response body'sinde echo edilmez. Direkt tarayıcı→API çağrısı yalnız yerel adresler için (`docs/PROVIDERS_LOCAL.md`).

---

## 1. Hızlı bakış

### Chat (12 cloud preset · proxy üzerinden)

| Preset | Aile | Auth header | Free tier | Tool use |
|---|---|---|---|---|
| `anthropic` | anthropic | `x-api-key` | – | native |
| `openai` | openai-compat | `Authorization: Bearer` | – | native |
| `google-gemini` | gemini | `x-goog-api-key` | ✅ | native |
| `openrouter` | openai-compat | `Authorization: Bearer` | ✅ (`:free` modeller) | native |
| `groq` | openai-compat | `Authorization: Bearer` | ✅ | native |
| `deepseek` | openai-compat | `Authorization: Bearer` | – | native |
| `glm` | openai-compat | `Authorization: Bearer` | – | native |
| `xai` | openai-compat | `Authorization: Bearer` | – | native |
| `mistral` | openai-compat | `Authorization: Bearer` | – | native |
| `together` | openai-compat | `Authorization: Bearer` | – | native |
| `cerebras` | openai-compat | `Authorization: Bearer` | ✅ (low-tier) | native |
| `perplexity` | openai-compat | `Authorization: Bearer` | – | native |

### Embed (7 cloud family · proxy üzerinden)

| Aile | URL şablonu | Auth header | Free tier | Notes |
|---|---|---|---|---|
| `openai-compat` | `${baseUrl}/embeddings` | `Authorization: Bearer` | – | OpenAI / Mistral |
| `voyage` | `${baseUrl}/embeddings` | `Authorization: Bearer` | – | voyage-3 / voyage-3-large |
| `gemini` | `${baseUrl}/models/${model}:embedContent` | `x-goog-api-key` | ✅ | text-embedding-004, gemini-embedding-001 |
| `cohere` | `${baseUrl}/embed` | `Authorization: Bearer` | – | embed-multilingual-v3.0 |
| `jina` | `${baseUrl}/embeddings` | `Authorization: Bearer` | ✅ | matryoshka 256/512/1024-d |
| `huggingface` | `${baseUrl}/pipeline/feature-extraction/${model}` | `Authorization: Bearer` | ✅ (rate-limited) | bge-m3, multilingual-e5 |
| `mistral` | `${baseUrl}/embeddings` | `Authorization: Bearer` | – | mistral-embed (1024-d) |

---

## 2. Anahtar nasıl alınır?

### Anthropic
1. https://console.anthropic.com → API Keys → Create Key
2. Anahtar `sk-ant-api03-…` ile başlar.
3. TME → Settings → API anahtarları → Anthropic → Test connection.

### OpenAI
1. https://platform.openai.com/api-keys → Create new secret key
2. `sk-proj-…` veya `sk-…`
3. Embedding + Whisper kullanım hakları için "All" scope yeterli.

### Google Gemini
1. https://aistudio.google.com/apikey → Create API key
2. **Free tier var:** günlük rate limit dahilinde ücretsiz.
3. Anahtar prefix yok (`AIza…` ile başlar).

### OpenRouter
1. https://openrouter.ai/keys → Create Key
2. `sk-or-v1-…`
3. `:free` postfix'li modeller (`deepseek/deepseek-r1:free`) ücretsiz; rate-limit'e dikkat.

### Groq · DeepSeek · GLM · xAI · Mistral · Together · Cerebras · Perplexity
Konsol URL'i her birinde `https://console.${vendor}.com/keys` kalıbındadır. Her birinin OpenAI-uyumlu `/v1/chat/completions` endpoint'i vardır.

### Voyage · Cohere · Jina · HuggingFace
Embed-only sağlayıcılar:

| Sağlayıcı | Konsol | Free tier? |
|---|---|---|
| Voyage | https://dash.voyageai.com/ | – |
| Cohere | https://dashboard.cohere.com/ | – |
| Jina | https://jina.ai/embeddings/ | ✅ rate-limited |
| HuggingFace | https://huggingface.co/settings/tokens | ✅ rate-limited |

---

## 3. CORS — Bulut sağlayıcılar için neden proxy gerekiyor?

Bulut LLM API'leri **tarayıcı `Origin` header'ını reddeder** (CORS preflight'a `Access-Control-Allow-Origin: *` döndürmezler). Direkt `fetch("https://api.anthropic.com/...")` çağrısı browser'dan **engellenir**.

TME bu yüzden bulut sağlayıcılar için Edge proxy üzerinden gider:

```
Browser → /api/ai/chat (Edge runtime) → api.anthropic.com
        → /api/ai/embed (Edge runtime) → api.openai.com / api.voyageai.com / …
```

Proxy garantileri:
- **Key redaction:** request log'larında `Authorization` / `x-api-key` / `x-goog-api-key` görünmez.
- **Family branching:** her embed family için ayrı `resolveUrl` + `authHeader` + `forwardBody` (3.3.F'te `route.ts`).
- **Local bypass:** `isLocalUrl(baseUrl)` true ise proxy atlanır → adapter doğrudan tarayıcıdan local servera gider (`docs/PROVIDERS_LOCAL.md`).
- **Custom endpoint reject:** `custom:*` provider id'leri proxy'de 400 `custom_endpoint_forbidden` döner; custom endpoints öyle ya da böyle local olmalı.

`next.config.ts` `connect-src` CSP allowlist'i build-time `deriveConnectOrigins()` (`src/lib/ai/csp-origins.ts`) tarafından `EMBED_PRESETS` + `PROVIDER_PRESETS` üzerinden türetilir — yeni preset eklemek `route.ts` ya da `next.config.ts` düzenlemesi gerektirmez.

---

## 4. Sık karşılaşılan hatalar

| Hata | Sebep | Çözüm |
|---|---|---|
| `401 Unauthorized` | Anahtar boş / yanlış / expired | Settings → Test connection ile doğrula |
| `429 Too Many Requests` | Rate-limit (özellikle free tier) | Backoff + retry; Phase 5 toast UI |
| `403 Forbidden` (proxy yanıtı) | `custom:*` proxy üzerinden istendi | Custom endpoint local olmalı (`isLocalUrl` true) |
| `proxy_local_forbidden` | Local provider id (`ollama` / `lm-studio` / `llama-cpp`) yanlışlıkla proxy'e geldi | Adapter local-bypass koduna düşmeli — bug ise issue aç |
| `embedding dim mismatch` | Workspace farklı dim'li model ile gömülmüş chunks içeriyor | Settings → Embedding sekmesi → Reembed |
| CORS hatası | Bulut sağlayıcısına direkt çağrı yapıldı (proxy atlandı) | `isLocalUrl` mantığı doğru çalışıyor mu kontrol; bug ise issue aç |

---

## 5. Pricing

`src/lib/ai/pricing.ts` içindeki `PRICING` map'i, maliyet **tahmini** için kullanılan USD / 1M token listesidir.

**Repo genelinde bir "snapshot tazeliği" kapısı bilinçli olarak YOK.** BYOK'ta kullanıcı çok sayıda sağlayıcı arasından seçim yapar; her birinin kendi fiyat değişim temposu vardır, üstelik OpenRouter ve rastgele custom endpoint'lerin oranlarını hiç bilemeyiz. Dolayısıyla tek bir tarih, kullanıcının gerçekte faturalandığı satırın güncel olup olmadığını anlatamaz — yanlış bir kesinlik hissi verirdi.

**Fiyat güncelleme prosedürü:**
1. Sağlayıcı pricing sayfalarını dolaş (yukarıdaki konsol URL'leri).
2. `PRICING` map'inde değişen entry'leri güncelle (input / output / cacheRead / cacheCreation).
3. `npm run test:run` + `npm run typecheck` yeşil olmalı.
4. Commit: `chore(pricing): refresh <provider> rates`.

Faturalama otoritesi her zaman sağlayıcının **kendi invoice**'udur — TME pricing'i sadece kullanıcı-gözünde tahminî maliyet için kullanır.

---

## 6. Görmek istediğin sağlayıcı listede yok mu?

İki yol var:

1. **Custom Endpoint** (Settings → API anahtarları → Özel sağlayıcılar) — OpenAI-uyumlu ya da Gemini-uyumlu HER endpoint kabul edilir. CORS sağlayıcının yapılandırmasına bağlı; çoğunlukla self-hosted gateway kullanılırsa local-bypass devreye girer.
2. **Yeni preset PR** — `src/lib/ai/providers/presets.ts` + `pricing.ts` + `presets.test.ts` (kolokasyon — `__tests__/` yok) üçlüsünü güncelle. CSP otomatik genişler (`deriveConnectOrigins` walks PROVIDER_PRESETS).

---

## See also

- `docs/PROVIDERS_LOCAL.md` — Ollama / LM Studio / llama.cpp
- `src/lib/ai/providers/presets.ts` — chat preset registry
- `src/lib/ai/providers/embed-presets.ts` — embed preset registry
- `src/app/api/ai/chat/route.ts` — chat proxy family branching
- `src/app/api/ai/embed/route.ts` — embed proxy family branching (3.3.F)
- `src/lib/ai/pricing.ts` — model pricing + snapshot freshness
