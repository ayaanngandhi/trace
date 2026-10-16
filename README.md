# Trace

A client-side inspector for AI media provenance. Drop in a photo or a video and it reports every
provenance signal it can read: signed C2PA content credentials, embedded metadata and generator
fingerprints, invisible watermark structure, and forensic signals.

**Nothing is uploaded.** Trace is a static site. It runs entirely in your browser, there is no backend,
and your files stay on your machine. The single exception is described under SynthID below, and it only
happens if you deliberately configure an API key.

## What it checks

- **C2PA / Content Credentials** — parses the embedded manifest, reports the claim generator, the signer
  and the IPTC `digitalSourceType`, which is how a signed file states that it was AI generated.
- **Metadata and generator fingerprints** — EXIF, XMP and IPTC, matched against known generator markers
  such as Stable Diffusion `parameters`, ComfyUI workflows, and Adobe Firefly or Google software tags.
- **Invisible watermark structure** — a DWT-DCT probe for the frequency-domain watermarks used by open
  image pipelines. This is a statistical signal, not a decode.
- **Forensic signals** — error level analysis, spectral grid detection and noise residual.
- **Visible marks** — a best-effort scan for on-image AI badges.
- **Video** — container information, sampled frames, and an optional audio check.

## What it cannot do

**An absent watermark is not evidence that media is real.** That sentence is the reason this tool exists,
and it is stated prominently in the interface rather than buried here. Open and self-hosted models embed
nothing at all. Screenshots, social re-uploads and re-encodes destroy provenance metadata. A vendor
abstention is the absence of a verdict, not a clean result.

**The authoritative SynthID check cannot be run automatically for an ordinary account.** Google's SynthID
API (`synthid.googleapis.com`) is real and this tool implements it, but access is restricted to accounts
with SynthID enabled through Gemini Enterprise and partner programmes, and it cannot be enabled from the
public API library. A normal Google Cloud project key is rejected with `API_KEY_SERVICE_BLOCKED`. If you
do have access, add your key in the settings panel and Trace will call the API directly from your browser.
If you do not, Trace tells you so plainly and links you to **https://synthid.com**, Google's free public
SynthID Detector, which performs the same authoritative check manually.

A blank SynthID result means "not checked". It never means "clean".

## Running it

There is no build step and no dependencies.

```
git clone <this repo>
cd trace
python3 -m http.server 8080
```

Then open http://localhost:8080. Opening `index.html` directly also works, although a local HTTP server is
recommended because some browsers restrict module loading over `file://`.

## Tests

```
node --test tests/
```

Zero dependencies. Pure-logic modules are written so they can be imported directly by Node.

## License

MIT. See LICENSE.
