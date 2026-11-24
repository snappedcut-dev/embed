# @snappedcut/embed

Put the [Snapped Cut](https://snappedcut.com) video editor in your own page.

> **Status: the client is ready, the host route is not.** This package and its
> protocol are complete and tested, but `snappedcut.com/embed` is not serving
> frames yet and publishable keys are not being issued. It is published so the
> protocol can be reviewed and the wrappers built against it. **It will not
> mount against production today.** Watch
> [the repo](https://github.com/snappedcut-dev/embed) for the release that turns
> it on.

## One script tag

```html
<div id="editor" style="height: 640px"></div>
<script src="https://snappedcut.com/embed/v1.js"
        data-key="pk_live_..." data-target="#editor"></script>
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

const editor = await mount('#editor', { publishableKey: 'pk_live_...' });

editor.on('change', ({ duration, clips }) => console.log(duration, clips));

await editor.load(file);
const { blob } = await editor.export('mp4');
```

| | |
| --- | --- |
| `load(blobOrUrl)` | Open a project bundle or a media file. |
| `export(format, options?)` | `webm`, `mp4`, `mkv`, `mov`, `gif` or `png`. Resolves with a `Blob`. |
| `getProject()` | The current timeline, as JSON. |
| `on(event, fn)` | `ready`, `error`, `change`, `export`, `job`. Returns an unsubscribe. |
| `destroy()` | Removes the frame and its listeners. |
| `frame` | The `<iframe>`, if you need to size it yourself. |

## React

```tsx
import { SnappedCutEditor } from '@snappedcut/embed/react';

<SnappedCutEditor
  publishableKey="pk_live_..."
  style={{ height: 640 }}
  onExport={({ blob }) => upload(blob)}
/>
```

Callbacks are read through a ref rather than listed as effect dependencies — an
inline `onReady` is a new function every render, and as a dependency it would
tear the iframe down and remount it on each one. Strict mode's double effect is
handled too: the first mount's frame is destroyed rather than orphaned with a
live message listener.

## The editing happens on your visitor's machine

Decode, cut, filter and encode are WebCodecs calls **inside the frame, in their
browser**. So `load` and `export` cost nothing, need no round trip, and never
send their footage anywhere — which is the whole reason to embed this rather
than an upload form.

The one exception is a **cloud render**, which is opt-in and costs credits. It
reports itself through the `job` event, with `credits` and the `endUserId` from
your token, so you can meter per customer:

```ts
editor.on('job', ({ endUserId, credits, status }) => bill(endUserId, credits, status));
```

## Keys and tokens

A **publishable key** (`pk_live_…`) is public by design: it ships in your HTML
and is locked to an origin allowlist. A key leaking is not a problem; a key
working from an origin you never allowed is, and that is a bug worth
[reporting](https://github.com/snappedcut-dev/.github/security/policy).

For per-end-user attribution, mint a **token** server-side with an `endUserId`
and hand it over instead. Tokens are short-lived, so pass `getToken` and the
frame will ask for a fresh one before the current one expires:

```ts
await mount('#editor', {
  getToken: () => fetch('/api/snapcut-token').then((r) => r.text()),
});
```

Retries climb 1s, 2s, 4s … and cap at 30s. The frame backs its own reports off
on the same ladder — without the cap, a slow `getToken` and a retrying frame
race each other into a request storm.

The token travels in the URL **hash**, not the query, so it is never sent to the
server, never reaches an access log and does not survive into a referrer header.

## What stops another page driving your editor

The frame is sandboxed **without** `allow-same-origin` — it is a different
origin to your page and stays one. Every inbound message must pass three checks
before it is believed, and each has a way of being wrong that still looks fine
in a demo:

1. **The origin matches.** Without this, any page could post to us.
2. **The `source` window is this frame's own `contentWindow`.** Origin alone is
   not enough — a second iframe on the same origin, or a popup you did not open,
   shares it.
3. **The frame id matches the one we issued.** Two embeds on one page share the
   origin *and* the parent; this is what keeps their traffic apart.

Anything else is discarded silently, including an event type we do not
recognise. `src/protocol.ts` is pure and holds all of it, so these are covered
by tests rather than by a browser.

MIT
