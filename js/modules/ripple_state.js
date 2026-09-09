/**
 * The mutable drag-state object `R`, plus small state-related helpers.
 *
 * `R` is reset at the start of every drag. `rememberedExtentPx` is
 * deliberately NOT part of `R` - it's the ripple line's absolute pixel
 * length (or null for infinite), and it's meant to persist across drags
 * (and across orientation/mode changes within a drag) until the person
 * scrolls again.
 */

import { app } from "../../../scripts/app.js";
import { RIPPLE_MODE } from "./ripple_constants.js";

export const R = {
    isDragging: false,

    // True, fixed drag-start reference. Everything is computed relative to
    // this - there is no more "local segment origin" concept: switching
    // mode or orientation now resets moved nodes back to these positions
    // (see ripple_engine.js) rather than continuing seamlessly from them.
    startWorld: null,            // {x,y} graph-space
    startLocal: null,            // {x,y} canvas-local CSS px - the safe zone is measured in
                                  // *display* pixels (see ripple_engine.js), independent of
                                  // zoom, so this is tracked separately from startWorld.
    trueOriginalPositions: null, // Map(node -> {x,y}) snapshot at drag start

    // Live cursor tracking.
    lastWorld: null,           // {x,y} graph-space
    lastLocal: null,           // {x,y} canvas-local CSS px

    // Orientation memory: frozen while inside the safe zone, and
    // permanently frozen after first engaging if
    // RippleEdit.LockOrientationOutsideSafeZone is on.
    engagedAxis: null,         // "x" | "y" | null (null = never engaged yet)

    // The (axis, mode) pair currently in effect. Changing either resets all
    // moved nodes back to `trueOriginalPositions` first.
    currentAxis: null,         // "x" | "y" | null
    currentMode: null,         // RIPPLE_MODE.*
    currentDir: null,          // signed 1/-1 direction the current run started in (puller-only; see below)
    captured: null,            // Set(node) - sticky pull/align set for the current (axis, mode) run
    captureDir: null,          // Map(node -> dir) - aligner only, see the note in ripple_math.js

    // RippleEdit.SafeZoneLockOrientation, extended: once it's on and a
    // direction has been established, that direction (not just the axis)
    // is frozen for the rest of the drag.
    engagedDir: null,          // signed 1/-1 | null

    // The 150ms-by-default orientation-decision timer (RippleEdit.SafeZoneOrientationTimeoutMs).
    // Resets to "not started" whenever the cursor is exactly back at the
    // origin; starts counting the instant it first moves away from it.
    awayFromOriginSince: null, // timestamp (ms) | null

    // Cached, for rendering (see ripple_engine.js applyRipple()).
    displayAxis: null,
    displayMode: RIPPLE_MODE.PUSHER,
    displayInSafeZone: true,   // true spatial safe-zone membership only - controls whether the
                                // line is shown at all (vs. icon-only)
    displayDisengaged: true,   // inSafeZone OR the orientation timer hasn't elapsed yet - controls
                                // grey-vs-colored and whether nodes actually move
    displayAtExactOrigin: true, // cursor exactly at the origin point - icon isn't drawn here at all
    displayDelta: 0,           // signed; safe-zone-discounted for pusher/puller, raw for aligner
    displayDir: 0,
    displayOffscreenNodesBefore: 0, // count of affected items positioned off-screen, each side
    displayOffscreenNodesAfter: 0,
    currentlyAffected: null,   // Set(item) - whatever is actually being moved this frame, for the ghost-rectangle visual
};

export function resetDragState() {
    R.isDragging = false;
    R.startWorld = null;
    R.startLocal = null;
    R.trueOriginalPositions = null;
    R.lastWorld = null;
    R.lastLocal = null;
    R.engagedAxis = null;
    R.currentAxis = null;
    R.currentMode = null;
    R.currentDir = null;
    R.captured = null;
    R.captureDir = null;
    R.engagedDir = null;
    R.awayFromOriginSince = null;
    R.displayAxis = null;
    R.displayMode = RIPPLE_MODE.PUSHER;
    R.displayInSafeZone = true;
    R.displayDisengaged = true;
    R.displayAtExactOrigin = true;
    R.displayDelta = 0;
    R.displayDir = 0;
    R.displayOffscreenNodesBefore = 0;
    R.displayOffscreenNodesAfter = 0;
    R.currentlyAffected = null;
}

export function currentModeFromEvent(e) {
    if (e && e.altKey) return RIPPLE_MODE.ALIGNER;
    if (e && e.shiftKey) return RIPPLE_MODE.PULLER;
    return RIPPLE_MODE.PUSHER;
}

/**
 * LiteGraph draws a node's title bar *above* `pos` - `pos`/`size` only
 * describe the body. For any Y-axis math (vertical drag, or the
 * perpendicular extent during a horizontal drag) that omits this, a node's
 * actual on-screen top edge is wrong by a full title bar's height. Groups
 * and reroutes have no title bar, so they get 0.
 */
function getNodeTitleHeight(node) {
    try {
        if (node.flags && node.flags.collapsed) return 0;
        if (typeof node.title_height === "number") return node.title_height;
        if (window.LiteGraph && typeof LiteGraph.NODE_TITLE_HEIGHT === "number") return LiteGraph.NODE_TITLE_HEIGHT;
    } catch (err) {
        /* fall through */
    }
    return 30; // LiteGraph's long-standing default
}

export function snapshotPositions(items) {
    const m = new Map();
    for (const { obj, titleHeight } of items) {
        if (!obj || !obj.pos) continue;
        m.set(obj, { x: obj.pos[0], y: obj.pos[1], titleHeight });
    }
    return m;
}

/**
 * Every movable item this tool should reposition: nodes, groups, and native
 * (link-metadata) reroutes. Groups and reroutes are read defensively, since
 * their exact collection shape has shifted across LiteGraph/ComfyUI
 * versions (array vs Map, `_groups` vs `groups`, etc) - if a given
 * property doesn't exist on this version, that category is just skipped
 * rather than throwing. All three are later treated uniformly: reroutes
 * have no `.size`, which the existing "treat missing size as a 0-width
 * point" handling in ripple_engine.js already covers with no extra code.
 * Each entry also carries its title-bar height (0 for groups/reroutes),
 * used to correct the Y-axis bounding box everywhere it matters.
 */
export function getAllMovableObjects() {
    const items = [];
    const graph = app.graph;
    if (!graph) return items;

    const nodes = graph._nodes || [];
    for (const n of nodes) if (n && n.pos) items.push({ obj: n, titleHeight: getNodeTitleHeight(n) });

    try {
        const groups = graph._groups || graph.groups || [];
        for (const g of groups) if (g && g.pos) items.push({ obj: g, titleHeight: 0 });
    } catch (err) {
        /* group collection shape differs on this version - skip */
    }

    try {
        const reroutesRaw = graph.reroutes;
        if (reroutesRaw) {
            const list = reroutesRaw instanceof Map ? [...reroutesRaw.values()] : Object.values(reroutesRaw);
            for (const r of list) if (r && r.pos) items.push({ obj: r, titleHeight: 0 });
        }
    } catch (err) {
        /* reroute collection shape differs on this version - skip */
    }

    return items;
}

export function snapshotCurrentPositions() {
    return snapshotPositions(getAllMovableObjects());
}

// ---------------------------------------------------------------------------
// Remembered ripple line length - persists across drags and across
// mode/orientation changes within a drag; only a wheel event changes it.
// Infinite is only ever reached by growing past the upper threshold (see
// ripple_events.js) - shrinking floors at one scroll step instead, so there
// is no separate "infinite from shrinking" state to track.
// ---------------------------------------------------------------------------

let rememberedExtentPxValue = null; // null = infinite

export function getRememberedExtentPx() {
    return rememberedExtentPxValue;
}

export function setRememberedExtentPx(v) {
    rememberedExtentPxValue = v;
}
