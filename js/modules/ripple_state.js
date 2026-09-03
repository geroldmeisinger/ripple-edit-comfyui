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
    startWorld: null,            // {x,y}
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
    captured: null,            // Set(node) - sticky pull/align set for the current (axis, mode) run

    // Cached, for rendering (see ripple_engine.js applyRipple()).
    displayAxis: null,
    displayMode: RIPPLE_MODE.PUSHER,
    displayInSafeZone: true,
    displayDelta: 0,           // signed; safe-zone-discounted for pusher/puller, raw for aligner
    displayDir: 0,
};

export function resetDragState() {
    R.isDragging = false;
    R.startWorld = null;
    R.trueOriginalPositions = null;
    R.lastWorld = null;
    R.lastLocal = null;
    R.engagedAxis = null;
    R.currentAxis = null;
    R.currentMode = null;
    R.captured = null;
    R.displayAxis = null;
    R.displayMode = RIPPLE_MODE.PUSHER;
    R.displayInSafeZone = true;
    R.displayDelta = 0;
    R.displayDir = 0;
}

export function currentModeFromEvent(e) {
    if (e && e.altKey) return RIPPLE_MODE.ALIGNER;
    if (e && e.shiftKey) return RIPPLE_MODE.PULLER;
    return RIPPLE_MODE.PUSHER;
}

export function snapshotPositions(nodes) {
    const m = new Map();
    for (const node of nodes) {
        if (!node || !node.pos) continue;
        m.set(node, { x: node.pos[0], y: node.pos[1] });
    }
    return m;
}

export function snapshotCurrentPositions() {
    const nodes = (app.graph && app.graph._nodes) || [];
    return snapshotPositions(nodes);
}

// ---------------------------------------------------------------------------
// Remembered ripple line length - persists across drags and across
// mode/orientation changes within a drag; only a wheel event changes it.
// ---------------------------------------------------------------------------

let rememberedExtentPxValue = null; // null = infinite

export function getRememberedExtentPx() {
    return rememberedExtentPxValue;
}

export function setRememberedExtentPx(v) {
    rememberedExtentPxValue = v;
}
