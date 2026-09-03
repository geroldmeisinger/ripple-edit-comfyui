# ComfyUI Ripple Edit

A frontend-only ComfyUI extension that adds a video-editor-style "ripple
edit" tool to the node graph: drag from a point and push (or pull, or
physically sweep) nodes out of the way, on either axis.

No custom nodes are added - installing this only changes the graph editor's
behavior.

## Install

Copy this whole folder into your ComfyUI `custom_nodes` directory, e.g.:

```
ComfyUI/custom_nodes/comfyui-ripple-edit/
├── __init__.py
└── js/
    ├── ripple_edit.js          # entry point - just wires the modules together
    └── modules/
        ├── ripple_constants.js  # shared enums, colors, defaults (no deps)
        ├── ripple_settings.js   # registered settings, grid-snap + Nodes 2.0 helpers
        ├── ripple_coords.js     # world/canvas/screen coordinate conversions
        ├── ripple_overlay.js    # the two overlay <canvas> elements
        ├── ripple_state.js      # the mutable drag-state object `R`
        ├── ripple_math.js       # pure per-node shift math (pusher/puller/aligner)
        ├── ripple_engine.js     # per-frame orchestration (safe zone, reset-on-change, tick)
        ├── ripple_draw.js       # all overlay drawing
        └── ripple_events.js     # drag lifecycle + DOM listener wiring
```

`ripple_edit.js` is the only file that calls `app.registerExtension` - the
rest are plain ES modules loaded via relative `import`/`export`, which
ComfyUI's static file server handles natively.

## Controls

| Action | Trigger |
|---|---|
| Start a ripple drag | Hold **Ctrl**, press and drag with the **right mouse button** |
| **Pusher** mode (default) | just drag - inserts space, pushes nodes away from the origin |
| **Puller** mode | hold **Shift** while dragging - removes space, pulls nodes in |
| **Aligner** mode (experimental/testing) | hold **Alt** while dragging - physical "broom" sweep |
| Resize the ripple line | scroll the mouse wheel while engaged |
| Cancel and restore original positions | press **Esc** while dragging |
| Finish | release the right mouse button |

Shift/Alt are polled live on every mouse-move *and* on their own key
up/down, so the line/icon color updates the instant you press the modifier,
without waiting for the next mouse movement. Alt takes priority if both are
held. **Changing mode or orientation while engaged now resets every node
touched so far back to its original position first** - there is no more
"continue seamlessly into the new mode" behavior.

Listeners are attached at the `window` level rather than to the graph
canvas element specifically, so this also works correctly when the cursor
starts a drag directly over a node under ComfyUI's Nodes 2.0 renderer (see
the Nodes 2.0 section below for a separate, real limitation of that mode).

## The safe zone

A circular zone around the origin (radius = `RippleEdit.SafeZoneRadius`,
default 10 graph units - the origin marker draws exactly this circle, in
the current mode's color) in which the tool is **disengaged**: nodes sit at
their original positions and the ripple visuals are greyed out. Leaving the
circle engages the tool; re-entering it snaps everything back to the
original layout - remembering the line's last orientation, so it doesn't
flip randomly if you dip back in and out.

## Orientation

The line's orientation (horizontal/vertical) is live: it's whichever axis
you're currently further from the origin along, and can swap back and forth
outside the safe zone. **Changing orientation resets every node moved so far
back to its original position** before continuing with the new orientation.
Re-entering the safe zone freezes the last orientation instead of guessing
the next time you leave it.

Turn on `RippleEdit.LockOrientationOutsideSafeZone` to lock orientation the
first time you engage and ignore further swapping for the rest of that
drag (until you return to the safe zone).

## What each mode does

- **Pusher** (default, no modifier): the origin is fixed. Nodes on the far
  side of the origin - in the direction you're dragging - get pushed away
  by the (safe-zone-discounted) drag distance, opening a gap starting at
  the origin. Nodes on the other side are untouched.
- **Puller** (Shift): the region between the origin and the current cursor
  position collapses. Nodes strictly inside that region are left exactly
  where they are. Nodes beyond the cursor, on the far side from the origin,
  get pulled in to close the gap - continuously and with **no limit**: a
  node can be pulled straight through and past the origin if you keep
  pulling. Once a node has been pulled in, it stays "captured" for the rest
  of the (axis, mode) run and keeps being pulled with the same continuous
  formula even once the growing collapsed region would otherwise reach past
  its original position - this is what prevents a "pulls fine, then
  suddenly snaps back to the original position" glitch.
- **Aligner** (Alt, experimental/testing): imagine the ripple line as a
  rigid stick swept from the origin to the cursor. Any node the stick
  touches gets shoved just far enough to stay clear of it, and now **sticks**
  to the line for the rest of the run: pulling the line back pulls that node
  back with it (respecting the grid-snap setting), all the way until the
  line retreats past the node's own original position, at which point the
  node is released and just sits there again. No fill rectangle is drawn
  for this mode (there's no "space" concept), just the line and icon.

  The aligner also deliberately does **not** use the safe-zone-discounted
  cursor position the other two modes use - it's a direct physical
  interaction with the line's actual position, so the line has to actually
  touch a node to affect it, regardless of the safe-zone radius setting.
  For the same reason, no distance line or distance label is drawn in this
  mode - "distance from origin" isn't a meaningful concept for it.

## Node inclusion mode

`RippleEdit.NodeInclusionMode` controls what happens when the ripple line
starts (or ends up) partway through a node instead of cleanly outside all of
them:

- **"Node must be fully clear of the line"** (default) - a node only counts
  as being on one side once its *entire* bounding box has cleared the line.
- **"Any part of the node touching the line"** - a single pixel of overlap
  is enough to count it.
- **"Node's center crossing the line"** - the node's center point decides
  which side it's on.

## Line length

The ripple line's length is remembered as an **absolute pixel length** (or
"infinite"), not a percentage - and it persists across drags, and across
mode/orientation changes within a drag, until you scroll again. A brand new
infinite line is drawn all the way to the edges of the workspace, not some
smaller default.

- Scrolling while the line is infinite sets a baseline: down sets it to 80%
  of the current viewport dimension, up sets it to 20% - converted to, and
  remembered as, an absolute pixel length from then on.
- Every scroll after that adjusts the current length by
  `RippleEdit.ScrollStepPercent` of the *current* viewport dimension
  (rounded to the nearest step), with **no upper limit** - it can grow
  past what the current viewport shows.
- Shrinking it below one step turns it back into an infinite line.
- Once finite, only nodes whose bounding box actually falls within the
  line's current length are affected; nodes outside it sit at their current
  position, and moving back inside picks them up again immediately.

## Visuals

- **Origin marker**: a circle at the drag-start point, radius =
  `RippleEdit.SafeZoneRadius` (so it scales with zoom), drawn in the current
  mode's color - or a cross if the radius is 0.
- **Ripple line**: drawn as a filled, edge-aligned rectangle rather than a
  centered stroke - its forward edge (in the direction of travel) sits
  exactly at the line's actual position, with the full thickness extending
  backward from there. Nothing is ever drawn past that position.
- **Mode icon**: a small triangle (pusher/puller) or a 3-bar "align to base"
  glyph (aligner), whose tip/base edge also ends exactly at the line's
  position - grayed out while inside the safe zone.
- **Fill rectangle**: between the origin and the line, for pusher/puller
  only (not drawn for the aligner).
- **Distance line + label** (pusher/puller only, not aligner): a dashed line
  from the edge of the safe-zone circle (the side facing the direction of
  travel) out to the line, with a label right before the mode icon showing
  how far it's moved - `+123px` normally, or `+5x` (multiples of the grid
  cell) when LiteGraph's "Always Snap To Grid" is on. Either way, the
  safe-zone radius has already been subtracted out of the distance shown -
  it reflects how far the line has moved *since it started actually having
  an effect*, not the raw cursor distance from the origin.
- **Off-screen overflow labels**: if the line's finite length extends beyond
  the workspace edge, a small `+123px` label on that edge shows how much is
  hidden. Only relevant once you've scrolled to a finite length.
- The line, rectangle, origin marker and icon are drawn on an overlay
  clipped to the graph canvas's own bounding box, so they never cover the
  topbar, sidebar, or console panel. The text labels are drawn on a
  *separate*, unclipped, full-viewport layer instead, so they stay legible
  even if that puts them over another panel.
- `RippleEdit.HideVisuals` turns off all of the above - the tool still
  moves nodes exactly the same, just without drawing anything.

## Settings

Registered under ComfyUI's settings panel (search "Ripple Edit"):

| Setting | Default | Meaning |
|---|---|---|
| `RippleEdit.Enabled` | `true` | Master on/off switch |
| `RippleEdit.SafeZoneRadius` | `10` | Graph-space radius around the origin in which nothing moves yet. Also the origin-circle radius. |
| `RippleEdit.MaxDistance` | `-1` | Graph-space distance from the origin beyond which nodes are never moved. `-1` = no limit. |
| `RippleEdit.LineWidth` | `5` | Ripple line thickness, in px |
| `RippleEdit.ScrollStepPercent` | `5` | Percentage-point change per wheel notch, relative to the current viewport dimension |
| `RippleEdit.NodeInclusionMode` | "fully clear" | See "Node inclusion mode" above |
| `RippleEdit.LockOrientationOutsideSafeZone` | `false` | Disable orientation swapping once engaged, for the rest of that drag |
| `RippleEdit.HideVisuals` | `false` | Hide all ripple visuals; movement still works |
| `RippleEdit.PusherLineColor` / `PusherFillColor` | green | Pusher mode colors (CSS color string) |
| `RippleEdit.PullerLineColor` / `PullerFillColor` | red | Puller mode colors |
| `RippleEdit.AlignerLineColor` / `AlignerFillColor` | orange | Aligner mode colors |

Color settings accept any valid CSS color string (`#rrggbb`, `rgb(...)`,
`rgba(...)`, named colors, etc).

If your ComfyUI version's settings API differs enough that registration
fails, the extension falls back to these defaults and still works - you just
won't get a UI to change them (there's a console warning if that happens).

## Snap to grid

Node positions respect LiteGraph's own **Canvas > Always Snap To Grid** /
**Canvas > Snap to grid size** settings (`Comfy.Graph.AlwaysSnapToGrid` and
`Comfy.SnapToGrid.GridSize`, with a couple of older/alternate setting IDs as
fallback) - when "Always Snap To Grid" is on, node positions only ever land
on multiples of the grid size, same as normal node dragging, and the
distance label switches from pixels to grid-cell counts (see Visuals above).

## Right-click context menu

Ctrl+Right-click is fully claimed by this tool, so the browser/ComfyUI
context menu is suppressed for it - including if the drag ends with the
cursor outside the graph canvas (e.g. over a sidebar), which is handled with
a window-level listener rather than one scoped to any specific element.
Plain right-click (no Ctrl) is completely untouched everywhere.

## Nodes 2.0 compatibility

**Known limitation, not fully fixed.** ComfyUI's newer Vue-based node
renderer ("Nodes 2.0", toggled via `Comfy.VueNodes.Enabled` - see
https://docs.comfy.org/interface/nodes-2) stores node positions in a
separate layout store with, as of this writing, only a one-way sync *into*
LiteGraph and no documented/stable public API for writing into it directly.
This extension still computes and writes `node.pos` correctly (so
everything works if you switch back to classic rendering, and any
downstream code that reads `node.pos` still sees the right values), but
under Nodes 2.0 the on-screen position of a moved node may not update in
real time. You'll get one console warning per session if this applies to
you. If you hit this, the current workaround is switching Nodes 2.0 off.

Separately - and this part **is** fixed - all of this extension's pointer
listeners are attached at the `window` level rather than scoped to the
LiteGraph `<canvas>` element, specifically because Nodes 2.0 renders nodes
as separate overlaid DOM elements: a canvas-scoped listener would never see
a right-click that lands on a node at all. That part works correctly
regardless of which rendering mode is active.

## Known limitations / things not implemented

- Only nodes (`app.graph._nodes`) are moved. Groups and reroute-only
  elements aren't repositioned.
- Undo integration is best-effort (`app.graph.change()` is called after a
  drag finishes, if it exists) - depending on your ComfyUI version, a ripple
  move may or may not show up as a single undo step.
- In aligner mode, if pushing one node causes it to overlap another that
  isn't itself touching the stick, they're allowed to overlap - there's no
  chain-reaction collision resolution.
- The "node inclusion mode" setting and the max-distance cutoff both apply
  along the drag axis; the line-length filter (see "Line length" above) is
  always a simple "does the node's box overlap the line's length" test,
  independent of that setting.
