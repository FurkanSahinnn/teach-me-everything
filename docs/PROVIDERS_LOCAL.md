# Local & Self-Hosted Sağlayıcılar

> Teach Me Everything (TME) Phase 3.2 itibarıyla **yerel / self-hosted** OpenAI-uyumlu sunucularla çalışır. Bu sayfa Ollama, LM Studio ve llama.cpp için CORS kurulumunu, reverse proxy alternatifini ve sık karşılaşılan sorunları kapsar.
>
> **Gizlilik garantisi:** Yerel adres (`localhost`, `127.0.0.1`, `[::1]`, `*.local`) tespit edildiğinde adapter `/api/ai/chat` Edge proxy'sini **atlar** — istek doğrudan tarayıcıdan kendi makinene gider. Network sekmesinde dış istek görmemelisin.

---

## Hızlı bakış

| Servis | Default port | API yolu | Auth | Tool use |
|---|---|---|---|---|
| Ollama | `11434` | `/v1/chat/completions` | opsiyonel Bearer | native (3.x+) |
| LM Studio | `1234` | `/v1/chat/completions` | opsiyonel Bearer | JSON-prompt fallback |
| llama.cpp server | `8080` | `/v1/chat/completions` | `--api-key` opsiyonel | JSON-prompt fallback |

Hepsi OpenAI-uyumlu olduğundan TME'nin `OpenAICompatChatProvider` adapter'ı tek kod yoluyla çalışır.

---

## 1. Ollama

### Kurulum
```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# https://ollama.com/download adresinden installer
```

### Modeli indir + çalıştır
```bash
ollama pull qwen2.5:14b
ollama pull nomic-embed-text          # embedding için (opsiyonel)
ollama serve                          # default port 11434
```

### CORS — `OLLAMA_ORIGINS` env var

TME tarayıcıdan doğrudan `localhost:11434`'e istek attığı için Ollama'nın CORS izni **kullanıcının origin'ini** kabul etmelidir. Aksi halde tarayıcı CORS preflight'ı başarısız olur.

**Linux (systemd) — `/etc/systemd/system/ollama.service` override:**
```bash
sudo systemctl edit ollama.service
# Açılan editöre ekle:
[Service]
Environment="OLLAMA_ORIGINS=https://teach-me-everything.app,http://localhost:3000,http://localhost:*"

sudo systemctl daemon-reload
sudo systemctl restart ollama
```

**macOS — launchd plist:**
```bash
launchctl setenv OLLAMA_ORIGINS "https://teach-me-everything.app,http://localhost:*"
# Ollama'yı yeniden başlat (menü çubuğundaki simge → Quit, sonra `ollama serve`)
```

**macOS — `.zshrc` / `.bash_profile` (geliştirici terminal'inden başlatıyorsan):**
```bash
echo 'export OLLAMA_ORIGINS="https://teach-me-everything.app,http://localhost:*"' >> ~/.zshrc
source ~/.zshrc
ollama serve
```

**Windows (PowerShell, kalıcı System Environment Variable):**
```powershell
[System.Environment]::SetEnvironmentVariable(
  "OLLAMA_ORIGINS",
  "https://teach-me-everything.app,http://localhost:*",
  "User"
)
# Sistemden çıkış / giriş yap, sonra Ollama uygulamasını yeniden aç
```

### Doğrulama
TME → Settings → API anahtarları → Özel sağlayıcılar → `+ Ollama` quick-start → Save → "Bağlantıyı test et" yeşil ✓ döndürmeli.

CLI ile:
```bash
curl http://localhost:11434/v1/chat/completions \
  -H "content-type: application/json" \
  -d '{"model":"qwen2.5:14b","messages":[{"role":"user","content":"hi"}]}'
```

---

## 2. LM Studio

### CORS toggle
1. LM Studio'yu aç
2. **Developer** sekmesi (sol kenar çubuğu)
3. **Local Server** kartı → **Server Settings**
4. **"Enable CORS"** anahtarını aç
5. **"Just-in-time model loading"** opsiyonel (TME ne model istersek otomatik yüklenir)
6. **Start Server** (default port 1234)

LM Studio CORS'u açıkken `Access-Control-Allow-Origin: *` döndürür — herhangi bir origin'den çalışır.

### Doğrulama
TME → Settings → Özel sağlayıcılar → `+ LM Studio` → Save → Test ✓.

> **Tool use uyarısı:** LM Studio default modellerde OpenAI tool calling spec'ini tam desteklemeyebilir. TME LM Studio preset'ini `toolUse: "json"` ile işaretler — Phase 3.2.E'deki JSON-via-prompt fallback ile `add_flashcard` çalışır.

---

## 3. llama.cpp (server modu)

### Build + çalıştır
```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build && cmake --build build --config Release

# Modeli indir (örn. Qwen2.5)
./build/bin/llama-server \
  --model models/qwen2.5-7b-instruct-q5_k_m.gguf \
  --port 8080 \
  --api-key sk-llama-local-secret-12345 \
  --ctx-size 8192 \
  --cors-origin "https://teach-me-everything.app" \
  --cors-origin "http://localhost:3000"
```

### Flag açıklamaları

| Flag | Notlar |
|---|---|
| `--api-key <key>` | Opsiyonel. Set edilirse TME'ye aynı key'i girmen gerekir. |
| `--cors-origin <url>` | Birden fazla `--cors-origin` flag'i kabul edilir. Tarayıcı origin'ini eklemediğin sürece request preflight'ta düşer. |
| `--port` | TME default `8080` bekler. Farklı port istersen Custom Endpoint formundan baseUrl'i değiştir. |

### Doğrulama
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "content-type: application/json" \
  -H "Authorization: Bearer sk-llama-local-secret-12345" \
  -d '{"messages":[{"role":"user","content":"ping"}]}'
```

---

## 4. Reverse proxy alternatifi

Yerel servisini ters proxy'lemek istersen (HTTPS sertifikası, single port, CORS merkezleştirme), iki minimal örnek:

### nginx
```nginx
server {
  listen 8443 ssl;
  server_name local-llm.example;
  ssl_certificate     /etc/ssl/local-llm.crt;
  ssl_certificate_key /etc/ssl/local-llm.key;

  location /v1/ {
    proxy_pass http://127.0.0.1:11434/v1/;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    chunked_transfer_encoding on;

    # SSE için zorunlu
    proxy_read_timeout 1h;

    # CORS
    add_header Access-Control-Allow-Origin "https://teach-me-everything.app" always;
    add_header Access-Control-Allow-Headers "authorization,content-type" always;
    if ($request_method = OPTIONS) { return 204; }
  }
}
```

### Caddy (otomatik HTTPS)
```caddy
local-llm.example {
  handle /v1/* {
    reverse_proxy 127.0.0.1:11434

    header {
      Access-Control-Allow-Origin "https://teach-me-everything.app"
      Access-Control-Allow-Headers "authorization,content-type"
    }
    @options method OPTIONS
    respond @options 204
  }
}
```

Caddy kullanırsan `local-llm.example` otomatik LetsEncrypt sertifikası alır (yerel domain için `internal` directive ile self-signed CA).

---

## 5. LAN üzerinden (192.168.x.y, 10.x.y.z)

CSP source-expression grammar IP wildcard'ı **desteklemez** (`http://192.168.*` çalışmaz). Üç seçeneğin var:

### A. mDNS (`*.local`)
Ollama box'ında `avahi-daemon` (Linux) veya Bonjour (macOS) çalışıyorsa, `myhost.local:11434` adresi TME'nin built-in CSP allowlist'inden geçer. En temiz çözüm.

```bash
# Linux: avahi kur
sudo apt install avahi-daemon
sudo systemctl enable --now avahi-daemon

# Hostname'i otomatik publish eder; ${hostname}.local olarak erişilir
```

### B. Localhost reverse proxy
LAN box'ı `localhost:8080` ile ters proxy'le (yukarıdaki nginx/Caddy snippet'leri). TME tarayıcısı `localhost`'a istek atar, proxy LAN box'ına forward eder.

```nginx
location /v1/ {
  proxy_pass http://192.168.1.5:11434/v1/;  # gerçek LAN IP
  # ... diğer ayarlar
}
```

### C. CSP'yi kendin genişlet (gelişmiş)
TME open-source — `next.config.ts`'i fork'la, `LOCAL_ORIGINS`'a kendi LAN IP'ni ekle:

```ts
const LOCAL_ORIGINS = [
  // ...mevcut
  "http://192.168.1.5:11434",  // örn: ev sunucum
];
```

`npm run build` → kendi build'inde CSP genişletilmiş halde gelir.

---

## 6. Sorun giderme

### "Network error" / CORS preflight 404
- CORS env var / flag'i set etmedin
- Servisi yeniden başlatmadın (env var kalıcı olabilmesi için)
- Tarayıcı geliştirici konsolunda gerçek hata mesajını gör (`Access-Control-Allow-Origin missing`)

### Mixed-content uyarısı (kırmızı kilit)
- TME HTTPS'te (`teach-me-everything.app`), yerel sunucun HTTP'de (`http://localhost:11434`)
- Modern tarayıcılar `http://localhost`'a izin verir — `127.0.0.1` ve `[::1]` de güvenli context sayılır
- LAN IP'ler güvenli context değil → reverse proxy ile HTTPS terminate et

### CSP "Refused to connect"
Tarayıcı konsolunda `Refused to connect to ... because it violates the Content Security Policy`:
- Kullandığın URL TME'nin CSP allowlist'inde değil
- `localhost`/`127.0.0.1`/`[::1]`/`*.local` dışı bir host kullanıyorsan yukarıdaki **§5** seçeneklerinden birini uygula

### Ollama "model not found"
- `ollama list` ile yüklü modelleri gör
- TME default `qwen2.5:14b`; farklı modelin varsa Custom Endpoint formundan değiştir veya `defaultModels.chat`'i preset'te güncelle

### Streaming gecikmeli / parça parça gelmiyor
- Reverse proxy `proxy_buffering off` (nginx) veya equivalent flag set
- nginx `proxy_read_timeout` 1h+ olmalı (uzun yanıtlar için)
- LM Studio özellikle ilk istekte modeli yüklerken gecikir — JIT yükleme açıksa ısınma turu normal

---

## 7. Mimari notlar

| Katman | Davranış |
|---|---|
| `lib/ai/providers/local-bypass.ts` | `isLocalUrl(url)` pure fn — `localhost` / `127.0.0.1` / `[::1]` / `*.local` / RFC1918 (10/8, 192.168/16, 172.16-31/12) tespit eder |
| `OpenAICompatChatProvider.streamChat` | URL local ise `/api/ai/chat` proxy'sini atla, doğrudan `${baseUrl}/chat/completions`'a fetch et; key boşsa `Authorization` header'ını omit et |
| `CustomEndpointSection` | Settings'te kullanıcı listesi + 3 quick-start (Ollama / LM Studio / llama.cpp pre-fill) |
| `next.config.ts` `LOCAL_ORIGINS` | CSP `connect-src` runtime allowlist — `*.local` mDNS dahil |
| `findCustomEndpoint(id)` | `usePrefs` store'dan zustand-getState ile sync lookup; registry runtime'da preset synthesize eder |

**Veri akışı (yerel):** TME tarayıcı → `fetch http://localhost:11434/v1/chat/completions` → SSE response → `consumeOpenAICompatStream` → ChatBubble. **Ne /api/ai/chat'e ne de Anthropic/OpenAI'a hiçbir istek gitmez.**

---

**Son güncelleme:** 2026-04-29 · Phase 3.2.D-mini
