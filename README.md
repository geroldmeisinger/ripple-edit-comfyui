# ComfyUI Ripple Edit

A frontend-only ComfyUI extension that adds a video-editor-style "ripple
edit" tool to the node graph: drag from a point and push everything to one
side out of the way, while keeping relative spacing intact.

No custom nodes are added - installing this only changes the graph editor's
behavior.

## Install

Copy this whole folder into your ComfyUI `custom_nodes` directory, e.g.:

```
ComfyUI/custom_nodes/comfyui-ripple-edit/
├── __init__.py
└── js/
    └── ripple_edit.js
```

Restart ComfyUI (or just refresh the browser tab if you're on a dev/hot
reload setup - the `.js` file is served straight from `WEB_DIRECTORY`, no
Python restart is strictly required, but a full restart is the safest bet
the first time).

## Controls

| Action | Trigger |
|---|---|
| Start a ripple drag | Hold **Ctrl**, press and drag with the **right mouse button** |
| Insert mode (default) | just drag - pushes nodes on the far side of the origin away, opening a gap |
| **Reverse** mode | hold **Shift** *while dragging* - removes space, pulls nodes in (see note below) |
| **Pusher** mode (experimental/testing) | hold **Alt** *while dragging* - sweeps nodes like a physical stick; they don't keep relative spacing |
| Resize the ripple line's visible extent | scroll the mouse wheel while dragging |
| Cancel and restore original positions | press **Esc** while dragging |
| Finish | release the right mouse button |

Shift/Alt are polled live on every mouse-move, so you can toggle between
modes mid-drag without restarting the gesture. Alt takes priority if both
are held.

**Nothing here uses a global keydown shortcut.** The only thing that's
listened for anywhere is pointer events on the graph canvas element, gated
behind `Ctrl + right-mouse-button-down`. A plain right-click (no Ctrl) is
left completely untouched, so ComfyUI's normal canvas/node context menu
still opens as usual everywhere else. This was a deliberate choice so the
tool can't collide with any existing ComfyUI/LiteGraph keybinding, now or in
a future version.

On macOS trackpads, Ctrl+Click is the OS-level equivalent of a right-click,
so `Ctrl + Click + drag` works the same way.

## What each mode does

- **Insert** (default): the origin (where you pressed the mouse button) is
  fixed. As you drag, nodes on the far side of the origin - in the direction
  you're dragging - get pushed away by exactly the drag distance, opening a
  gap starting at the origin. Nodes on the other side are untouched.
- **Reverse**: the region between the origin and the current cursor
  position collapses. Nodes strictly inside that region are left exactly
  where they are (not selected, not moved). Nodes beyond the cursor, on the
  far side from the origin, get pulled in to close the gap. Nodes on the
  origin's other side are untouched.
- **Pusher** (marked "for testing" in the request): imagine the ripple line
  as a rigid stick swept from the origin to the cursor. Any node whose
  bounding box the stick currently touches gets shoved just far enough to
  stay clear of it - nodes bunch up against the stick rather than
  maintaining their spacing, exactly as specified. There's no "space to
  insert" concept here, so no fill rectangle is drawn for this mode, only
  the line (in orange, to keep it visually distinct from insert/reverse).

All three modes recompute every node's position from a snapshot taken at
drag-start, every frame - so the effect is fully reversible as you move the
mouse back and forth, and nothing accumulates drift.

## Visuals

- **Origin marker**: a small circle (radius = the "minimum drag threshold"
  setting, in graph units, so it scales with zoom) with a center dot. If the
  threshold is set to 0, a cross is drawn instead (a zero-radius circle
  wouldn't be visible).
- A faint dashed gray line always connects the origin to the current cursor
  position.
- Once you've dragged past the minimum threshold, the drag direction locks
  the axis (mostly-horizontal drag → vertical line, shifts X positions;
  mostly-vertical drag → horizontal line, shifts Y positions), and:
  - A **thick line** is drawn at the cursor's position along the locked
    axis - green for insert, red for reverse, orange for pusher.
  - A **transparent fill rectangle** (same color family, low opacity) is
    drawn between the origin and the line, for insert/reverse modes.
  - If the line's visible segment extends beyond the top/bottom (or
    left/right) edge of the workspace, a small `+123px` label shows how many
    pixels are hidden off-screen on that side.
- The overlay is a separate `<canvas>` sized to exactly match the graph
  canvas element's own bounding box every frame, so it's automatically
  clipped to the workspace area and won't be drawn over the topbar, sidebar,
  or other panels that are separate DOM elements. A floating popup that
  happens to overlap the *canvas area itself* (e.g. a node search box) could
  still visually sit under the ripple overlay - this is a minor known
  limitation, not something the extension actively avoids.

## Scroll-to-resize behavior

While dragging, past the point the axis has locked:

- Before you scroll at all, the line spans the full workspace (equivalent
  to "infinite", clipped to the visible area).
- The **first** wheel event sets a baseline: scrolling down sets the visible
  segment to 80% of the workspace height/width (whichever the line runs
  along); scrolling up sets it to 20%.
- Every scroll after that nudges it further: scrolling down shrinks it,
  scrolling up grows it, in steps controlled by the
  `RippleEdit.ScrollStepPercent` setting (default 5%), clamped to 3–100%.

## Settings

Registered under ComfyUI's settings panel (search "Ripple Edit"):

| Setting | Default | Meaning |
|---|---|---|
| `RippleEdit.Enabled` | `true` | Master on/off switch |
| `RippleEdit.MinThreshold` | `10` | Graph-space units the cursor must move before the tool activates. Also used as the origin-circle radius. |
| `RippleEdit.MaxDistance` | `-1` | Graph-space distance from the origin (along the locked axis) beyond which nodes are never moved. `-1` = no limit. |
| `RippleEdit.LineWidth` | `5` | Ripple line thickness, in px |
| `RippleEdit.ScrollStepPercent` | `5` | Percentage-point change per wheel notch, after the initial scroll |

If your ComfyUI version's settings API differs enough that registration
fails, the extension falls back to these defaults and still works - you just
won't get a UI to change them (there's a console warning if that happens).

## Snap to grid

Node positions respect ComfyUI's existing "snap to grid" toggle
(`app.canvas.align_to_grid` / `Comfy.SnapToGrid`, whichever your version
exposes) and grid size (`LiteGraph.CANVAS_GRID_SIZE`, default 10) - final
node coordinates are rounded to the grid when it's enabled, same as normal
node dragging.

## Known limitations / things not implemented

- Only nodes (`app.graph._nodes`) are moved. Groups and reroute-only
  elements aren't repositioned.
- Undo integration is best-effort (`app.graph.change()` is called after a
  drag finishes, if it exists) - depending on your ComfyUI version, a ripple
  move may or may not show up as a single undo step.
- In pusher mode, if pushing one node causes it to overlap another that
  isn't itself touching the stick, they're allowed to overlap - there's no
  chain-reaction collision resolution. The request describes this mode as
  "for testing", so this seemed like the right amount of complexity to
  build.
