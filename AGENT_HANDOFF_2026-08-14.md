# Agent Handoff — Immich AI Editor

**Last updated:** 2026-08-15 · Supersedes all earlier versions of this file.
**Read §2 before touching sizing or model slugs** — it corrects a diagnosis in `HANDOFF.md` that would break working code if followed.

---

## 1. State: `main` @ `f57b469` — **deployed and live-verified**

Backend and frontend typecheck and build clean. **Deployed to Hetzner and verified end-to-end on 2026-08-15.**

The provider/editing layer was already proven (16 real edits). The **Immich layer is now proven too** — every path was exercised against the real instance:

| Immich path | Result |
|---|---|
| `POST /search/metadata` (timeline) | ✅ 200 — the previously unverified fix, now confirmed |
| `GET /albums` | ✅ 200, 50+ albums with real counts |
| `GET /albums/:id` assets | ✅ **was broken — fixed in `f57b469`**, see §2 |
| Thumbnails (`size=thumbnail` / `preview`) | ✅ 12/12 → 200 `image/webp` |
| Original | ✅ 200 `image/png`, 1536×2048 |
| Upload (save-back) | ✅ asset created, `AI Edits` album ensured + attached |
| Live edit through deployed backend | ✅ 200 in 18.1s via Runware Kontext Dev |

Verification asset `a9e7f1b3-7840-44e2-89f0-110720febb3f` (`claude-verify-saveback.png`, a 1×1 test pixel) was uploaded to prove save-back and is still in the `AI Edits` album — safe to delete.

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

**§6.5's "intermittent" timeline failure.** It wasn't intermittent — `routes/immich.ts` called `GET /assets?page=`, the `getAllAssets` endpoint removed in immich-app/immich#9715, which 404s every time. Now uses `POST /search/metadata`. **Confirmed on 2026-08-15:** the old endpoint returns 404 against the live instance on every call, and `search/metadata` returns 200. Fix verified.

**The album half of that same diagnosis was also wrong.** §6.5 assumed album browsing "kept working". It did not. `GET /albums/:id` no longer returns an `assets` array on current Immich — verified live with `?withoutAssets=false`, `?withoutAssets=true`, and no parameter: all three return `assetCount` but no `assets` key. The frontend defaults a missing key to `[]`, so albums opened to an empty grid *without* erroring — which is why it looked like the timeline was the only casualty. Fixed in `f57b469`: album assets now come from `POST /search/metadata` filtered by `albumIds`, paged via `nextPage` (Immich caps a page at 1000), videos filtered out. Verified live: a 1244-asset album returns its 655 images; an all-video album correctly returns 0.

**Both failures share one root cause** — Immich removed/changed asset-listing endpoints, and this codebase was written against the older shapes. If another Immich read path misbehaves, suspect the endpoint before the UI.

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

1. ~~Deploy to Hetzner~~ — **done 2026-08-15.**
2. ~~Verify the Immich layer~~ — **done 2026-08-15**, and it surfaced the album bug above.
3. **Fal** — add credit, then verify its five models. Still the only unverified provider.
4. **Seedream 5.0 Pro** — retry; may just have been provider load.
5. **Android app** — **already exists and works; it was never missing.** See §8.

---

## 8. The Android app (this was the actual delivery surface)

The editor is used *inside the Immich mobile app*, not as a standalone site. That integration already exists:

- **Fork:** `C:\Users\anuji\Documents\antigravity\Immich-Image-edit\immich-mobile-fork` — a full Immich monorepo clone at upstream `daabab8`, with the customisation left uncommitted.
- **The whole integration is two files:**
  - `mobile/lib/presentation/widgets/action_buttons/ai_edit_action_button.widget.dart` (new) — a "Magic Edit" button that opens `https://gedit.midnighttavern.online/?assetId=<remoteId>` via `launchUrl(..., LaunchMode.inAppWebView)`.
  - `mobile/lib/presentation/widgets/asset_viewer/bottom_bar.widget.dart` — one line: `if (asset.isImage) const AiEditActionButton(),`.
- **The editor's `?assetId=` deep-link** (`App.tsx`) is what makes this work — it skips the gallery and opens straight into the editor for that asset. Don't remove it; the mobile app depends on it.
- **Built APKs:** `Desktop\Immich-AI-Editor-v3.apk` is current (byte-identical to `antigravity\...\Immich-Mobile-App.apk`; `v2` is older). All three already point at `gedit.midnighttavern.online`.

**Why it seemed broken:** nothing was wrong with the APK. It opens a WebView onto the deployed editor, and that editor was running 5-week-old code with a dead timeline endpoint and empty albums. The fixes were entirely server-side — **the existing v3 APK needs no rebuild.** Only re-build the APK if `aiEditorHost` in the button file has to change; the URL is hardcoded there, not configurable at runtime.

**Toolchain (local machine, verified):** Flutter 3.44.5 stable, Android SDK 35, JDK 17, `flutter doctor` clean. `cd immich-mobile-fork/mobile && flutter build apk --release`.

---

## 9. Removed: the abandoned Grok deployment

`/opt/grok/immich-ai-editor` was a **second, unrelated** Python/FastAPI editor from an earlier attempt, with its own Tampermonkey userscript. It was dead — no container, no image, no systemd unit — and its userscript still had the placeholder `backendUrl: 'http://CHANGE_ME:8088'` pointing at a sidecar that no longer runs. It was removed on 2026-08-15 at the owner's instruction, along with an inert `xedit.midnighttavern.online` nginx vhost that referenced it.

Archived first, restorable: `/root/backups/grok-immich-ai-editor-removed-*.tar.gz`. **`/opt/gemini` is the only real deployment** — don't resurrect the other one.

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
- **`/opt/gemini` IS a git repo** — tracking `origin/main`, so `git pull` works. (An earlier note here guessed otherwise.) One caveat, already resolved: it originally held a single orphan snapshot commit `fe88042` with *no common ancestor* with `origin/main`, so `git pull` failed with "not possible to fast-forward". It was re-pointed with `git checkout -B main origin/main` after a backup; `.env` is untracked and survived. Future pulls are ordinary fast-forwards.
- `.env` on the server is the source of truth for keys and is **not** in git. Don't overwrite it.
- The `[LoRA] Catalogue loaded: 81 LoRAs` line is **lazy** — it appears on the first `/api/edit/loras` request, not at boot. Its absence from startup logs is not a failure; hit the endpoint before concluding anything.
- Frontend is a Vite build baked into the nginx image — **frontend changes require `docker compose build`**, not just a restart. Forgetting this and then fighting WebView cache has burned time before.
- Three deployment blockers were fixed in `045f60f` (empty LoRA catalogue in Docker, missing `backend/data` volume, dead Immich endpoint) — all three worked fine locally and only broke once containerised, so re-test *in the container*, not just locally.

---

## 7. Sibling repo: `Deathwalker-47/Silly-Tavern-Flux-Bridge`

Separate project, **merged and complete**. Adds FLUX Kontext editing + an Immich integration to a SillyTavern bridge (`flux_lora_bridge.py`). Not a dependency of this editor — treat as **reference only**; its proven Runware LoRA logic is already ported into `backend/src/lora.ts`.

Note: 5 of its tests fail permanently — they test `PixelDojoClient`/`HFClient`, which no longer exist in that codebase. Pre-existing, unrelated, deliberately left alone.
