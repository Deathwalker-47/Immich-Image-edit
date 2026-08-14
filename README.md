# Immich AI Photo Editor

AI-powered photo editor plugin for your self-hosted [Immich](https://immich.app/) instance. Edit photos with natural language using **FLUX Kontext**, Stable Diffusion and more — powered by Fal.ai, Runware, Replicate, and Atlas Cloud.

> **Inspired by Samsung Galaxy AI Edit and Google Photos Magic Editor — for your own private photo library.**

---

## ✨ Features (v1)

- 🖼️ **Browse your Immich library** — Albums and timeline view
- 💬 **Text-based AI editing** — "Make it golden hour", "Cinematic look", "Vibrant colors"
- 🤖 **4 AI Providers** — Fal.ai, Runware, Replicate, Atlas Cloud (switchable in Settings)
- 🎛️ **10 preset prompts** — One-click style presets
- ↔️ **Before/After comparison** — Draggable divider slider
- 🕐 **Edit history** — Step through your edit stack
- 💾 **Save back to Immich** — Uploaded as new asset in "AI Edits" album (non-destructive)
- ⬇️ **Download** — Save edited image locally
- ⚙️ **Full settings UI** — Configure all API keys and providers without touching files

---

## 🚀 Deployment on Hetzner (Docker)

### Prerequisites
- Your existing Immich stack running (Docker network: `immich_default`)
- API keys for at least one AI provider

### Step 1 — Clone & configure

```bash
git clone <this-repo>
cd Immich-Image-edit

# Copy and edit the environment file
cp .env.example .env
nano .env
```

Fill in at minimum:
```env
IMMICH_INTERNAL_URL=http://immich-server:2283    # Internal Docker URL
IMMICH_PUBLIC_URL=https://photos.yourdomain.com  # Your public Immich URL
IMMICH_API_KEY=your_immich_api_key_here

# At least one AI provider:
FAL_KEY=your_fal_api_key_here
# or
RUNWARE_API_KEY=your_runware_api_key_here
# or
REPLICATE_API_TOKEN=your_replicate_token_here
# or
ATLAS_API_KEY=your_atlas_api_key_here
```

### Step 2 — Deploy

```bash
docker compose up -d --build
```

The editor will be available at: **`http://your-hetzner-ip:3777`**

### Step 3 — Configure via UI

Open the app and click ⚙️ **Settings** to:
- Verify your Immich connection
- Set/change API keys
- Switch default AI provider and model

---

## 🔑 Getting API Keys

| Provider | Docs | Free Tier |
|---|---|---|
| **Fal.ai** | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) | $1 free credits |
| **Runware** | [runware.ai/account](https://runware.ai/account/api-keys) | Free tier available |
| **Replicate** | [replicate.com/account](https://replicate.com/account/api-tokens) | Pay per run |
| **Atlas Cloud** | [atlascloud.ai/dashboard](https://www.atlascloud.ai/dashboard) | Credits available |

---

## 🤖 AI Models Used

All providers use **FLUX Kontext** for text-based editing by default (best quality for in-context image editing):

| Provider | Default Model | Other Options |
|---|---|---|
| Fal.ai | `flux-kontext/max` | kontext/pro, kontext/dev, SD3 |
| Runware | FLUX Kontext | FLUX Dev, DreamShaper XL |
| Replicate | `flux-kontext-pro` | flux-kontext-max, FLUX dev, SD3.5 |
| Atlas Cloud | `flux-kontext-pro` | flux-kontext-max, Seedream 3, Nano Banana 2 |

---

## 🏗️ Architecture

```
Hetzner Docker
├── immich-server (existing, port 2283)
│   └── REST API
├── immich-ai-backend (NEW, port 3778)
│   ├── Immich API proxy (avoids CORS)
│   ├── AI provider router
│   └── Image upload back to Immich
└── immich-ai-frontend (NEW, port 3777)
    └── Vite + React UI served by nginx
```

Both new containers join the existing `immich_default` Docker network, so the backend can reach Immich directly without going through the internet.

---

## 🔧 Local Development

```bash
# Backend
cd backend
npm install
cp ../.env.example ../.env   # edit .env
npm run dev                   # starts on :3778

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                   # starts on :5173 with proxy to :3778
```

---

## 📁 Project Structure

```
immich-ai-editor/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── src/
│   │   ├── index.ts           # Express server
│   │   ├── routes/
│   │   │   ├── immich.ts      # Immich API proxy
│   │   │   ├── edit.ts        # AI edit endpoint
│   │   │   └── settings.ts    # Settings R/W
│   │   └── providers/
│   │       ├── fal.ts         # Fal.ai
│   │       ├── runware.ts     # Runware
│   │       ├── replicate.ts   # Replicate
│   │       └── atlas.ts       # Atlas Cloud
└── frontend/
    └── src/
        ├── components/
        │   ├── Editor/         # Before/After, PromptInput, History
        │   ├── Gallery/        # Album browser, photo grid
        │   ├── Settings/       # Settings modal
        │   └── Toast/          # Notifications
        ├── context/            # Global React state
        └── api/                # API client functions
```

---

## 🔮 Roadmap (v2)

- [ ] Object masking & inpainting
- [ ] Wan 2.7 video editing
- [ ] Grok image editing (when API available)
- [ ] Edit history persistence (across sessions)
- [ ] Batch editing (multiple photos)
- [ ] Custom prompt templates
- [ ] EXIF metadata preservation

---

## 📄 License

MIT — personal use and self-hosting.