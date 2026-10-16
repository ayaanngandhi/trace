# Vendored browser runtime

These files are third-party browser builds copied in unchanged so the site can
read signed C2PA credentials without a backend, a build step or an npm install at
run time. Nothing here is edited by hand.

## vendor/c2pa

From `@contentauth/c2pa-web@0.15.3` (MIT), the official Content Credentials
reader, published at https://github.com/contentauth/c2pa-js.

- `index.js`, `c2pa-ekHbRvhf.js`: the ESM entry and its code chunk.
- `resources/c2pa_bg.wasm`: the reader engine, loaded at run time.
- `LICENSE`: the library licence.

The chunk spawns its worker from an inline blob and fetches the WASM with the
subresource integrity hash the library itself publishes. The vendored
`c2pa_bg.wasm` matches that hash, so the fetch is verified in the browser:

    sha512-l5R2SWbu07MUf5BWcO9CtZtNK2R6o/ib4q+ca+AVbuijvMIPtnRDH9cDrhijRCTEdTzvIftBa15zEr5RT2n3Ww==

## vendor/highgain

From `highgain@0.1.0` (ISC), a small worker RPC helper that `@contentauth/c2pa-web`
imports by its bare package name. No licence file ships in the package; the
licence is ISC per its `package.json`.

`index.html` resolves the bare specifier with an import map:

    { "imports": { "highgain": "./vendor/highgain/index.js" } }

No bundler is involved. The import map is plain HTML and the browser maps the
bare name to the vendored file.
