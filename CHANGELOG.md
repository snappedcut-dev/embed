# Changelog

Every release is tagged and published from CI with npm provenance. Versions
follow semver; the embed protocol has its own version in the `ready` event.

## 0.1.2 - 2026-11-24

### Fixed

- **The frame never answered.** The iframe was sandboxed without
  `allow-same-origin`, which gives it an opaque origin: every message it posted
  arrived as `event.origin === "null"` and could never match the configured
  origin, and every message sent to it at a named origin was dropped. The
  editor rendered and then nothing happened — no `ready`, no `error`. Found by
  driving a real partner page in a real browser.

  `allow-same-origin` is safe on a cross-origin frame: it makes the frame
  same-origin with its own origin, not with the host page, and a frame can only
  remove its own sandbox when it is same-origin with the *parent*. The check
  that actually keeps a hostile frame out is `event.source ===
  frame.contentWindow`. It also restores storage, which the editor needs to
  keep projects.

## 0.1.1 - 2026-11-24

### Fixed

- **Documentation said the processing runs on our servers. It does not, yet.**
  Decode, compositing and encode run on the device today, on WebCodecs. The
  previous wording described the committed direction as though it had shipped,
  which is the wrong thing to hand anyone writing a privacy policy: it would
  have claimed media is uploaded to us when it is not. The section now states
  what this version does, names cloud render as the one path that uploads
  anything, and says the browser path means a real first load and a WebCodecs
  floor.

## 0.1.0 - 2026-11-24

First publish. The protocol and the client are complete and tested; the host
route at `snappedcut.com/embed` is not serving yet, so this will not mount
against production. See the status note in the README.

