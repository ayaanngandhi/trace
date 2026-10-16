# Trace — AI media provenance inspector

## Architecture rule, absolute

**The website is frontend only.** Everything runs in the browser. No backend, no server, no build step, no
bundler, and no npm runtime dependency for the site. Plain ES modules, plain CSS. The user's files never
leave their machine.

**A backend exists ONLY in the self-hosted version**, and only to serve the static files and optionally to
hold the SynthID API key server-side. It is not part of the public website.

## Detection rule, absolute

**Do not write our own detection logic.** No bespoke watermark detectors, no statistical inference, no
forensic scoring, no "AI likelihood" heuristics, no hand-written signal processing. We report what
authoritative sources say and what the file literally contains.

- **Delete any DWT-DCT probe, FFT spectral analysis, error level analysis, noise-residual analysis or
  visible-badge detection.** None of it belongs in this build. If a draft produced
  `js/analyzers/dwt.js`, `js/analyzers/forensics.js` or `js/analyzers/visible.js`, remove them.
- Detection comes from the **SynthID API** and from **signed C2PA manifests**. Metadata is *read and
  reported*, never interpreted into a score.
- Never print a percentage, probability, confidence score or accuracy figure that an authoritative source
  did not return.

---

## Deliverable shape

```
index.html  how.html  terms.html  privacy.html
css/style.css  css/fonts/*.woff2
js/
  main.js  config.js  settings.js  input.js  media.js  crop.js  report.js  ui.js
  analyzers/
    index.js     runs the available checks, collects results
    synthid.js   the SynthID API
    c2pa.js      C2PA content credentials, via the official library
    metadata.js  EXIF / XMP / IPTC reading and container reporting
vendor/          pinned third-party browser libraries, committed
selfhost/
  serve.py  config.example.json  run.sh  run.ps1  trace.service
tests/           node --test, zero dependencies
tests/fixtures/  c2pa_signed.jpg, real_photo.jpg
docs/            SPEC.md, DESIGN.md, SELF_HOSTING.md
tools/           browser.mjs, check-shell.mjs
```

---

## The result contract

Every check returns exactly this shape. A bare boolean is never acceptable.

```js
{
  signal: "synthid",
  status: "found" | "absent" | "inconclusive" | "not_configured" | "skipped" | "error",
  summary: "one plain-English sentence",
  confidence: "high" | "medium" | "low" | "none",
  isProof: false,
  details: {},
  meaning: "what this result does and does not tell you",
  caveats: ["..."]
}
```

- `status` is the only field to branch on.
- `isProof` is `true` **only** for an authoritative vendor verdict: a live SynthID API response, or a
  signed C2PA manifest. Nothing else, ever.
- `not_configured` must never be folded into `absent`. A check that did not run is not a clean result.
- No status, summary or rendered string may describe media as authentic, safe, verified real, human-made,
  or "not AI". Absence of a watermark is never reassurance.

---

## T1. synthid.js — the authoritative check

`POST https://synthid.googleapis.com/upload/v1:verifyContent?key=KEY`, with the raw file bytes as the body
and a `Content-Type` matching the media.

**Verified: this API returns fully open CORS headers.** It reflects the requesting origin in
`access-control-allow-origin` and allows `POST` with a `content-type` header. So **the browser calls it
directly**: no proxy, and no backend, for CORS reasons. Do not add one.

Limits: **image 8 MB, audio 100 MB, video 100 MB.**

Response fields and their conditions:
- `decision` (always): `DECISION_UNSPECIFIED`, `DECISION_ABSTENTION`, `DECISION_NOT_WATERMARKED`,
  `DECISION_WATERMARKED`
- `producer` (only when WATERMARKED): `PRODUCER_UNSPECIFIED`, `PRODUCER_GOOGLE_AI`
- `confidence` (only when WATERMARKED **and** the media is an image): `CONFIDENCE_UNSPECIFIED`,
  `CONFIDENCE_MEDIUM`, `CONFIDENCE_HIGH`, `CONFIDENCE_VERY_HIGH`
- `imagePrevalence` (image, WATERMARKED): `PREVALENCE_UNSPECIFIED`, `_NONE`, `_LOW` (under 25%),
  `_MEDIUM` (25 to 50%), `_HIGH` (over 50%)
- `audioPrevalence` (audio or video, WATERMARKED): the same values
- `videoFramePrevalence` (video, WATERMARKED): the same values
- `abstentionReason` (only when ABSTENTION): `ABSTENTION_REASON_UNSPECIFIED`, `_EMPTY_BYTES`,
  `_LOW_RESOLUTION`, `_FILTERED`, `_LOW_FPS`, `_LOW_QUALITY`, `_POSSIBLE_TAMPERING`

Handle unknown enum values gracefully and never throw on one. **`confidence` is image-only**, so a video
verdict carries no confidence field; do not invent one.

**Key resolution**, in order: `window.TRACE_CONFIG.synthidKey` (supplied by the self-hosted server), then
the key the user saved in settings (localStorage), then nothing.

When there is no key, status is `not_configured` and `details.setup` must say accurately:
- the authoritative watermark check did not run, and no watermark was read;
- the key comes from enabling **SynthID API** for a Google Cloud project at
  `https://console.cloud.google.com/apis/library/synthid.googleapis.com`, then creating an API key;
- a blank result means "not checked", never "clean".

If the call returns **`API_KEY_SERVICE_BLOCKED`**, surface the exact wording, link to that enable URL, and
explain that the API is not enabled for the key's project. **Do not describe the API as restricted or
unavailable in general**: it is a normal Google Cloud API, and the fix is enabling it for the right project.

Support a mock mode via query string (for example `?synthidMock=watermarked_google_image`) so the enum
mapping is testable without a key, covering every decision, producer, confidence, prevalence and abstention
value, plus `error_500` and `blocked`. Live calls are the default.

`isProof: true` only for a real response.

## T2. c2pa.js — official library, not hand-rolled

**Use the official C2PA browser library.** Do not hand-write a CBOR decoder, a JUMBF parser or a COSE
verifier. `@contentauth/c2pa-web` 0.15.3 is the official browser build: install it with npm in a throwaway
scratch directory outside the repo, copy only the runtime files the browser needs into `vendor/c2pa/` (the
ESM bundle, the `.wasm`, any worker file; leave out sourcemaps and tests), commit them, and import from
`vendor/` with a normal ES module import. Nothing loads from a CDN at runtime.

Verify in a real browser that it initialises and returns a verdict. **If it genuinely cannot run without a
bundler, say so plainly** in your report and in a code comment, rather than silently hand-rolling a
replacement. The acceptable degraded fallback is: report that a C2PA manifest is present, without parsing
it, with status `inconclusive`. Never claim signature validation you did not perform.

Map onto the contract:
- manifest present, signature valid, signer identifiable: `found`, `isProof: true`
- no manifest: `absent`
- present but unparseable or unverifiable: `inconclusive`

Report the claim generator, the signer (`issuer`, `common_name`, `time`, algorithm) and the assertion
labels. Extract `digitalSourceType` from `c2pa.actions` / `c2pa.actions.v2`.

**`digitalSourceType` is the correctness trap. These are not the same thing:**

| value | means | contribution |
|---|---|---|
| `trainedAlgorithmicMedia` | made by a trained model | AI: strong evidence |
| `compositeWithTrainedAlgorithmicMedia` | composite including AI | AI: strong evidence |
| `algorithmicMedia` | rendered by an algorithm, e.g. procedural or CGI | **NOT AI** |
| `compositeSynthetic` | composite with synthetic content | describe, do not claim AI |
| unknown | unknown | `inconclusive`, keep the raw string, never guess |

Return the raw string **and** a normalised classification: `ai_generated`, `composite_ai`,
`algorithmic_not_ai`, `synthetic_unknown`, `none`. A file whose only evidence is `algorithmicMedia` must
not reach `ai_confirmed` or `ai_probable`. `tests/fixtures/c2pa_signed.jpg` carries `algorithmicMedia`, and
that distinction is asserted in the tests.

## T3. metadata.js — read and report, never infer

Parse and report what the file contains. Use `exifr` 7.1.3 for EXIF, vendored into `vendor/exifr/` the same
way. Parse XMP and IPTC directly, since that is reading bytes rather than inferring anything.

Report the raw metadata dump (truncate any single value to 2000 characters) and any generator markers
found, each with the exact key and value that matched: Stable Diffusion `parameters`, ComfyUI
`prompt`/`workflow`, `Software` values naming Google, Gemini, Imagen, DALL-E or Firefly, XMP `CreatorTool`,
and IPTC `DigitalSourceType`. Match case-insensitively.

**Report the match. Do not score it, rank it, or derive a likelihood from it.** `isProof: false`, because
metadata is trivially strippable and forgeable.

The meaning text must state the blind spot: Google's Gemini **API** embeds its pixel watermark but writes
**no C2PA and no IPTC at all**, so metadata checks read clean on those files, and any screenshot or social
re-upload strips metadata entirely.

## T4. Video, client-side

Use `<video>` and canvas. There is no ffprobe in a browser, so report only what the browser genuinely
knows: duration, `videoWidth`, `videoHeight`, and container type from magic bytes. Sample up to 8 evenly
spaced frames by seeking and waiting for a real `seeked` event, drawing each to a canvas, and running the
image checks on it. Aggregate into a rollup. Some codecs will not decode in some browsers; that must
surface as a clear message, never a hang.

Also send the **video file itself** to the SynthID API (MP4, MOV and WebM up to 100 MB), and an extracted
audio track where the container and codec allow it.

## T5. The crop and trim tool

Cropping is how a user removes letterbox bars and overlays and rescues an over-limit file.

- Image: a draggable and resizable rectangle with corner and edge handles, synced numeric x/y/width/height
  inputs, aspect presets (free, 1:1, 4:3, 16:9, 9:16), reset, and live output dimensions.
- Video: the same rectangle plus a timeline scrubber with a draggable playhead, draggable in and out
  handles, a shaded out-of-range region, `mm:ss.mmm` readouts, and frame stepping computed from the real
  frame rate and confirmed against a `seeked` event rather than assumed.
- Crop coordinates must be in the video's **intrinsic** pixel dimensions, not CSS pixels. Handle that
  difference explicitly.
- Produce output in the browser: draw the cropped region to a canvas and export a lossless PNG for images
  and for a chosen video frame, so nothing is re-encoded that does not have to be. For a cropped video
  clip, use `MediaRecorder` over a canvas capture stream plus the source audio where present, and warn in
  the UI that this re-encodes and is lossy, because a re-encode can degrade the very watermark being
  checked.
- Re-run the full analysis automatically on the cropped output, showing a clear before/after comparison.
- Download action for the result.
- Validate client-side: integers only, non-zero area, minimum 16 px, inside the bounds, `start < end`, and
  a minimum duration of 0.5 s. Reject with a stated reason rather than clamping silently.
- Fully keyboard operable with visible focus styles.

## T6. The authored content, and the honesty rules

Written in `report.js`, rendered by the UI. Substantive and accurate.

Verdict levels: `ai_confirmed`, `ai_probable`, `ai_possible`, `no_provenance_signal`, `unknown`, `error`.
With no bespoke detection, `no_provenance_signal` means only that no authoritative source reported anything.
`not_configured` and `unknown` must be visually and textually distinct from it.

Required sections:
1. **What was found** — plain restatement of the verdict and its evidence.
2. **What a watermark means** — which producer, what was signed, and what it still does not prove, namely
   that the content is truthful or unedited since.
3. **Why no watermark does not mean the media is real.** Required, covering: only some generators embed
   watermarks at all, and open or self-hosted models (Stable Diffusion, FLUX, Qwen and most local
   pipelines) embed nothing, so there is nothing to find; ordinary handling destroys provenance metadata,
   since screenshots, social re-uploads, messaging apps and any re-encode strip C2PA and EXIF, and while
   cropping and compression do not necessarily remove a pixel watermark they do remove the metadata; an
   abstention is the absence of a verdict, not a clean result, and each abstention reason must be explained;
   if the SynthID check is `not_configured`, nothing ran at all; and watermark removal tools exist and are
   widely used, so a stripped watermark looks identical to one that was never there.
4. **How to get a clearer reading** — tied to the real mechanisms: the 8 MB and 100 MB limits, the
   abstention reasons, and the prevalence semantics.

Best-practice guidance as its own page and a results panel: upload the original rather than a screenshot; do
not downscale, because low resolution triggers abstention; stay within the limits and crop rather than let a
check fail; remove screen chrome, social overlays, captions, letterbox bars, meme text, borders and other
apps' watermarks, because they are not part of the generated content and dilute the signal; crop to the
content rather than into it; and for video, crop the bars, trim to the segment that is actually
AI-generated because the service reports the share of frames carrying a watermark, keep enough frames to
avoid the low-frame-rate abstention, and avoid re-encoding more than once.

## T7. Settings

A small settings panel where a user pastes their own SynthID API key. Store it in `localStorage` only.
State plainly, in the panel and in the privacy policy, where the key is kept, that with a key configured the
file is sent directly from the browser to Google, and that with no key nothing leaves the browser at all.
Provide a way to clear the key.

## T8. Self-hosting — `selfhost/`

**The only place a backend exists**, and it is optional. Python 3 standard library only.

`serve.py`:
- Reads `config.json` from `selfhost/`, defaulting to **host `0.0.0.0`, port 5665**, and falls back to
  those defaults without crashing when the file is missing.
- Serves the repository root so the same static frontend is used.
- Correct MIME types are critical because the app is ES modules: `.js` and `.mjs` as `text/javascript`,
  `.css` as `text/css`, `.woff2` as `font/woff2`, `.json` as `application/json`, `.svg` as
  `image/svg+xml`, `.wasm` as `application/wasm`. Python's `mimetypes` does not map `.woff2` on every
  version, so map these explicitly.
- Reject path traversal; never serve outside the repository root.
- **Optional SynthID key proxy**: when the config supplies a `synthidKey`, expose `POST /api/synthid`
  forwarding the body to Google with the server-side key, and a small `GET /api/config` reporting that the
  endpoint is available. The frontend prefers that endpoint when advertised and otherwise calls Google
  directly. This lets a home server run the check without putting the key in the browser.
- Print the LAN URL on startup by detecting the local IP, and shut down cleanly on Ctrl+C.
- Never log file contents, request bodies or the key.

`config.example.json` is committed; the real `config.json` is gitignored:
```json
{
  "host": "0.0.0.0",
  "port": 5665,
  "publicUrl": "https://trace.ayaanngandhi.in",
  "synthidKey": "",
  "noCache": false
}
```
Environment overrides `TRACE_PORT` and `TRACE_HOST` take precedence over the file.

`run.sh` and `run.ps1`, shaped like the scripts Zingy ships, plus `trace.service`, a **user** unit template
with `Restart=on-failure` for copying into `~/.config/systemd/user/`. Document that
`loginctl enable-linger "$USER"` is needed to survive logout and reboot.

**Do not create or configure a tunnel.** The owner points `trace.ayaanngandhi.in` at port 5665 himself.
Document how; never do it.

`docs/SELF_HOSTING.md`: quick start, changing host and port, running as a systemd user service, fronting it
with a reverse proxy or tunnel, the fact that no file data reaches the server so there is nothing to secure
server-side, that the only outbound request is the SynthID call, and that the static site can also be served
by any static host or opened from disk.

---

## Tests

`node --test tests/`, **zero dependencies**, plus `tests.html` for modules needing a DOM or canvas. Cover:
magic-byte detection and rejection of non-media; the SynthID enum mapping for every value including mocked
`blocked` and `error` cases; over-limit handling returning `inconclusive` and never `absent`; the
`digitalSourceType` table asserted at verdict level so `algorithmicMedia` cannot produce `ai_confirmed`;
metadata marker matching on PNG bytes constructed in the test; crop validation rejecting non-integers, zero
area, out of bounds and inverted ranges; and a shared contract validator used by every check.

## Acceptance criteria

1. `node --test tests/` passes and `node_modules` does not exist in the repo.
2. `index.html` works from a static server and opened directly, with **zero console errors**, and
   `document.querySelectorAll('script[type=module]').length > 0`.
3. Pasting an image runs a full analysis, verified with a real dispatched `paste` event carrying a File.
4. Dropping a file reaches the same final state, verified with a synthesized `DragEvent`.
5. `tests/fixtures/c2pa_signed.jpg` reports c2pa `found` with classification `algorithmic_not_ai`, and does
   **not** produce an `ai_confirmed` verdict.
6. `tests/fixtures/real_photo.jpg` renders as `no_provenance_signal` or `unknown`, and
   `document.body.innerText` contains none of `authentic`, `not AI`, `human-made`, `verified real`,
   `is safe`.
7. With no key, the SynthID panel reports `not_configured`, names the enable URL, and never claims the API
   is restricted in general.
8. **`grep -rniE "dwt|dct|forensic|spectral|error level|noise residual" js/` returns nothing**, proving no
   bespoke detection logic remains.
9. `grep -rn "fetch(\|XMLHttpRequest" js/` shows network calls only in `synthid.js` (plus the optional
   `/api/` calls). Report the matches.
10. The crop tool produces output with dimensions differing from the source and re-runs the analysis.
    Report source and output dimensions.
11. Invalid crop input is rejected with a stated reason.
12. `terms.html`, `privacy.html` and `how.html` render with real body text, and the privacy page states
    accurately when a file leaves the browser.
13. `cd selfhost && ./run.sh` serves the site on **5665**, reachable at `http://<lan-ip>:5665` in a real
    browser; `curl -I http://127.0.0.1:5665/js/main.js` returns a JavaScript content type; and changing
    `port` in the config and re-running moves it.
14. No horizontal scroll at 360 px and at 1440 px.

Screenshots of the empty state, a result, and the crop tool into `docs/screens/`.

**If a criterion cannot be verified, say so explicitly rather than claiming it.**

## Design

Obey `docs/DESIGN.md`: warm paper and ink, Fraunces display, Archivo body, JetBrains Mono for short
technical values only, 2px corners, hairlines not shadows, no green "all clear" state, and every banned
item in that file. Self-host fonts as woff2 in `css/fonts/`. Skeleton loaders, keyboard operability,
`prefers-reduced-motion`, and full keyboard access to the crop tool.

## Working style

Commit in stages with real messages and push after each: shell and design tokens; input paths; the SynthID
check; C2PA; metadata; the report and authored content; video; the crop tool; self-hosting; tests; docs. Do
not push one giant commit at the end. The repository is public, so the README must explain the tool and its
limits honestly.
