# Changelog

Every release is tagged and published from CI with npm provenance. Versions
follow semver; the embed protocol has its own version in the `ready` event.

## 0.2.0 - 2026-11-24

Protocol `v` is still 1. Everything below is additive on the wire. The types
changed, which is why this is a minor release (pre-1.0).

### Added

- `features` on `mount()`, on the script tag (`data-features`) and on the
  token: hide stock, the assistant, projects, share and branding, pick the
  panels, and choose which export formats are allowed. The token's features are
  signed and set the ceiling; the page can only narrow them. The server checks
  `formats` again before it renders anything.
- `setTheme(theme)`, and the full token set: `bg`, `bg2`, `surface`,
  `surface2`, `line`, `line2`, `text`, `dim`, `accent`, `accentText`, `radius`
  and `font`. The React wrapper now sends a theme change through `setTheme`
  instead of remounting.
- `export(..., { uploadUrl })`. The result is typed as a union: with
  `uploaded: true` it carries no blob. The result also includes `jobId` and
  `credits`.
- New error codes `credits_exhausted` and `rate_limited`. A
  `rate_limited` error carries `details.retryAfterMs`.
- `getProject()` now returns a bundle `Blob` (timeline plus media), which
  `load()` and `project` reopen.
- `JobEvent.operation` is typed as `'cloud-render' | 'cloud-render-4k'`.
- `protocol.json`: the JSON Schema for every message in both directions,
  importable as `@snappedcut/embed/protocol.json`.
- Versioning rules (README), `ACCESSIBILITY.md`, and focus is handed back to
  the host when `destroy()` runs.

### Changed

- `ExportFormat` is now `mp4 | webm | mov | mkv`, the formats the server
  actually renders. `gif` and `png` were never rendered by the embed.
- Corrected the comments and README that still called the frame a thin client.
  Editing runs in the browser, and the export renders on our servers.

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

