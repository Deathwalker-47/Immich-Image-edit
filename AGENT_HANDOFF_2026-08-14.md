# Agent Handoff — Immich AI Editor

**Last updated:** 2026-08-14 (late session) · Supersedes all earlier versions of this file.
**Read §2 before touching sizing or model slugs** — it corrects a diagnosis in `HANDOFF.md` that would break working code if followed.

---

## 1. State: `main` @ `045f60f`, clean, pushed

Backend and frontend both typecheck and build clean. **Not yet deployed.**

The provider/editing layer is proven — 16 real edits against live APIs. The **Immich layer is not** — no Immich instance was ever reachable from the environment this was built in, so every Immich code path is doc-verified only. That is the single biggest risk area and the first thing to check on deploy.

### Works, live-confirmed

| Provider | Models confirmed end-to-end |
|---|---|
| **Runware** (default) | Kontext Dev, Kontext **Pro**, Kontext **Max**, Seedream 4.5, Wan 2.7 Image, Wan 2.7 Image **Pro**, Qwen Image 2.0 Pro, Grok Imagine |
| **Replicate** | Kontext Dev, Kontext Dev LoRA (with a compatible LoRA file) |
| **Atlas** | Kontext Dev, Kontext Dev LoRA, Seedream 4.5, Wan 2.7, Grok Imagine |
| **Fal** | ❌ untested — account balance exhausted. Code is correct and error-surfacing was fixed; needs credit to verify. |

### Known limitations (not bugs — don't "fix" these)

- **Runware cannot apply LoRAs to Kontext Dev.** Confirmed exhaustively: it rejects every LoRA with `unsupportedLoraModel` even freshly uploaded and correctly tagged (`flux1d` — verified as the only valid FLUX value by reading back Runware's own `allowedValues` enum). A platform limitation, not fixable client-side. **Use Replicate or Atlas for LoRA edits.** `runware.ts` now throws a clear error rather than silently returning a LoRA-free image — that silent drop was the original, more dangerous failure mode. Do not reintroduce a retry here.
- **Seedream 5.0 Pro** — request shape confirmed correct (clean validation, no 400), but two live attempts both hit a Runware-side `504 failedTaskTimeout` at ~122s. Looks like backend load for that model. Worth retrying another time.
- **GPT Image 2 was deliberately removed** and replaced with Wan 2.7 Image Pro — OpenAI enforces its own policy regardless of the `moderation` parameter, making it a poor fit for this project's unfiltered-output goal.

---

## 2. ⚠️ Corrections to `HANDOFF.md` (the original spec)

`HANDOFF.md` is still worth reading, but two things in it are wrong:

**§6.1's `invalidPixels` diagnosis.** It says Runware requires 3.69–16.78MP for *every* model. That band belongs to **Seedream 4.5 alone**. Kontext accepts 9 fixed pairs topping out near 1.05MP — so `1024x1024` is a *valid* Kontext size, and Kontext was never the model throwing that error. Applying Seedream's floor globally would break Kontext. Constraints are per-model in `sizing.ts`; each model has its own `DimensionRule`. Never consolidate them into a shared constant.

**§6.5's "intermittent" timeline failure.** It wasn't intermittent — `routes/immich.ts` called `GET /assets?page=`, the `getAllAssets` endpoint removed in immich-app/immich#9715, which 404s every time. Album browsing used a different, still-valid endpoint and kept working, which made it *look* intermittent. Now uses `POST /search/metadata`. **This fix is unverified against a live Immich.**

---

## 3. Architecture (what to know before editing)

- **`backend/src/models.ts` is the single source of truth.** Every model carries an explicit `verified` flag plus a `note` recording exactly what was confirmed live vs inferred. Keep that discipline — trusting remembered slugs caused the original bug wave.
- **`backend/src/sizing.ts`** derives output dimensions from the source aspect ratio, per-model. Fuzz-test any new `DimensionRule` before spending credits (see §4).
- **`backend/src/lora.ts`** — deterministic AIRs (`sha256(url)[:12]`), upload-and-cache, self-heal for 7 known-bad hand-made AIRs, per-provider caps (Runware ∞ / Fal 3 / Atlas 3 / Replicate 1), trigger-word injection.
- **Provider quirks that are load-bearing:**
  - Runware Kontext takes `inputs.referenceImages` (array), *not* `inputImage`.
  - Atlas wraps everything as `{code, message, data:{...}}` and its image field name **varies per model** (`image` vs `images` array) — carried in the registry as `imageInput`.
  - Replicate uses `guidance` (not `guidance_scale`), `disable_safety_checker` (not `safety_tolerance`), `lora_weights`/`lora_strength` (not `hf_lora`/`lora_scale`). Cog **silently drops** unknown fields, so wrong names fail invisibly.
  - Runware safety settings: most models nest under `providerSettings.<vendor>`, but **Wan 2.7 Pro uses a flat top-level `safety.checkContent`** — hence two separate mechanisms (`runwareProviderSettings` vs `runwareExtraFields`).

---

## 4. Working practices that paid off — please keep

1. **Verify slugs and payload shapes against live docs/APIs before wiring.** This session found 2 wrong AIRs, 3 wrong Replicate field names, 2 invented `providerSettings` keys, and a wrong root-cause diagnosis purely by checking.
2. **When a provider rejects a parameter, read the error — it usually contains the answer.** Runware echoes full `allowedValues` lists on invalid enums. That's how the architecture enum and the `providerSettings.bfl` key list were obtained.
3. **Fuzz-test sizing rules locally before live calls** — `resolveSize()` against 6–9 aspect ratios costs nothing and caught a real off-by-94-pixel ceiling bug.
4. **Never let a requested LoRA silently vanish.** If the user asked for LoRAs and none resolve, throw. A 200 with a real image that quietly ignored the request is the worst outcome.
5. **Mark what you didn't verify.** `verified: false` + a `note` keeps unchecked assumptions visible instead of hardening into apparent fact.

---

## 5. What's left

1. **Deploy to Hetzner** (`/opt/gemini`, live at `gedit.midnighttavern.online`) — never done from the previous environment; SSH/port-22 was blocked there. See §6.
2. **Verify the Immich layer against the real instance** — gallery load, thumbnails, and save-back-to-Immich. Highest-risk untested area.
3. **Fal** — add credit, then verify its five models.
4. **Seedream 5.0 Pro** — retry; may just have been provider load.
5. **Android app** — a fork of Immich mobile embedding this editor in an `InAppWebView`. Untouched all session. Web was the stated priority.

---

## 6. Deploy notes

```bash
cd /opt/gemini && git pull
docker compose build && docker compose up -d
docker compose logs -f immich-ai-backend
```

- **Confirm `[LoRA] Catalogue loaded: 81 LoRAs` in the logs.** If it says `EMPTY CATALOGUE`, the JSON mounts didn't take.
- **Set `defaultProvider` to `runware` or `atlas`, not `fal`** — a stale `fal` default means every edit fails on arrival (no balance).
- No new env keys needed; all recently-added models are Runware.
- `/opt/gemini` is **not a git repo** historically (it was scp-deployed). Confirm before assuming `git pull` works there.
- Frontend is a Vite build baked into the nginx image — **frontend changes require `docker compose build`**, not just a restart. Forgetting this and then fighting WebView cache has burned time before.
- Three deployment blockers were fixed in `045f60f` (empty LoRA catalogue in Docker, missing `backend/data` volume, dead Immich endpoint) — all three worked fine locally and only broke once containerised, so re-test *in the container*, not just locally.

---

## 7. Sibling repo: `Deathwalker-47/Silly-Tavern-Flux-Bridge`

Separate project, **merged and complete**. Adds FLUX Kontext editing + an Immich integration to a SillyTavern bridge (`flux_lora_bridge.py`). Not a dependency of this editor — treat as **reference only**; its proven Runware LoRA logic is already ported into `backend/src/lora.ts`.

Note: 5 of its tests fail permanently — they test `PixelDojoClient`/`HFClient`, which no longer exist in that codebase. Pre-existing, unrelated, deliberately left alone.
