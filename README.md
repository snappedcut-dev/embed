# @snappedcut/embed

Put the [Snapped Cut](https://snappedcut.com) video editor in your own page.
Editing runs in the visitor's browser; the final export renders on Snapped Cut's
servers and is billed to the session your server minted.

## One script tag

```html
<div id="editor" style="height: 640px"></div>
<script src="https://snappedcut.com/embed/v1.js"
        data-key="pk_live_..." data-token="..." data-target="#editor"
        data-features='{"formats":["mp4"]}'></script>
```

Results arrive as bubbling events, because a page using this path has no handle
to pass callbacks to:

```js
document.addEventListener('snappedcut:export', (e) => {
  console.log(e.detail.format, e.detail.bytes);
});
```

## mount()

```sh
npm install @snappedcut/embed
```

```ts
import { mount } from '@snappedcut/embed';

const editor = await mount('#editor', {
  publishableKey: 'pk_live_...',
  token,                                   // minted by your server, see below
  getToken: () => fetch('/api/snapcut-token').then((r) => r.text()),
  features: { formats: ['mp4'] },
  theme: { bg: '#fff', text: '#111', accent: '#2563eb', radius: 8 },
});

await editor.load(file);
const result = await editor.export('mp4', { targetWidth: 1080 });
```

| | |
| --- | --- |
| `load(blobOrUrl)` | Add a media file, or reopen a bundle from `getProject()`. |
| `export(format, options?)` | Renders on our servers. `format` is one of the session's `features.formats`. |
| `getProject()` | The whole project — timeline and media — as a bundle `Blob`. |
| `setTheme(theme)` | Switches the theme live, without a remount. |
| `on(event, fn)` | `ready`, `error`, `change`, `export`, `job`. Returns an unsubscribe. |
| `destroy()` | Removes the frame and its listeners, and returns focus to where it was. |
| `frame` | The `<iframe>`, if you need to size it yourself. |

## React

```tsx
import { SnappedCutEditor } from '@snappedcut/embed/react';

<SnappedCutEditor
  publishableKey="pk_live_..."
  token={token}
  theme={theme}
  style={{ height: 640 }}
  onExport={(result) => save(result)}
/>
```

Callbacks are read through a ref, so an inline handler does not remount the
frame. A new `theme` is sent with `setTheme`, so switching light and dark keeps
the seller's edit. Changing the key, token, `features` or `project` remounts.

## Keys and tokens

A **publishable key** (`pk_live_…`, or `pk_test_…` for a free sandbox capped at
15 s renders and 50 a day) is public: it ships in your HTML and is locked to an
origin allowlist. Make keys on your account page.

**Exporting needs a token**, because a key says which partner you are, not who
pays. Mint one on your server with your secret API key:

```http
POST https://snappedcut.com/api/embed/tokens
Authorization: Bearer sk_snapcut_...

{ "pk": "pk_live_...", "endUserId": "seller-42", "maxCredits": 50,
  "ttlSeconds": 900, "features": { "formats": ["mp4"], "branding": false } }
```

→ `201 { token, sessionId, expiresAt, maxCredits, mode, features }`, with
`expiresAt` in epoch milliseconds. Tokens are short-lived; pass `getToken` and
the frame asks for a fresh one before the current one expires (retries climb
1 s, 2 s, 4 s … capped at 30 s). The token travels in the URL hash, so it never
reaches a server log or a referrer header.

## Features

What the editor shows. The token's `features` are the ceiling — signed, so a
page cannot exceed them — and `mount({ features })` can only narrow them. The
server checks the token's `formats` again before it renders anything.

| Feature | Default | |
| --- | --- | --- |
| `stock` | `false` | Our stock footage library. |
| `assistant` | `false` | The bring-your-own-key AI assistant. |
| `projects` | `false` | Our projects dialog. Keep projects yourself with `getProject()`. |
| `share` | `false` | Collaboration links through our relay. |
| `branding` | `true` | The Snapped Cut name in the editor bar. |
| `panels` | all | `text`, `audio`, `captions`, `effects`, `mask`, `scenes`, `keyframes`, `comments`. |
| `formats` | `["mp4"]` | Any of `mp4`, `webm`, `mov`, `mkv`. |

The editor's own Export button is never shown in an embed: `export()` is the
only way out, and it is billed. There is no close button; the host owns the
chrome.

## Theme

The same token names as snapnedit: `bg`, `bg2`, `surface`, `surface2`, `line`,
`line2`, `text`, `dim`, `accent`, `accentText`, `radius` (px number or a
`px`/`rem` string) and `font` (a family your page has loaded). Each call to
`setTheme` replaces the last, so send the whole set. Values that are not a
plain colour, length or family name are dropped.

## Export

`export(format, { targetWidth?, scale?, quality?, uploadUrl? })`

- Default size is the project's; `targetWidth` (or `scale`) keeps the aspect
  ratio and rounds both sides to even, 16–7680. The result reports the real size.
- `quality` 0–1 picks one of five steps; 0.5 is the default.
- An output of 3840×2160 or more is billed at the 4K rate.
- `uploadUrl` is a presigned https PUT on your storage. The frame uploads the
  render there and the result is `{ uploaded: true, contentType, … }` with no
  file. Allow PUT from `https://snappedcut.com` with `content-type`; do not sign
  a content length.
- Otherwise the result carries `blob`.

Every export emits `job` events — `started`, then `succeeded` or `failed` —
with `operation` (`cloud-render` or `cloud-render-4k`), `credits` and the
token's `endUserId`. A failed render refunds itself.

Out of credits, or at the session's `maxCredits`, the export rejects with
`credits_exhausted`. Nothing is lost: the edit stays in the frame, so top up
and export again.

## Errors

| Code | Means | Retry? | Show the seller |
| --- | --- | --- | --- |
| `invalid_input` | A bad argument, URL or bundle. | No | "That file could not be opened." |
| `mount_failed` | The frame did not load, or the browser cannot run the editor. | Once | "The editor could not load." |
| `token_expired` | The token is past its expiry. | Yes, with a new token | Nothing; refresh silently. |
| `unauthorized` | Bad key or token, or the session is not allowed this. | No | "Video editing is unavailable." |
| `origin_not_allowed` | This page's origin is not on the key's allowlist. | No | Your configuration bug. |
| `unsupported` | A format the session was not granted, or a destroyed embed. | No | "That format is not available." |
| `network_error` | We, or the URL you passed, could not be reached. | Yes, with backoff | "Check your connection." |
| `export_failed` | The render failed. Its credits were refunded. | Once | "The export failed; try again." |
| `credits_exhausted` | No credits, or the session's `maxCredits` is spent. | After topping up | "Export limit reached." |
| `rate_limited` | Too many requests. `error.details.retryAfterMs` says when. | After `retryAfterMs` | "Busy, retrying…" |
| `internal` | Our bug. | Once | "Something went wrong." |

Token minting answers 401 (bad secret key), 403 (origin not allowed), 404
(unknown `pk`), 422 (bad body), 429 (with `retryAfterMs`) or 503 (not
configured).

## Webhooks and usage

Set an endpoint once, signed in or with your secret key:

```http
POST https://snappedcut.com/api/account/webhook
Authorization: Bearer sk_snapcut_...

{ "url": "https://example.com/api/webhooks/snappedcut" }
```

The response carries `secret` (`whsec_snapcut_…`), shown once; posting again
rotates it. Events are `job.succeeded`, `job.failed` and `session.ended`:

```json
{ "id": "evt_…", "type": "job.succeeded", "createdAt": 1795550000000,
  "data": { "jobId": "job_…", "operation": "cloud-render", "sessionId": "es_…",
            "endUserId": "seller-42", "mode": "live", "seconds": 64, "credits": 4 } }
```

Each delivery is signed: `X-Snappedcut-Signature: t=<ms>,v1=<hex>`, where `v1`
is HMAC-SHA256 of `` `${t}.${rawBody}` `` with your secret. Reject a `t` more
than five minutes from now, and dedupe on `id` (also in
`X-Snappedcut-Event-Id`). Anything but a 2xx is retried with backoff — 30 s,
2 min, 8 min, 32 min, then up to every 6 h — for eight attempts.

```ts
const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
const ok = Math.abs(Date.now() - Number(t)) < 300_000 &&
  timingSafeEqual(Buffer.from(v1, 'hex'),
    createHmac('sha256', secret).update(`${t}.${rawBody}`).digest());
```

`GET /api/usage?endUserId=&from=&to=` (epoch ms, secret key) lists every
render with its credits and the total, for reconciling and per-seller caps.
`DELETE /api/usage?endUserId=` deletes that end user's renders and uploads and
removes their id from every job, session and event we hold.

## Versioning

- The protocol version is `v` on every message and `ready.payload.version`.
  Log it.
- **Within a `v`, changes are additive**: new message types, new optional
  fields, new error codes. A host must ignore what it does not know.
- **A new `v`** comes for anything else — a removed or renamed field, a changed
  meaning. The old `v` keeps being served for at least **90 days** after the new
  one ships, with notice in [CHANGELOG.md](CHANGELOG.md) and to every account
  with an embed key.
- `protocol.json` is the JSON Schema for every message and payload; import it
  as `@snappedcut/embed/protocol.json`.
- The packages follow semver. Below 1.0, a minor version may change types.

## Accessibility

See [ACCESSIBILITY.md](ACCESSIBILITY.md).

## What stops another page driving your editor

The frame is sandboxed with `allow-scripts allow-same-origin allow-downloads
allow-popups allow-forms`. `allow-same-origin` makes it same-origin with *its
own* origin, not yours; a sandboxed frame can only lift its own sandbox when
it is same-origin with the parent, and this one never is. Every inbound
message must pass three checks before it is believed:

1. **The origin matches.** Without this, any page could post to us.
2. **The `source` window is this frame's own `contentWindow`.** Origin alone is
   not enough — a second iframe on the same origin shares it.
3. **The frame id matches the one we issued.** Two embeds on one page share the
   origin *and* the parent; this keeps their traffic apart.

Anything else is discarded silently. `src/protocol.ts` is pure and holds all of
it, so these are covered by tests rather than by a browser.

MIT
