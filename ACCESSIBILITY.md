# Accessibility

What the embedded editor does today, measured against WCAG 2.2 AA. What
it does not do yet is listed too, so you can write an honest statement
of your own.

## What it does

- **Keyboard.** Every editing command has a key, all of them can be rebound,
  and they are all in a command palette (Ctrl/Cmd+K). That covers play, frame
  and second stepping, split, delete, ripple delete, undo/redo, copy/paste,
  markers and zoom. Timeline clips are tab stops:
  - Enter or Space selects a clip.
  - Alt+←/→ moves it by one frame, or by one second with Shift.
  - Alt+↑/↓ moves it to another track.
  - Alt+[ and Alt+] trim its start or end to the playhead.
- **Focus.** Every interactive element shows a visible focus ring, and the
  dialogs are labelled `role="dialog"` with `aria-modal`. When `destroy()`
  removes the editor, focus goes back to the element in your page that had it.
- **Labels.** Icon-only controls carry an `aria-label`. Each clip announces its
  name, its start and end timecode, and its track.
- **Contrast.** Text meets AA: at least 4.5:1 for body text and 3:1 for large
  text. An automated check measures the colour actually on screen against
  whatever is behind it. A `theme` you pass replaces our colours, so
  their contrast is then yours to check.
- **Reduced motion.** When `prefers-reduced-motion` is set, animations and
  transitions drop to a cut.
- **Captions.** The captions panel imports SRT/VTT, styles the cues, burns
  them into the export, and exports them back to SRT/VTT.
- **Languages.** The editor interface comes in English and Spanish (`locale`).

## Known gaps

- Clips can be moved and trimmed by keyboard, but not slipped or slid, and
  keyframes cannot be dragged. Use the inspector's number fields for those.
- The preview canvas has no text alternative. It shows the frame under the
  playhead and nothing else.
- Waveforms and filmstrips are decorative and are hidden from screen readers.
- No automatic transcription inside the editor. Captions come from a file.
- No external audit yet. The claims above come from our own automated checks
  and manual testing.

Report a barrier at https://github.com/snappedcut-dev/embed/issues. An
accessibility bug counts as a bug, not a feature request.
