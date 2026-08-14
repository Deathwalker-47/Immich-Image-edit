# Agent Handoff — Immich AI Editor + Flux Bridge

**Written:** 2026-08-14 · **By:** the outgoing Claude Code session · **For:** the next agent
**Read this before touching anything.** It supersedes parts of `HANDOFF.md` — see §3, which corrects a diagnosis in that document that would break a working code path if followed.

---

## 1. TL;DR — where things stand

Two repos, two open PRs, both green, **neither merged, neither deployed**.

| Repo | Branch | PR | State |
|---|---|---|---|
| `Deathwalker-47/Silly-Tavern-Flux-Bridge` | `claude/flux-kontext-bridge-1mxlxo` | [#20](https://github.com/Deathwalker-47/Silly-Tavern-Flux-Bridge/pull/20) | **Complete.** CodeQL green, mergeable, 2 commits, 87/92 tests pass |
| `Deathwalker-47/Immich-Image-edit` | `claude/flux-kontext-bridge-1mxlxo` | [#1](https://github.com/Deathwalker-47/Immich-Image-edit/pull/1) | **In progress.** Backend typechecks clean; ~55% of the build plan done |

Your job is to finish the Immich AI Editor (repo 2). The bridge (repo 1) is done and is now **reference only**.

**Nothing has been run against a live API.** No provider keys existed in the outgoing session. Every slug and payload shape below was verified against *published documentation*, never a live call. The first real request remains the source of truth.

---

## 2. What the projects are

### Immich AI Editor — the actual project
A text-prompt AI photo editor over a self-hosted Immich library. Pick a photo, type "make it golden hour", pick model + provider, get an edited image, save it back to Immich as a new asset. **No masking UI** — pure instruction-driven editing.

- **React + Vite frontend**, **Node + TypeScript + Express backend**
- Four providers: Runware (default), Fal, Replicate, Atlas
- Lives on the Hetzner box at `/opt/gemini/`, served at `gedit.midnighttavern.online`
- An Android app (fork of Immich mobile) embeds the web editor in an `InAppWebView`. **Web is the priority**, per the project owner.

### Silly-Tavern-Flux-Bridge — reference only
A Python/FastAPI bridge for SillyTavern image generation. PR #20 added FLUX Kontext editing and an Immich integration to it. **It is not part of the editor** and the editor must not depend on it. Its value to you is the *proven Runware LoRA logic* (`flux_lora_bridge.py`), which PR #1 has already ported into TypeScript.

> Early in the session the owner said they'd call the bridge's API from the editor. The later `HANDOFF.md` supersedes that: the editor has its own provider layer and the bridge is explicitly "REFERENCE ONLY". **Follow HANDOFF.md.** Don't wire the editor to the bridge.

---

## 3. ⚠️ Corrections to `HANDOFF.md`

`HANDOFF.md` is largely accurate and you should read it. Two things in it are wrong.

### 3.1 §6.1's `invalidPixels` diagnosis is wrong — following it breaks Kontext

§6.1 says Runware requires a total area of 3.69–16.78MP for **every** model, and the fix is to scale all output into that band.

That constraint belongs to **Seedream 4.5 alone.** Verified per-model constraints:

| Model | Runware constraint |
|---|---|
| FLUX Kontext | 9 **fixed** dimension pairs, 672–1568 per side (max ≈1.05MP) |
| Seedream 4.5 | **area 3.69–16.78MP**, any dims 256–16383 |
| Wan 2.7 Image | 768–2048 per side, **16px increments** |
| Grok Imagine | `resolution` preset; **rejects width/height sent alongside it** |

So `1024x1024` is an explicitly *valid* Kontext size — Kontext was never the model returning `invalidPixels`; **Seedream was**. Applying a 3.69MP floor to Kontext (max ≈1.05MP) would take a working path and break it.

This is already fixed in `backend/src/sizing.ts` as per-model rules. **Don't "fix" it back.**

### 3.2 Two Runware bugs §6 doesn't list

1. The input image was sent as **`inputImage`**. These models take **`inputs.referenceImages`** — an array, nested under `inputs`. Wrong field name = the source image is ignored or the request fails.
2. `steps` / `strength` / `negativePrompt` were sent to models that document none of them. Undocumented params can hard-fail a request. Parameters are now gated on per-model capability flags.

Both fixed in the rewritten `backend/src/providers/runware.ts`.

---

## 4. Verified facts — do not re-derive these

Hard-won, checked against live docs. Re-verifying costs time; **assuming from memory is what caused the original bug wave.**

### 4.1 Runware AIR ids — all confirmed

| Model | AIR | Previously in the code |
|---|---|---|
| FLUX Kontext Dev | `runware:106@1` | ✅ correct |
| FLUX Kontext Pro | `bfl:3@1` | — |
| FLUX Kontext Max | `bfl:4@1` | — |
| Seedream 4.5 | `bytedance:seedream@4.5` | ✅ correct |
| Wan 2.7 Image | `alibaba:wan@2.7-image` | ❌ was `alibaba:wan@2.7-image-pro` |
| Grok Imagine Image | `xai:grok-imagine@image` | ❌ was `xai/grok-imagine` |

### 4.2 Runware payload shape

- Reference images go in **`inputs.referenceImages`** (array), *not* `inputImage` / `seedImage`.
- Kontext **pro/max (`bfl:*`) do NOT accept `steps` or `CFGScale`.** Kontext **dev (`runware:106@1`) does** (steps 1–50, CFGScale 0–20).
- Seedream, Wan and Grok document **no** `steps`/`CFGScale`.
- Reference image caps: Kontext **2**, Grok **3**, Wan **1**, Seedream **14**.
- `imageUpload` task → read back **`imageUUID`**, then pass that UUID as a reference. Uploads are kept 30 days and stored at max 2048px.
- Runware can report **task errors inside an HTTP 200 body** under an `errors` key. Check for it or you'll get a confusing "no image found" downstream.

### 4.3 The 9 FLUX Kontext dimension pairs

`1568x672 · 1392x752 · 1248x832 · 1184x880 · 1024x1024 · 880x1184 · 832x1248 · 752x1392 · 672x1568`

Snap the source aspect ratio to the nearest pair — that's how portrait photos stay portrait.

### 4.4 LoRA self-heal — confirmed against the real data

`HANDOFF.md` §8 predicts hand-made AIR ids that silently no-op. **Confirmed by recomputing all 50 cached ids: 7 are invalid**, all sharing timestamp `2026-01-31T11:04:41`:

```
deathwalker:424242@1     → deathwalker:3a4e8fbb3b63@1
deathwalker:242424@1     → deathwalker:385a1adf5be6@1
deathwalker:2748342@1    → deathwalker:b5a60527f7e8@1   ← nsfw_master (the permanent LoRA)
deathwalker:934759374@1  → deathwalker:b846f0360ddf@1
deathwalker:347568374@1  → deathwalker:12dcf285240c@1
deathwalker:696969@1     → deathwalker:2c9225040e8b@1
deathwalker:38745683@1   → deathwalker:f934893590a1@1
```

AIR = `deathwalker:{sha256(url.strip().lower())[:12]}@1`. Already handled by `healMapping()` in `lora.ts`.

### 4.5 Immich API (verified — used by the bridge, useful if you touch `routes/immich.ts`)

- Auth: `x-api-key` header
- Upload: `POST /api/assets`, multipart, **requires `deviceAssetId` AND `deviceId`** plus `fileCreatedAt`/`fileModifiedAt`. Use a unique `deviceAssetId` per edit or uploads collide.
- Albums: `GET /api/albums` · `POST /api/albums` `{albumName}` · `PUT /api/albums/{id}/assets` `{ids: [...]}`
- Media: `GET /api/assets/{id}/original` · `GET /api/assets/{id}/thumbnail?size=preview`
- **Immich has no UI plugin API.** v3.0.0 (July 2026) added a plugin system, but it's server-side event-driven automation (Extism/Wasm, triggers→filters→actions). There is no extension point in the photo viewer or editor, web or mobile. That's *why* this project is a separate web app.

### 4.6 Fal / Replicate — partially verified

- `fal-ai/flux-kontext-lora` — **confirmed to exist**
- Replicate carries the `flux-kontext` family and `bytedance/seedream-*` — exact slugs **unconfirmed**
- **Atlas: entirely unverified.** No public API docs were reachable. See §6.

---

## 5. What PR #1 already does

All in `backend/src/`. **`tsc --noEmit` passes.**

| File | Status | What it does |
|---|---|---|
| `models.ts` | **new** | Registry, single source of truth. Every entry has an explicit `verified` flag + a note. Per-model dimension rules, capability flags, LoRA-capable flag, per-provider LoRA caps |
| `sizing.ts` | **new** | Per-model size resolution from source aspect ratio; reads image dimensions from JPEG/PNG/WEBP/GIF headers (no new dependency) |
| `lora.ts` | **new** | Deterministic AIRs, upload-and-cache, **self-heal**, per-provider caps, trigger-word prompt injection, UI catalogue |
| `providers/runware.ts` | **rewritten** | Sizing, `inputs.referenceImages`, capability-gated params, LoRA stacking, 200-with-errors handling |
| `providers/fal.ts` | **rewritten** | Registry slugs (no more substring matching), LoRA cap 3, `enable_safety_checker:false` **kept**, 404s name the registry entry to fix |
| `providers/replicate.ts` | **rewritten** | Registry slugs, LoRA cap 1, mask-required errors name the entry to remove |
| `providers/index.ts` | edited | `EditRequest` gains `loras[]` and `cfgScale` |
| `routes/edit.ts` | **rewritten** | Registry validation, LoRA prompt injection, `GET /api/edit/loras`, clear error when LoRAs are sent to a non-LoRA model |
| `routes/settings.ts` | edited | Consumes the registry; hallucinated inline list deleted; default is now Runware + Kontext |

---

## 6. What's left — in priority order

### 1. Frontend crashes (`HANDOFF.md` §6.5, §6.6) — **do this first**
Highest user pain, zero dependency on provider work, and the only items that currently strand the user in the UI.
- Error boundary around app + editor (a throw currently white-screens the whole app and needs an Immich app restart)
- Retry + recoverable error state on the Immich timeline fetch (currently dead-ends on an intermediate page)
- Guard the edit-response parsing — the likely throw source is an unguarded response shape from a failing provider

Files: `frontend/src/App.tsx`, `components/Gallery/Gallery.tsx`, `components/Editor/EditorPanel.tsx`, `api/immich.ts`, `api/editor.ts`

### 2. Verify Fal + Replicate slugs, then flip `verified: true`
Every unverified entry in `models.ts` has a `note` saying what to check. **This is a data edit in one file, not a code change** — the registry indirection is already in place.

### 3. LoRA picker in the frontend
Backend is ready: `GET /api/edit/loras` returns the catalogue grouped by category, with per-provider caps. Needs a multi-select, enabled **only** when the model is `flux-kontext-dev-lora`, capped per provider, sending `loras: [{id, weight}]` to `POST /api/edit`.

### 4. Atlas provider (`providers/atlas.ts` — untouched)
Deliberately not attempted. Its API shape could not be verified from the outgoing environment, and building it blind is exactly what produced bug §6.4. **Get the live atlascloud.ai API shape first.** The owner has screenshots confirming Atlas carries all target models.

### 5. Deploy + run the §9 test matrix
4 providers × 5 models, plus a LoRA edit per provider. Runware exercises the AIR cache + self-heal; the others exercise HF-URL passthrough.

---

## 7. Environment gotchas

- **Deploy:** edit → on the server `cd /opt/gemini && docker compose build && docker compose up -d`. The frontend is a Vite build baked into the nginx image, so **frontend changes need a rebuild** — forgetting this and then fighting WebView cache has burned time before.
- **`/opt/gemini` is not a git repo.** It was scp-deployed. The GitHub repo was initialised from the deployed state. Treat the server as canonical for "what's running", the repo for "what's intended".
- **Outbound port 22 is firewalled** on the server — GitHub SSH won't work from the box. Use HTTPS remotes or push from the laptop.
- **`.env` holds five live API keys** (Immich, Fal, Runware, Replicate, Atlas) and is gitignored — keep it that way. `HANDOFF.md` §10 notes these were exposed in a planning chat and **should be rotated**. As far as this session knows, that hasn't happened yet.
- **`backend/data/` must be volume-mounted and persistent.** `runware_lora_mapping.json` lives there; losing it forces a full re-upload of ~50 LoRAs. `lora.ts` seeds it from the committed copy at repo root on first run.
- The outgoing session generated `backend/package-lock.json` while typechecking. It was **not committed** (the repo has never had one) — commit it or delete it as you prefer.

---

## 8. The bridge PR (#20) — for completeness

Complete, green, unmerged. Nothing is needed from you unless the owner asks.

Adds to `flux_lora_bridge.py`: `POST /edit` (Kontext instruction editing), `POST /edit/immich` (edit an Immich asset and file the result into an "AI Edits" album), `GET /edit-ui` (mobile-friendly browser UI), `POST /sdapi/v1/img2img` (A1111 alias), and `/immich/*` browsing proxies. Plus `EDIT_API_TOKEN` bearer auth on the endpoints that spend Runware credits, checked *before* any provider call.

It also fixed three pre-existing bugs found while testing: the response parser didn't know Runware's `imageBase64Data`/`imageDataURI` fields (and picked up the neighbouring `taskType` string as the image); the test stubs shadowed a real Pillow install so the whole suite couldn't import the module; and the stub modules disagreed, making tests pass alone but fail under `unittest discover`.

**5 tests fail and always will**: they test `PixelDojoClient`/`HFClient`, which no longer exist in the source. Left alone deliberately — deleting the owner's tests wasn't this session's call. Removing them is a reasonable cleanup if asked.

---

## 9. Working agreements worth keeping

- **Verify slugs and payload shapes against live docs before wiring.** This session found 2 wrong AIRs, a wrong payload field, and a wrong root-cause diagnosis purely by checking. `HANDOFF.md` says the same thing and it's right.
- **Mark what you didn't verify.** The `verified: false` + `note` pattern in `models.ts` exists so unchecked assumptions stay visible instead of dissolving into apparent fact.
- **Say plainly what wasn't run.** Nothing here has touched a live provider API or a real Immich instance.
- The owner prioritises **unrestricted output** — keep `enable_safety_checker: false` on fal and prefer the least-filtered endpoint a provider offers. Their quality ranking: **Wan 2.7 > Seedream 4.5** for NSFW edits.

---

## 10. First five minutes

```bash
git clone https://github.com/Deathwalker-47/Immich-Image-edit
cd Immich-Image-edit
git checkout claude/flux-kontext-bridge-1mxlxo   # PR #1 — start here, don't start from main

cat HANDOFF.md                                   # original spec; read §3 above first
cat AGENT_HANDOFF_2026-08-14.md                  # this file

cd backend && npm install && npx tsc --noEmit    # should pass clean
```

Then start at §6 item 1 (frontend crashes).
