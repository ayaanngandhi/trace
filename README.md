# Trace

A browser-based inspector for AI media provenance. Drop in a photo or a video and Trace reports what
authoritative sources say about it: the **SynthID watermark**, signed **C2PA content credentials**, and the
provenance metadata embedded in the file.

**Nothing is uploaded.** Trace is a static site with no backend. It runs entirely in your browser and your
files stay on your machine. The one exception is the SynthID check, which sends the file directly from your
browser to Google's API so the watermark can be read. That request happens only when you supply an API key,
and it goes straight from your browser to Google with no server in between.

## The SynthID check

Trace uses the real Google SynthID API (`synthid.googleapis.com/upload/v1:verifyContent`), which reads the
invisible watermark embedded by Google, OpenAI, NVIDIA and Kakao. Paste your own API key into the settings
panel and Trace performs the check in your browser.

To get a key:

1. Open the [SynthID API page](https://console.cloud.google.com/apis/library/synthid.googleapis.com) in the
   Google Cloud console.
2. Select a project and enable **SynthID API** for it.
3. Create an API key under [Credentials](https://cloud.google.com/docs/authentication/api-keys).

If the API is not enabled for the project that owns your key, Google returns `API_KEY_SERVICE_BLOCKED`, and
Trace says so and links you back to step 1. Without a key, Trace reports the check as **not configured**,
which is not the same as a clean result, and it says that plainly rather than implying the file passed.

## What Trace deliberately does not do

Trace **does not guess**. There is no statistical "AI likelihood" score, no spectral analysis, no error
level analysis, no custom watermark detector. Tools that produce a number like that are inventing
confidence they do not have. Trace reports what an authoritative source returned, or it reports that a
check could not run.

## Reading the results

- **SynthID found** — the vendor states a supported producer generated the media. Strong evidence.
- **C2PA credentials found** — a signed manifest naming the tool and the signer. If it records
  `trainedAlgorithmicMedia`, the file itself declares AI generation.
- **Nothing found** — an absence of evidence, never evidence of absence.

**A missing watermark does not mean the media is real.** Open and self-hosted models such as Stable
Diffusion, FLUX and Qwen embed nothing at all. Screenshots, social re-uploads and any re-encode strip C2PA
and EXIF. A vendor abstention is the absence of a verdict, not a clean bill of health. Trace states this
prominently in the interface, because it is the most widely misunderstood thing in this field.

## Running it

### Just open it

Serve the folder with anything:

```
python3 -m http.server 8080
```

Then open http://localhost:8080. Opening `index.html` directly also works.

### Self-hosting, including LAN-wide on a home server

The `selfhost/` directory adds an optional small Python server, with every setting in one config file. It
defaults to **port 5665** and binds `0.0.0.0` so it is reachable across the LAN.

```
cd selfhost
cp config.example.json config.json
./run.sh
```

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for running it as a systemd service, putting it behind a
reverse proxy or tunnel, and keeping your SynthID key on the server instead of in the browser.

## Development

No build step, no runtime dependencies.

```
node --test tests/
node tools/check-shell.mjs
```

## Licence

MIT. See [LICENSE](LICENSE).
