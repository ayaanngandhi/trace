# Build done — Trace

Every acceptance criterion in `docs/SPEC.md` was run against the real build, in real
Chrome, on 17 October 2026. This file records what was actually observed, not what was
intended. Where a check is a command, the exact command and its output are given.

Environment: node v26.9.0, npm 11.19.1, python3 3.14.7, `/usr/bin/google-chrome`.
Tools used: `node --test`, `tools/check-shell.mjs`, and short scripts driving Chrome over
the DevTools protocol through `tools/browser.mjs`. The browser scripts live in `/tmp` and are
not part of the repository. No browser test tool or dependency was added to the project.

## Corrections found during verification

Two real defects were found by the acceptance run and fixed before this file was written.

- The skeleton loader only covered the short read phase, then hid while the multi-second
  analysis ran, leaving a bare progress rule. `js/main.js` now keeps the skeleton up for the
  whole analysis, from the paste/drop to the rendered result. Re-verified: the skeleton is
  visible on the same frame the file arrives and stays until the verdict is drawn.
- `selfhost/serve.py` served every file under the repository root, including
  `selfhost/config.json`, which can hold the SynthID key. Over HTTP that would hand the key
  to the browser, defeating the point of the server-side key. The resolver now refuses the
  config file and the `.git` directory (403). Re-verified: `GET /selfhost/config.json` is 403
  with a key set, and the key never appears in any served body or in `/api/config`.

## Acceptance criteria

### 1. Tests pass and no `node_modules` — PASS
`node --test tests/` → `tests 61`, `pass 61`, `fail 0`, `cancelled 0`, `skipped 0`,
`todo 0` (≈0.38 s). `ls node_modules` → `No such file or directory`. The repository has no
`package.json`; node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning, which comes from the
home-directory package file and not from this project.

### 2. Works from a static server and from disk, zero console errors — PASS
Over `http://127.0.0.1` serving the repo with `python3 -m http.server`: module scripts `1`,
console errors `0`, exceptions `0`, uncaught log errors `0`. Over `file://.../index.html`:
console errors `0`, exceptions `0`, log errors `0`, page renders as a static document and
adds `no-module-host`. `document.querySelectorAll('script[type=module]').length` is `1` in
both cases. The only requests the page makes on load are same-origin (its own css, fonts,
modules and vendored libs); external requests on load: `0`.

### 3. Pasting an image runs a full analysis — PASS
A real `paste` event carrying a `File` (built with `DataTransfer`) with
`tests/fixtures/real_photo.jpg` reaches the final state: verdict banner rendered, all three
analyzer panels rendered, file summary rendered, result zone visible. Verdict:
`no_provenance_signal`. Zero console errors.

### 4. Dropping a file reaches the same final state — PASS
A synthesized `DragEvent('drop')` with a `DataTransfer` carrying the same fixture reaches the
same final state: verdict `no_provenance_signal`, three analyzer panels, result zone visible,
zero console errors.

### 5. `c2pa_signed.jpg` — c2pa found, `algorithmic_not_ai`, not `ai_confirmed` — PASS
The C2PA panel reports `FOUND`, the manifest declares algorithmic media (the
`algorithmicMedia` digital source type, classification `algorithmic_not_ai`), signature
validation state `Valid`, trust `untrusted`. The verdict is **not** `ai_confirmed`
(observed `no_provenance_signal` with the SynthID check absent). The `algorithmicMedia →`
verdict trap is also asserted at verdict level in `tests/c2pa-map.test.mjs`.

### 6. `real_photo.jpg` is not a pass, and no cheerful words — PASS
Renders as `no_provenance_signal`. `document.body.innerText` contains none of `authentic`,
`not AI`, `human-made`, `verified real`, `is safe` (all five absent).

### 7. No key → `not_configured`, names the enable URL, never "restricted" — PASS
The SynthID panel reports `not_configured` and names
`console.cloud.google.com/apis/library/synthid`. The word `restricted` does not appear.

### 8. No bespoke detection logic — PASS
`grep -rniE "dwt|dct|forensic|spectral|error level|noise residual" js/` returns nothing.

### 9. Network calls only in `synthid.js` — PASS
`grep -rn "fetch(\|XMLHttpRequest" js/` returns exactly two matches, both in
`js/analyzers/synthid.js`: line 68 (`GET /api/config` probe) and line 300 (the SynthID API
call). No other module in `js/` makes a network request.

### 10. Crop output differs from source and is re-analysed — PASS
Source `c2pa_signed.jpg` is 2048 by 1365 pixels. Cropping to a 500 by 600 region exports a
PNG of 500 by 600, and the before/after panel reads `SOURCE 2048 by 1365 pixels` /
`OUTPUT 500 by 600 pixels`. The crop tool re-runs the full analysis on the exported file;
the exported image is 500 by 600, i.e. different from the source.

### 11. Invalid crop input rejected with a stated reason — PASS
Setting width to `10` and committing it disables export and states:
`The crop must be at least 16 by 16 pixels.` Validation also rejects non-integers, zero area,
out-of-bounds rectangles and inverted trim ranges (covered in `tests/crop.test.mjs`; 24 crop
tests pass).

### 12. Content pages render with real text; privacy is accurate — PASS
Rendered body text lengths: `how.html` 8901 chars, `terms.html` 2933, `privacy.html` 3746.
Titles: "How Trace works, and the limits of each check", "Terms of Service, Trace", "Privacy
Policy, Trace". The privacy page states the exact condition under which a file leaves the
browser: with no key, nothing leaves; with a key, the bytes go from the browser straight to
`synthid.googleapis.com`, and with the self-host server to that server's `/api/synthid`,
which forwards and discards them.

### 13. Self-host serves on 5665, correct MIME, port changeable — PASS
`cd selfhost && ./run.sh` starts on `0.0.0.0:5665`. Startup output prints the local and the
LAN URL; `http://192.168.68.129:5665` answered `200` from the same machine.
- `HEAD /js/main.js` → `200 text/javascript; charset=utf-8`
- `HEAD /css/style.css` → `200 text/css; charset=utf-8`
- `HEAD /css/fonts/archivo-latin.woff2` → `200 font/woff2`
- `index.html` is served with `<script>window.TRACE_CONFIG={"server": true};</script>`
  injected, and the key never appears in the HTML.
- `GET /api/config` → `200 {"synthid": false, "name": "trace"}` (no key) and
  `200 {"synthid": true, ...}` with a key, without leaking the key.
- `POST /api/synthid` with no key → `404`.
- Raw socket `GET /../../../../etc/passwd` and `GET /..%2f..%2fetc/passwd` → `403`.
- `GET /selfhost/config.json` (with a key set) → `403`; `GET /.git/config` → `403`.
- Changing the port (`TRACE_PORT=5677`, and `port` in `config.json` to 5688) moves the server:
  the new port answers `200` and the old port returns `ECONNREFUSED`.

### 14. No horizontal scroll at 360 and 1440 — PASS
At 360 px: `scrollWidth 360`, `clientWidth 360`. At 1440 px: `scrollWidth 1440`,
`clientWidth 1440`.

## Design compliance (`docs/DESIGN.md`)

Measured against the resolved background by walking ancestors.

- Corners: `--radius` is `2px`; computed `box-shadow` is `none` on every element
  (`0` elements with a shadow).
- Type: body `Archivo` 16px, headings `Fraunces`; `JetBrains Mono` is applied to 18 rendered
  technical-value elements on a result (tags and values), not to prose, headings or buttons.
  All three fonts are self-hosted from `css/fonts/` and all report `loaded`; no third-party
  font request is made.
- Contrast (WCAG ratio against the resolved background): body `15.48:1`, lede `7.18:1`,
  small muted `7.18:1`, eyebrow `7.18:1`, link `16.75:1`. Every one clears its floor
  (4.5:1 body, 3:1 large).
- Focus: after a real Tab keypress the focused element matches `:focus-visible` and draws a
  `solid 2px` outline in slate blue (`#3A5A78`). Programmatic focus does not, which is the
  intended `:focus-visible` behaviour.
- Reduced motion: with `prefers-reduced-motion: reduce` emulated, the progress rule's
  `animation-name` is `none`; the skeleton stops shimmering.
- States: an empty state that teaches the three input methods (drop / paste / pick), a
  skeleton that mirrors the result layout for the whole analysis, an error state that names
  the failure (`That file is not supported` plus the supported containers), and a visible
  focus style on interactive elements.
- Palette: warm paper canvas `#F2EFE8`, ink `#16181C`, ochre accent `#A85E22` and slate accent
  `#3A5A78` both used for real elements. The seven verdict states use distinct tokens; there
  is no green "all clear" state.

## Not verified

- The SynthID check was never run against Google with a valid key: no key is available, and
  no watermark key was fabricated. Its request shape, enum mapping, over-limit handling and
  every `blocked`/`error`/`not_configured` path are covered by `node --test` and the browser
  runner instead. This is stated rather than implied.
- No tunnel was created or configured, as `docs/SPEC.md` requires. `trace.ayaanngandhi.in`
  is documented in `docs/SELF_HOSTING.md` and left to the owner.

## Screenshots

`docs/screens/empty-1440.png`, `docs/screens/result-1440.png` and
`docs/screens/crop-1440.png` show the empty state, a completed result and the crop tool.

## Stages

Each stage was committed and pushed on its own, in this order: shell and design tokens,
input paths, the SynthID check, C2PA, metadata, the report and authored content, video, the
crop tool, self-hosting, tests, and this documentation.
