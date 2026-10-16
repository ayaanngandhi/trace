# Trace — client-side AI media provenance inspector

**Architecture rule, absolute: EVERYTHING runs in the browser. There is no backend, no server, no
build step, and no runtime network call except the one optional SynthID request described below.**

The user's files never leave their machine. That is a hard product requirement and the reason this
exists as a static site: a tool that inspects media provenance must not upload the media. Do not add a
server, a bundler, an npm dependency, a framework, or a CDN script tag. Plain ES modules loaded with
`<script type="module">`, plain CSS, no build.

---

## Deliverable shape

```
index.html          single page
terms.html          Terms of Service
privacy.html        Privacy Policy
how.html            How it works, and the limits of each signal
tests.html          in-browser test runner for the DOM-dependent modules
css/style.css       all styles, design tokens as CSS custom properties
js/
  main.js           entry point, wires input -> analyse -> render
  input.js          drag and drop, paste, file picker
  media.js          magic-byte type detection, video probing, frame sampling
  crop.js           crop rectangle + trim timeline
  report.js         verdict synthesis and the authored explanation content
  ui.js             rendering, skeletons, state
  analyzers/
    index.js        runs every analyzer, collects results
    c2pa.js         JUMBF + CBOR manifest reader
    metadata.js     EXIF / XMP / IPTC parsing and generator fingerprints
    dwt.js          DWT-DCT invisible watermark probe
    forensics.js    error level analysis, spectral grid, noise residual
    visible.js      visible AI badge heuristics
    synthid.js      optional direct API call
tests/
  *.test.js         node --test, zero dependencies
docs/SPEC.md        this file
README.md
LICENSE             MIT
```

**Pure-logic modules must not touch browser globals at import time**, so `node --test` can import them
directly. Anything given an `ArrayBuffer` or `Uint8Array` must return plain data, with DOM and canvas
work confined to `ui.js`, `crop.js` and the thin wrapper layers. This is what makes the whole thing
testable without a browser.

---

## The result contract

Every analyzer returns exactly this shape. A bare boolean is never acceptable.

```js
{
  signal: "c2pa",
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
- `isProof` is `true` **only** for vendor-authoritative evidence (a validated signed C2PA manifest, or a
  live SynthID API verdict). Every heuristic analyzer sets `false`.
- `not_configured` must never be folded into `absent`. A check that did not run is not a clean result.
- No status, summary, or rendered string may describe media as authentic, safe, verified real, human-made,
  or "not AI". Absence of a watermark is never reassurance.

---

## Analyzers, and exactly what each can do in a browser

### c2pa.js — hand-rolled JUMBF + CBOR reader

No WASM and no dependency. Implement:
- Locate the C2PA manifest store: JPEG `APP11` segments with the JUMBF marker, PNG `iTXt`/`caBX` chunk,
  WebP `C2PA` chunk, MP4 `uuid` box.
- Parse JUMBF superboxes and boxes, then decode CBOR (CBOR is a small, well-specified format: major types
  0-7, definite and indefinite lengths, and you may treat tags as transparent). Write a real CBOR decoder,
  not a regex over the bytes.
- Extract: `claim_generator`, `title`, `signature_info` (`alg`, `issuer`, `common_name`, `time`), all
  assertion labels, and the validation state if present.
- Pull `digitalSourceType` out of the `c2pa.actions` / `c2pa.actions.v2` assertions.

**Verified real manifest structure you can develop against** (captured from a genuine signed JPEG):
`claim_generator` looks like `"make_test_images/0.26.0 c2pa-rs/0.26.0"`; `signature_info` looks like
`{"alg":"Ps256","issuer":"C2PA Test Signing Cert","common_name":"C2PA Signer","cert_serial_number":"7207...","time":"2023-09-29T17:40:14+00:00"}`;
assertion labels include `stds.schema-org.CreativeWork` and `c2pa.actions.v2`.

**IPTC `digitalSourceType` handling is the correctness trap. These are NOT the same thing:**

| value | means | verdict contribution |
|---|---|---|
| `trainedAlgorithmicMedia` | made by a trained model | AI: strong evidence |
| `compositeWithTrainedAlgorithmicMedia` | composite including AI | AI: strong evidence |
| `algorithmicMedia` | rendered by an algorithm, e.g. procedural, CGI, a gradient | **NOT AI** |
| `compositeSynthetic` | composite with synthetic content | weak signal; describe, do not claim AI |
| unknown | unknown | `inconclusive`, store the raw string, never guess |

Return the raw string **and** a normalised classification: `ai_generated`, `composite_ai`,
`algorithmic_not_ai`, `synthetic_unknown`, `none`. A file whose only evidence is `algorithmicMedia` must
**not** reach an `ai_confirmed` or `ai_probable` verdict.

You cannot validate the COSE signature in pure JS without a crypto stack, so **do not claim you did**.
Report the signer details you can read and set the meaning text to say plainly that the manifest was
found and parsed but that its cryptographic signature was not verified in the browser. `isProof: true`
only when a manifest is present, parses, and you are honest in the text about the verification boundary.

### metadata.js

Parse directly from bytes: JPEG `APP1` EXIF and XMP, `APP13` IPTC, PNG `tEXt`/`iTXt`/`zTXt`, WebP
`EXIF`/`XMP` chunks, and MP4 container tags. Decode EXIF IFD0/Tags enough to expose `Software`,
`ImageDescription`, `Artist`, `Make`, `Model`, and expose XMP as raw XML with the interesting properties
lifted out.

Match a fingerprint table case-insensitively against keys and values: Stable Diffusion `parameters`,
ComfyUI `prompt`/`workflow`, `Software` values naming Google, Gemini, Imagen, DALL-E, Firefly, Midjourney,
XMP `CreatorTool`, and IPTC `DigitalSourceType`. Return the raw dump (truncate any single value to 2000
characters) plus matched fingerprints with the exact key and value.

`isProof: false`. The meaning text must state the blind spot: Google's Gemini **API** embeds its pixel
watermark but writes **no C2PA and no IPTC at all**, so metadata checks read clean on those files, and
any screenshot or social re-upload strips metadata entirely.

### dwt.js

Implement a haar DWT and an 8x8 block DCT in plain JS (a DCT-II you write yourself; do not pull in a
library). Take the luminance channel, decompose, measure the coefficient-difference statistics that the
standard frequency-domain schemes perturb, and return a numeric score plus an interpretation band.
`isProof: false`, and it must never claim a watermark was decoded. Handle 1x1, greyscale, RGBA and very
large images (downscale first) without throwing.

### forensics.js

Three independent signals, each `isProof: false`, each with a caveat that false positives are common on
screenshots, re-encoded and heavily processed genuine photographs:
- error level analysis: re-encode through a canvas at a known quality and measure the per-region delta;
- spectral grid: implement a radix-2 FFT yourself and look for the periodic upsampling peaks typical of
  GAN and diffusion decoders;
- noise residual: estimate high-frequency sensor noise, and state that its absence is weak evidence
  because denoising and re-encoding remove it too.

### visible.js

Best-effort corner and lower-right region scan for visible badges and overlays (Gemini sparkle, Sora, Veo,
Kling, Seedance, Doubao, Hailuo). `isProof: false`. Returning `skipped` with an honest explanation is
acceptable; crashing is not.

### synthid.js — optional, and honest about its limits

The Google SynthID API is real: `POST https://synthid.googleapis.com/upload/v1:verifyContent?key=KEY`,
raw bytes as the body, `Content-Type` matching the media, limits of **8 MB for images and 100 MB for
audio and video**. Response fields: `decision`, `producer`, `confidence` (images only),
`imagePrevalence`, `audioPrevalence`, `videoFramePrevalence`, `abstentionReason`.

Full enum sets:
- decision: `DECISION_UNSPECIFIED`, `DECISION_ABSTENTION`, `DECISION_NOT_WATERMARKED`, `DECISION_WATERMARKED`
- producer: `PRODUCER_UNSPECIFIED`, `PRODUCER_GOOGLE_AI`
- confidence: `CONFIDENCE_UNSPECIFIED`, `CONFIDENCE_MEDIUM`, `CONFIDENCE_HIGH`, `CONFIDENCE_VERY_HIGH`
- prevalence: `PREVALENCE_UNSPECIFIED`, `PREVALENCE_NONE`, `PREVALENCE_LOW` (<25%), `PREVALENCE_MEDIUM`
  (25-50%), `PREVALENCE_HIGH` (>50%)
- abstentionReason: `ABSTENTION_REASON_UNSPECIFIED`, `_EMPTY_BYTES`, `_LOW_RESOLUTION`, `_FILTERED`,
  `_LOW_FPS`, `_LOW_QUALITY`, `_POSSIBLE_TAMPERING`

Unknown values must be handled gracefully, never thrown on.

**Verified gating, and the copy must reflect it:** I probed the live service. A dummy key returns
`400 API_KEY_INVALID`, so the endpoint is real. But **a valid key from an ordinary Google Cloud project
returns `403 API_KEY_SERVICE_BLOCKED`**: *"Requests to this API synthid.googleapis.com method
google.gdm.synthid.v1.SynthIdService.VerifyContent are blocked."* The API is restricted to Google Cloud
accounts with SynthID access, granted through **Gemini Enterprise and partner programmes**, and it is not
enableable from the public API library. Therefore:

- Keep the call implemented and working for anyone who does have access. Never stub it out.
- When no key is set, or when the call returns `API_KEY_SERVICE_BLOCKED` or a network/CORS failure, status
  is `not_configured` (or `error` for a genuine failure) and the setup text must say, accurately: the
  authoritative check did not run; this API needs SynthID access which ordinary accounts cannot self-enable;
  **the free official alternative is https://synthid.com**, Google's public SynthID Detector for images,
  audio and video; the same check can be run in the Gemini app; and a blank result means "not checked",
  never "clean".
- Render a prominent hand-off action that opens `https://synthid.com` in a new tab, clearly labelled as
  the official manual check.
- If a key IS configured, the request is sent from the browser straight to Google. **Disclose this in the
  privacy policy**: with a key configured, the file is sent directly to Google's SynthID API; with no key,
  nothing leaves the browser at all.
- Support a mock mode (`?synthidMock=watermarked_google_image` style) so the enum mapping is testable
  without a key, covering every decision, producer, confidence, prevalence and abstention reason, plus an
  `error_500` case.

### Video, entirely client-side

Use a `<video>` element and canvas. There is no ffprobe, so report what the browser genuinely knows:
duration, `videoWidth`/`videoHeight`, and the container type from magic bytes. Frame sampling: seek to N
evenly spaced timestamps, wait for the `seeked` event, draw to a canvas, and run the image analyzers on
that frame. Aggregate per-frame results into a rollup rather than dumping eight near-identical blocks.
Failure to seek must be handled; some codecs will not decode in some browsers, and that must surface as a
clear message rather than a hang.

---

## The crop and trim tool

Cropping is not cosmetic: it removes letterbox bars and overlays, and it is what rescues an over-limit or
an unreadable file.

- **Image**: draggable, resizable rectangle over the preview with corner and edge handles, numeric x/y/
  width/height inputs synced both ways, aspect presets (free, 1:1, 4:3, 16:9, 9:16), reset, and live output
  dimensions.
- **Video**: the same rectangle, plus a timeline scrubber with a draggable playhead, draggable in and out
  handles, a shaded out-of-range region, `mm:ss.mmm` readouts, and frame stepping computed from the real
  frame rate and verified against a `seeked` event rather than assumed.
- Crop coordinates must be expressed in the video's **intrinsic** pixel dimensions, not CSS pixels. Handle
  the displayed-versus-intrinsic difference explicitly.
- Since this is client-side, produce the processed output in the browser: draw the cropped region to a
  canvas and export a PNG (lossless, so it does not erode a watermark) for images and for a chosen video
  frame. For a cropped **video clip**, use `MediaRecorder` over a canvas capture stream plus the source
  audio track if present, and be explicit in the UI that this re-encodes and is therefore lossy, warning
  that the re-encode can degrade exactly the watermark the user is trying to check.
- After producing a crop, immediately re-run the full analysis on the result so the user sees whether the
  tighter crop improved the reading, and show a clear before/after comparison.
- A download action for the cropped output.
- Validate crop inputs client-side: integers only, non-zero area, minimum 16 px, inside the bounds, and
  `start < end` with a minimum duration of 0.5 s. Reject rather than clamp, and show why.
- Fully keyboard operable, with visible focus styles.

---

## The authored content (a core requirement)

Written in `report.js` and rendered by the UI. Substantive, accurate, specific.

1. **What was found** — plain restatement of the verdict and its evidence.
2. **What a watermark means** — which producer, when it was signed; and what it still does not prove,
   namely that the content is truthful or unedited since.
3. **Why no watermark does not mean the media is real.** This section is required and must cover:
   - only some generators embed watermarks at all; open and self-hosted models (Stable Diffusion, FLUX,
     Qwen, most local pipelines) embed nothing, so their output has nothing to find;
   - ordinary handling destroys provenance metadata: screenshots, social re-uploads, messaging apps, any
     re-encode. Compression and cropping do not necessarily remove a pixel watermark, but they do remove
     the metadata;
   - an abstention is the absence of a verdict, not a clean result. Explain each abstention reason;
   - if the SynthID layer is `not_configured`, no watermark check ran at all;
   - a negative heuristic result proves nothing;
   - watermark removal tools exist and are widely used, and a stripped watermark is indistinguishable from
     one that was never there.
4. **How to get a clearer reading** — tied to the real mechanisms (the 8 MB and 100 MB limits, the
   abstention reasons, the prevalence semantics), not generic advice.

Best-practice guidance, as its own page and a results panel: upload the original rather than a screenshot;
do not downscale, because low resolution triggers abstention; stay within the size limits and crop rather
than let a check fail; remove screen chrome, social overlays, captions, letterbox bars, meme text, borders
and other apps' watermarks, because they are not part of the generated content and dilute the signal;
crop to the content rather than into it, keeping the whole generated frame; for video, crop the bars, trim
to the segment that is actually AI-generated because the service reports the share of frames carrying a
watermark, keep enough frames to avoid the low-frame-rate abstention, and avoid re-encoding more than once.

No accuracy percentage may be invented for any analyzer. If it was not measured, do not print it.

---

## Tests

`tests/*.test.js` run with `node --test` and **zero dependencies**. Plus `tests.html` for the modules that
need a DOM or canvas.

Cover: CBOR decoding against hand-built bytes including indefinite lengths; JUMBF box extraction; the
`digitalSourceType` table above, asserted at the verdict level so `algorithmicMedia` alone cannot produce
an `ai_confirmed`; EXIF/PNG-chunk parsing on fixture bytes you construct in the test; the fingerprint
matcher; DWT and forensics returning the contract shape on 1x1, greyscale and RGBA input; the SynthID enum
mapping for every value including the mocked app-not-configured and blocked cases; crop validation
rejecting non-integers, zero area, out of bounds and inverted ranges; and a shared contract validator used
in every analyzer test.

---

## Acceptance criteria

1. `node --test tests/` passes with **zero** npm dependencies installed (`ls node_modules` does not exist).
2. Opening `index.html` directly and serving it over a static server both work, with **zero console
   errors**, and `document.querySelectorAll('script[type=module]').length > 0`.
3. Pasting an image produces a full analysis. Verified by dispatching a real paste event with a
   `DataTransfer` carrying a File.
4. Dropping a file produces the same final state. Verified with a synthesized `DragEvent`.
5. An analysis of a JPEG carrying `algorithmicMedia` reports c2pa `found`, classification
   `algorithmic_not_ai`, and does **not** produce an `ai_confirmed` verdict.
6. A file with no signals renders as `no_provenance_signal` or `unknown`, and the rendered
   `document.body.innerText` contains none of: `authentic`, `not AI`, `human-made`, `verified real`,
   `is safe`.
7. Every required explanation section is present in the rendered text with real body length; assert a
   minimum character count per section.
8. The SynthID panel, with no key, states the access restriction, links to `https://synthid.com`, and
   never implies the user can enable the API from an ordinary project.
9. The crop tool: dragging the rectangle and setting in/out points produces a cropped output, and the
   analysis re-runs automatically with dimensions that differ from the source. Report source and output.
10. Invalid crop input is rejected with a clear reason, never silently clamped.
11. `terms.html`, `privacy.html` and `how.html` render with real body text, and the privacy page states
    accurately when a file leaves the browser (only when a SynthID key is configured).
12. No horizontal scroll at 360 px and at 1440 px.
13. `grep -rn "fetch\|XMLHttpRequest\|WebSocket" js/` shows network calls ONLY in `synthid.js`.
14. Nothing in the repo requires a server: `grep -rniE "flask|express|node_modules|webpack|vite" --exclude-dir=.git .` returns only documentation mentions.

Screenshots of the empty state, a result, and the crop tool, saved to `docs/screens/`.

**If a criterion cannot be verified, say so explicitly rather than claiming it.**

---

## Design

Obey `docs/DESIGN.md`: warm paper and ink, Fraunces for display, Archivo for body, JetBrains Mono for
short technical values only, 2px corners, hairlines not shadows, no green "all clear" state, and every
banned item in that file. Self-host fonts as woff2 in `css/fonts/` rather than loading from a CDN, so the
page makes no third-party request at all. Skeleton loaders, keyboard operability, `prefers-reduced-motion`,
and full keyboard access to the crop tool.

---

## Working style

Commit in stages, each with a real message, and push after each: static shell and design tokens; input
paths; each analyzer as it lands; the report and content; video; the crop tool; tests; docs. Do not push
one giant commit at the end. The repository is public, so the README must explain what the tool does and
its limits honestly, including that the authoritative SynthID check cannot be run automatically for an
ordinary account.
