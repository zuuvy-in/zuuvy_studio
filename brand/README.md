# Zuuvy Studio brand

The full guideline is `guidelines.html` (open it in a browser). The short form:

- **Mark**: Zuuvy's route (start box, road with two stops, signal square). Studio's
  only change: the destination is a *page* — the signal square at 21 units with a
  white browser bar. Below 24 px it reads as the Zuuvy mark, which is intended.
- **Name**: Zuuvy Studio. "Zuuvy" Space Grotesk Bold, "Studio" Space Grotesk Regular.
- **Colour**: Ink `#22314f` (structure, primary buttons), Signal `#e2503b` (the mark,
  "live", the one thing that needs you — once per view), AI violet `#6a5cf5` (only
  where the AI works), Paper `#f5f6f9`.
- **Type**: Space Grotesk for display, Geist for reading and controls, Geist Mono for
  anything people copy (versions, orders, branches, DNS).
- **Voice**: plain, specific, Indian English; say what happens, in the order it happens.

| File | Use |
|---|---|
| `studio-mark.svg` | Tile (mark on ink): app icon, favicon (`apps/studio/app/icon.svg`) |
| `studio-mark-mono.svg` | Mark alone, ink in `currentColor` |
| `studio-lockup.svg` / `studio-lockup-reverse.svg` | Horizontal lockups, light and ink |
| `studio-mark-512.png` / `studio-lockup.png` | PNG exports for uploads (the site builder refuses SVG). The lockup PNG was rendered without Space Grotesk available; re-export it on a machine with the font for final use |
| `apps/studio/components/logo.tsx` | `StudioMark`, `StudioLockup` in the product |

The Zuuvy mark itself is owned by `zuuvy_landing/brand` (`tools/make_marks.py`);
if its geometry changes, change the Studio mark with it.
