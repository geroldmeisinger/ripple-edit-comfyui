/**
 * The mutable drag-state object `R`, plus small state-related helpers.
 */

import { app } from "../../../scripts/app.js";
import { RIPPLE_MODE } from "./ripple_constants.js";

export const R = {
    isDragging: false,

    // True, fixed drag-start reference. Used for: safe-zone test, origin
    // marker, max-distance cutoff, and the distance-moved readout.
    startWorld: null,            // {x,y}
    trueOriginalPositions: null, // Map(node -> {x,y}) snapshot at drag start

    // Live cursor tracking.
    lastWorld: null,           // {x,y} graph-space
    lastLocal: null,           // {x,y} canvas-local CSS px

    // Orientation memory: frozen while inside the safe zone.
    engagedAxis: null,         // "x" | "y" | null (null = never engaged yet)

    // Current "segment" - the local baseline that insert/reverse/pusher math
    // is computed relative to. Reset (without visual jump) whenever the
    // mode or axis changes, or whenever the tool re-engages after the safe
    // zone.
    segmentSnapshot: null,     // Map(node -> {x,y})
    segmentOrigin: null,       // {x,y} graph-space
    segmentAxis: null,         // "x" | "y"
    segmentMode: null,         // RIPPLE_MODE.*
    segmentSafeRadius: 0,      // see ripple_engine.js applyRipple() - only nonzero for a
                               // segment that starts right as the tool re-engages after
                               // the safe zone; keeps that transition jump-free without
                               // permanently offsetting the ripple threshold from the
                               // true origin.
    captured: null,            // Set(node) - reverse-mode "sticky pull" set

    // Scroll-controlled line extent.
    hasScrolled: false,
    extentPercent: null,       // null = infinite, else 3..100

    // Cached, for rendering.
    displayAxis: null,
    displayMode: RIPPLE_MODE.INSERT,
    displayInSafeZone: true,
};

export function resetDragState() {
    R.isDragging = false;
    R.startWorld = null;
    R.trueOriginalPositions = null;
    R.lastWorld = null;
    R.lastLocal = null;
    R.engagedAxis = null;
    R.segmentSnapshot = null;
    R.segmentOrigin = null;
    R.segmentAxis = null;
    R.segmentMode = null;
    R.segmentSafeRadius = 0;
    R.captured = null;
    R.hasScrolled = false;
    R.extentPercent = null;
    R.displayAxis = null;
    R.displayMode = RIPPLE_MODE.INSERT;
    R.displayInSafeZone = true;
}

export function currentModeFromEvent(e) {
    if (e && e.altKey) return RIPPLE_MODE.PUSHER;
    if (e && e.shiftKey) return RIPPLE_MODE.REVERSE;
    return RIPPLE_MODE.INSERT;
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
