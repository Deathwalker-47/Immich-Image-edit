# Immich AI Editor — Engineering Handoff

> **Audience:** the Claude Code agent (or any engineer) picking up this project.
> **Status at handoff:** App is deployed and *partially* working. A set of provider/model bugs and two frontend crashes remain. Design decisions are finalized (below). **No new code has been written yet** — this document + the finalized plan *are* the work product. Your job is to execute the Build Plan.

---

## 1. What this project is

A text-prompt AI photo editor that integrates with a self-hosted **Immich** photo library. The user picks a photo from their Immich gallery, types an instruction ("make it golden hour", "change her saree to red"), picks an AI model + provider, and gets an edited image back that can be saved to Immich as a new asset. **No masking/inpainting UI** — pure text-driven image-to-image editing.

There is also an Android app: a fork of the Immich mobile app that embeds this web editor in an `InAppWebView`. Mobile is currently working "well enough"; **priority is the web editor**, not the app.

---

## 2. Where everything lives

### Hetzner server (production) — `37.27.191.114`, domain `midnighttavern.online`
- **`/opt/gemini/`** — THE PROJECT (this repo's contents)
  - `backend/` — Node.js + TypeScript + Express API (talks to the 4 AI providers + Immich)
  - `frontend/` — React + Vite + TypeScript web UI
  - `docker-compose.yml`, `.env` (secrets — **never commit**), `.env.example`
  - **NOT a git repo on the server** — Antigravity used scp-deploy from the laptop. This repo was initialized fresh from the deployed state.
- **`/opt/sillytavern-bridge/Silly-Tavern-Flux-Bridge/`** — REFERENCE ONLY (not part of this project). Contains `flux_lora_bridge.py` (2320 lines) with the *proven* Runware LoRA upload + AIR-ID mapping + LoRA-stacking logic to be ported into this project's backend. Also holds the canonical `runware_lora_mapping.json` and `master_lora_dict.json`.
- **Immich itself** — `/opt/immich/`, data on the 50GB volume at `/mnt/HC_Volume_106255600/immich/`, live at `photos.midnighttavern.online`.

### Running containers (docker)
- `immich-ai-backend` — Node backend, host port **3778**
- `immich-ai-frontend` — nginx-served React build, host port **3777**
- Live at **`gedit.midnighttavern.online`** (nginx vhost → 3777, with cert)
- Plus the standard Immich stack: `immich_server`, `immich_postgres`, `immich_machine_learning`, `immich_redis`

### Laptop (Windows) — original source of truth
- `C:\Users\anuji\Documents\antigravity\Immich-Image-edit\` — where Antigravity edited before scp-deploy. May be ahead of/behind the server; **treat the server `/opt/gemini` as canonical** since that's what's actually running and what this repo was built from.
- Mobile fork: `...\immich-mobile-fork\mobile\`

### Deploy flow (how to ship a change)
Edit locally or on server → on the server: `cd /opt/gemini && docker compose build && docker compose up -d`. The frontend is a Vite build baked into the nginx image, so **frontend changes require a rebuild** (a common past bug: forgetting this, then fighting WebView cache).

---

## 3. Backend architecture (`/opt/gemini/backend/src/`)

```
index.ts                 — Express app entry, mounts routes, CORS, health
routes/
  edit.ts                — POST /api/edit — the main endpoint; validates, routes to provider
  immich.ts              — Immich proxy: list/search assets, thumbnails, originals, upload-back
  settings.ts            — GET/PUT /api/settings; holds PROVIDER_MODELS registry (see §5) + defaultSettings
providers/
  index.ts               — shared types (EditRequest, EditResult, ProviderInfo, AppSettings) + router that dispatches to the 4 providers
  fal.ts                 — Fal.ai. Routes Kontext vs SD vs generic; uploads to fal storage; enable_safety_checker:false
  runware.ts             — Runware. imageUpload → imageInference task chain. **Has the invalidPixels bug (§6.1)**
  replicate.ts           — Replicate. Prediction create+poll.
  atlas.ts               — Atlas Cloud (atlascloud.ai). Newest; least battle-tested.
```

**Request/response contract** (`providers/index.ts`): `EditRequest { imageUrl?, imageBase64?, prompt, model, strength?, steps?, negativePrompt? }` → `EditResult { imageUrl, provider, model, width?, height?, seed? }`.

Config is via `.env` (loaded through `process.env`): `IMMICH_URL`, `IMMICH_API_KEY`, `FAL_KEY`, `RUNWARE_API_KEY`, `REPLICATE_API_TOKEN`, `ATLAS_API_KEY`, `PORT=3778`. Settings persist to `backend/data/settings.json` (merged over `defaultSettings`).

## 4. Frontend architecture (`/opt/gemini/frontend/src/`)

```
main.tsx        — React entry
App.tsx         — root component, view routing (gallery ↔ editor)
context/        — React context (settings/provider state)
api/            — fetch wrappers to the backend (editor.ts etc.)
components/     — gallery grid, editor view, settings modal, provider sidebar, preset filter chips
index.css
```
UI flow: **Gallery** (Immich albums + recent photos) → select photo → **Editor** (image preview, prompt box, provider sidebar with Active badge, model dropdown per provider, strength slider, preset chips like "Golden Hour", Apply AI Edit, Save to Immich). Settings modal holds Immich URL/key, default provider, default strength, per-provider API keys + model pickers.

---

## 5. The model registry (single source of truth)

Currently inline in **`routes/settings.ts`** as `const PROVIDER_MODELS: ProviderInfo[]`. **This is where Gemini added hallucinated/wrong model slugs.** It must be rewritten to the finalized model set (§7). Recommended: extract into a dedicated `backend/src/models.ts` module so both `settings.ts` and the providers consume one source.

---

## 6. Confirmed bugs (with root causes)

### 6.1 Runware `invalidPixels` — **root cause identified**
`providers/runware.ts` hardcodes `width: 1024, height: 1024` in the inference task. Runware requires **total pixels between 3,686,400 and 16,777,216**, and dimensions in **64px increments** (256–2048). 1024×1024 = 1,048,576 → below minimum → `{"code":"invalidPixels"}`.
**Fix:** read the source image's dimensions/aspect ratio, compute an output W×H that (a) preserves aspect, (b) snaps both dims to multiples of 64, (c) lands total pixels inside the valid band (target ~2048 on the long edge, or scale until ≥3.69M px). Apply to *all* Runware models (Seedream/Wan/Grok hit the same path).

### 6.2 Fal `Not Found` — wrong/hallucinated model slugs
Only `flux-pro` and `flux-dev` endpoints actually resolve. The SD3/SD3.5 slugs in the registry 404. Fix by replacing the registry with verified slugs (§7) and confirming each against fal's live catalog.

### 6.3 Replicate `404` + `must use a mask or alpha channel`
Two issues: (a) `stability-ai/stable-diffusion-3-medium` and similar slugs are stale/404; (b) some entries route to *inpainting* models that require a mask — invalid for a text-only editor. Only `flux-kontext-pro` was confirmed working. Fix: registry cleanup + ensure Replicate only ever uses instruction-edit models, never mask-required ones.

### 6.4 Atlas — everything 404s (`{"code":400,"msg":"not found"}`)
Atlas endpoint/payload wiring is wrong (it's the newest provider, least tested, and the bridge has NO atlas reference). Must be built against Atlas's live API docs (atlascloud.ai/models). Atlas confirmed to *have* all target models (Seedream v4.5 Edit, Wan-2.7 i2i, Grok Imagine Image Edit, Flux Kontext Dev + Dev Lora) per the user's screenshots.

### 6.5 "Failed to load photos" → stuck intermediate page (frontend robustness)
Immich timeline fetch intermittently fails; the frontend has **no retry and no error boundary**, so the user is trapped on an intermediate page and must go back to gallery and restart. Fix: add retry + a recoverable error state + an error boundary so a failed fetch doesn't dead-end.

### 6.6 Blank white page on Apply AI Edit (frontend crash)
An unhandled exception in React white-screens the whole app; requires full Immich app restart. Fix: wrap the editor in an **error boundary** and handle the throwing path (likely an unguarded response shape from a failing provider edit).

### 6.7 (Known-good, do not regress) Fal black images
Fal's NSFW filter returns solid black. `enable_safety_checker: false` is already injected in `fal.ts` — keep it. Prefer least-filtered endpoints across providers (user prioritizes unrestricted; Runware/Atlas filter least).

---

## 7. FINALIZED model set (verified available on all 4 providers)

The user verified availability via provider catalogs (screenshots). **Rip out everything else Gemini added.** The four models, available on **every** provider (model + provider are independently selectable in the UI; invalid combos disabled):

| Model | Fal slug | Runware AIR | Replicate slug | Atlas |
| --- | --- | --- | --- | --- |
| **FLUX Kontext Dev** | `fal-ai/flux-kontext/dev` | `runware:106@1` (verify) | `black-forest-labs/flux-kontext-dev` | Flux Kontext Dev |
| **FLUX Kontext Dev LoRA** | `fal-ai/flux-kontext-lora` | Kontext base + LoRA array | `black-forest-labs/flux-kontext-dev-lora` | Flux Kontext Dev Lora |
| **Seedream 4.5 (Edit/i2i)** | `fal-ai/bytedance/seedream/v4.5/edit` | Seedream 4.5 AIR | `bytedance/seedream-4.5` | Seedream v4.5 Edit |
| **Wan 2.7 (image edit/i2i)** | (verify fal slug) | `Wan2.7 Image` AIR | `wan-video/wan-2.7-image` | Wan-2.7 Image-to-image |
| **Grok Imagine (image edit)** | `xai/grok-imagine-image/edit` | Grok Imagine Image AIR | `xai/grok-imagine-image` | Grok Imagine Image Edit |

> Default provider = **Runware**, default model = **FLUX Kontext**.
> **All slugs above must be re-verified against each provider's live API before wiring** — do NOT trust from memory (that's the mistake that caused the original bugs). Resolve exact Runware AIR IDs from runware.ai/models; confirm fal slugs from fal.ai/explore; confirm Replicate from replicate.com; build Atlas from atlascloud.ai/models.
> User's quality note: **Wan 2.7 NSFW image edit is best**, just above Seedream 4.5. Prioritize unrestricted endpoints where a provider offers them.

---

## 8. LoRA system (port from the bridge — do NOT reinvent)

The user's ~95 FLUX-Dev LoRAs live at HuggingFace **`anujithc/Nimya_LoRAs`** (public, direct `.safetensors` URLs). They are architecture-compatible with **Kontext Dev LoRA** (confirmed by BFL: FLUX.1-dev LoRAs load and apply on Kontext; minor quality tradeoff acceptable). **LoRA only applies when the selected model is a Kontext Dev LoRA variant.**

### Two source files (both provided by user; canonical copies in the bridge dir)
- **`master_lora_dict.json`** — the DROPDOWN SOURCE. ~85 entries, each: `name` (display), `url` (HF), `weight`, `rank`, `category` (character|general|nsfw|expression), `trigger_words`, `keywords`, `prepend_prompt`, `append_prompt`, `negative_prompt`, `permanent` (bool). Plus a `config` block: `permanent_loras: ["nsfw_master"]`, `default_steps:40`, `default_guidance_scale:3.5`, `default_negative_prompt`.
- **`runware_lora_mapping.json`** — Runware AIR-ID cache: `{ HF_url: { runware_id, uploaded_at } }`. ~50 entries.

### Per-provider LoRA rules (user-specified)
- **Runware** — no cap (stack all selected).
- **Fal** — max **3** LoRAs.
- **Atlas** — max **3** LoRAs.
- **Replicate** — max **1** (if multiple selected, silently take only the first).

### Per-provider LoRA resolution
- **Fal / Atlas / Replicate** → pass the HF `.safetensors` URL directly to the endpoint's `loras`/`lora_weights` field. No upload.
- **Runware** → must be an AIR ID. Look up HF URL in `runware_lora_mapping.json`; if present use `runware_id`; if absent, **upload then cache** (see below).

### Runware upload + self-heal (ported from `flux_lora_bridge.py`)
Port these functions (lines cited from the bridge file):
- `generate_air_id_from_url(hf_url)` (L22) — AIR is **deterministic**: `deathwalker:{sha256(url.strip().lower())[:12]}@1`.
- `upload_lora_to_runware(hf_url, key)` (L38) — POST to `https://api.runware.ai/v1`, taskType `modelUpload`, `deliveryMethod:sync`, `category:lora`, `architecture:flux1d`, `format:safetensors`, `air:<air_id>`, `downloadURL:<hf_url>`, `defaultWeight:1.0`, `private:true`.
- `resolve_runware_loras(loras, key)` (L107) — for each: pass through provider-prefixed IDs; for HTTP URLs check mapping → use cached or upload+save.
- **SELF-HEAL (new, important):** the user hand-created 7 AIR IDs via Postman early on that are NOT real hashes: `deathwalker:424242@1`, `242424@1`, `2748342@1`, `934759374@1`, `347568374@1`, `696969@1`, `38745683@1` (all share timestamp `2026-01-31T11:04:41`). For each mapping entry, recompute the expected AIR from the URL; if `runware_id != deathwalker:{expected_hash}@1`, treat as invalid → re-upload with the correct deterministic AIR → overwrite the mapping entry. Otherwise selecting those LoRAs on Runware silently fails.

### LoRA-stacking / prompt injection (ported from bridge `LoRAManager`)
- v1 = user picks LoRAs from dropdown (we do NOT keyword-match like the bridge does — selection is explicit).
- Apply per-provider cap (above).
- For each selected LoRA, inject its `prepend_prompt` / `append_prompt` around the user's edit instruction, and merge `negative_prompt`s + the `default_negative_prompt`. (Bridge `build_enhanced_prompt`, L672.) Example: pick "Sara Ali Khan" → user types "make her wear a red saree" → sent as "Sara ali khan, make her wear a red saree".
- Respect each LoRA's `weight`.
- `permanent_loras` (config) — for v1, treat as optional; the user said "max 3 LoRAs" flow, so permanent-stacking is a v2 nicety, not required. Do NOT auto-force permanents if it would exceed a provider's cap.

### Persistence
`runware_lora_mapping.json` must live on a **volume-mounted, persistent** path (e.g. `/opt/gemini/backend/data/runware_lora_mapping.json`) so container rebuilds don't wipe it and force re-uploads. Seed it from the canonical copy in the bridge dir.

---

## 9. BUILD PLAN (execute in this order)

1. **Extract & rewrite the model registry** → new `backend/src/models.ts` as single source of truth, containing the §7 matrix (model → per-provider slug/AIR + capabilities + whether it's a LoRA-capable Kontext variant). Update `settings.ts` to import it. Delete all hallucinated models. **Verify every slug against live provider APIs first.**
2. **Rewrite the 4 providers** to consume the registry and correctly map (model, provider) → endpoint + payload:
   - `runware.ts`: fix the pixel bug (§6.1) + add LoRA resolution (§8) + fix Seedream/Wan/Grok payloads.
   - `fal.ts`: correct slugs; keep `enable_safety_checker:false`; add LoRA array (cap 3).
   - `replicate.ts`: instruction-edit models only; add LoRA (cap 1); create+poll.
   - `atlas.ts`: build against live Atlas API; add LoRA (cap 3).
3. **Port the LoRA layer** (§8) into a `backend/src/lora.ts` module: load `master_lora_dict.json`, load/save `runware_lora_mapping.json`, `resolveRunwareLoras` w/ self-heal, `buildEnhancedPrompt`, per-provider cap + URL-vs-AIR resolution.
4. **Add the LoRA dropdown** to the frontend: predefined list from `master_lora_dict.json` (grouped by category), multi-select up to provider cap, **only enabled when model is a Kontext Dev LoRA variant**. Send selected LoRA ids/urls with the edit request.
5. **Fix the two frontend crashes** (§6.5, §6.6): error boundary around the app + editor, retry + recoverable error state on the Immich timeline fetch, guard the edit-response parsing.
6. **Wire the edit request end-to-end**: `EditRequest` gains `loras?: {url|id, weight}[]`; `edit.ts` passes them through; each provider resolves per its rules.
7. **Deploy** (`docker compose build && up -d`) and have the user retest each model×provider and a LoRA edit on Kontext Dev LoRA.

### Test matrix to hand back to the user
For each provider (Runware, Fal, Replicate, Atlas) × each model (Kontext Dev, Kontext Dev LoRA, Seedream 4.5, Wan 2.7, Grok Imagine): one plain edit. Plus: one LoRA edit on Kontext Dev LoRA per provider (Runware exercises the AIR cache + self-heal; others exercise HF-URL passthrough). Plus: force a timeline-fetch failure to confirm the no-more-stuck-page fix; confirm no white-screen on a failing edit.

---

## 10. Security / housekeeping (do first)
- **`.env` contains live API keys** (Immich, Fal, Runware, Replicate, Atlas). It is gitignored in this repo — keep it that way. These keys were exposed in the planning chat; **the user should rotate all five** and update `/opt/gemini/.env` + `docker compose up -d`.
- `.gitignore` excludes: `.env`, `node_modules/`, `dist/`, `build/`, `backend/data/*.json` (runtime settings/mappings — but DO commit a seed copy of `runware_lora_mapping.json` under a non-runtime path, or document seeding).
- Server outbound **port 22 is firewalled** (GitHub SSH won't work from the box) — use HTTPS remotes or push from the laptop. Outbound 443 works.
- Immich disk: 50GB volume, ~46GB free at handoff. Editor outputs saved back to Immich consume it; watch `df`.

---

## 11. Cleanup already done this session
- Removed the abandoned **Grok** editor stack (`/opt/grok/`, container `immich-ai-editor` on :8088, `xedit.midnighttavern.online` vhost).
- Removed a stray half-built FastAPI attempt at `/opt/immich-editor/`.
- The live **Gemini** build at `/opt/gemini` (this repo) was **not modified** — it is exactly the Antigravity-deployed state.

---

*Bridge reference file: `/opt/sillytavern-bridge/Silly-Tavern-Flux-Bridge/flux_lora_bridge.py`. Key line numbers cited in §8. Read it for the exact, working Runware/LoRA implementation before porting.*
