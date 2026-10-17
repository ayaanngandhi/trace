# Self-hosting Trace

Trace is a static site. This directory adds an optional small server so you can
run it on your own machine or a home server, reach it across the LAN, and let it
hold a SynthID API key on the server instead of in the browser.

The server is Python 3 standard library only. There is nothing to install.

## Quick start

```
cd selfhost
cp config.example.json config.json
./run.sh
```

It prints the addresses it is listening on:

```
Trace self-host server
  serving   /home/you/projects/trace
  local     http://127.0.0.1:5665
  network   http://192.168.1.24:5665
  public    https://trace.ayaanngandhi.in
  synthid   no key configured, so the browser is asked for one
```

Open the network address on any device on the same network. On Windows use
`run.ps1` instead of `run.sh`.

`config.json` is gitignored. `config.example.json` is the committed template.

## Settings

All settings live in `selfhost/config.json`:

```json
{
  "host": "0.0.0.0",
  "port": 5665,
  "publicUrl": "https://trace.ayaanngandhi.in",
  "synthidKey": "",
  "noCache": false
}
```

- `host` defaults to `0.0.0.0`, which listens on every interface, so the LAN can
  reach it. Use `127.0.0.1` to keep it on this machine only.
- `port` defaults to `5665`.
- `publicUrl` is only printed at startup, as a reminder of where you point your
  tunnel or proxy.
- `synthidKey` is described below. Leave it empty to keep the browser in charge
  of the key.
- `noCache` adds `Cache-Control: no-store`, useful while you are editing files.

The environment variables `TRACE_HOST` and `TRACE_PORT` take precedence over the
file, so you can override either without editing it:

```
TRACE_PORT=7000 ./run.sh
```

The file is read fresh on every start. If it is missing the defaults above apply
and the server starts anyway.

## Running as a systemd user service

`trace.service` is a template. Copy it into your user units and adjust the paths
if the repository is not at `~/projects/trace`:

```
mkdir -p ~/.config/systemd/user
cp selfhost/trace.service ~/.config/systemd/user/trace.service
systemctl --user daemon-reload
systemctl --user enable --now trace.service
```

To keep it running after you log out, enable lingering once:

```
loginctl enable-linger "$USER"
```

Check it with `systemctl --user status trace.service` and read the log with
`journalctl --user -u trace.service`.

## The SynthID key, on the server

With no key anywhere, Trace still inspects C2PA credentials and provenance
metadata, and reports the watermark check as not configured. It never treats a
check that did not run as a clean result.

You can put a key in `selfhost/config.json`:

```json
"synthidKey": "AIza..."
```

When a key is set, the server advertises a SynthID endpoint at `GET /api/config`
and forwards uploads from `POST /api/synthid` to Google with the key attached.
The frontend uses that endpoint when it is advertised, so the key stays on the
server and never reaches the browser. The page is told only that a server is
present, not the key itself.

The key is never logged, and neither are file contents or request bodies.

To get a key, enable the SynthID API for a Google Cloud project at
<https://console.cloud.google.com/apis/library/synthid.googleapis.com>, then
create an API key under Credentials. If the API is not enabled for the project
that owns the key, Google returns `API_KEY_SERVICE_BLOCKED` and Trace says so.

## Fronting it with a reverse proxy or tunnel

Trace does not create or configure a tunnel. Pointing `trace.ayaanngandhi.in` at
port 5665 is the owner's job, not something this server does.

Any reverse proxy works, for example Caddy:

```
trace.ayaanngandhi.in {
    reverse_proxy 127.0.0.1:5665
}
```

or nginx:

```
location / {
    proxy_pass http://127.0.0.1:5665;
    proxy_set_header Host $host;
}
```

Or a tunnel such as Cloudflare Tunnel or Tailscale Funnel pointing at the same
port. Because the app is only ES modules and static files, the proxy needs no
special configuration.

## What there is to secure

Nothing on the server side holds your files. Every check runs in the browser, and
the only outbound request the app makes is the SynthID call, either straight from
the browser to Google or through the server when you configure a key there. No
file data reaches the server at all, so there is no upload storage to protect, no
database, and no session state. The server reads files from disk, and it rejects
any path that would resolve outside the repository root.

## Serving it another way

The self-host server is optional. Because Trace is a static site, you can serve
the repository root with any static host, with `python3 -m http.server`, or open
`index.html` directly from disk. When opened from disk the interactive checks do
not start, because browsers refuse to load ES modules over `file://`, but the
page renders with no console errors. The SynthID key proxy is the only feature
that needs this server.
