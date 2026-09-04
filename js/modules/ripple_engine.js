/**
 * Orchestration: the perpendicular line-length filter, applying the ripple
 * to every node, and `tick()` - the per-frame function that handles the
 * safe zone, resets on any (axis, mode) change, and triggers a redraw.
 */

import { app } from "../../../scripts/app.js";
import { RIPPLE_MODE } from "./ripple_constants.js";
import { settings, snapValue, warnAboutVueNodesOnce } from "./ripple_settings.js";
import { getGraphCanvasEl, screenAxisToWorld, clientToCanvasLocal, canvasLocalToWorld } from "./ripple_coords.js";
import { R, currentModeFromEvent, getRememberedExtentPx } from "./ripple_state.js";
import { computePushShift, computePullShift, computeAlignerShift, edgeIncluded } from "./ripple_math.js";
import { redrawOverlays } from "./ripple_draw.js";

// ---------------------------------------------------------------------------
// Perpendicular line-length filter
// ---------------------------------------------------------------------------
// When the ripple line's remembered length is finite (rather than
// "infinite"), only nodes whose bounding box actually falls within that
// length (in the perpendicular dimension) are eligible for movement.
// Returns [worldMin, worldMax] or null when the line is infinite (no filter).

export function getPerpWorldRange(perpIdx) {
    const extentPx = getRememberedExtentPx();
    if (extentPx === null) return null;
    if (!R.lastLocal) return null;
    const perpCenterLocal = perpIdx === 0 ? R.lastLocal.x : R.lastLocal.y;
    const startLocal = perpCenterLocal - extentPx / 2;
    const endLocal = perpCenterLocal + extentPx / 2;
    const a = screenAxisToWorld(startLocal, perpIdx);
    const b = screenAxisToWorld(endLocal, perpIdx);
    return [Math.min(a, b), Math.max(a, b)];
}

// ---------------------------------------------------------------------------
// Apply ripple to all nodes, always relative to the true drag-start snapshot
// ---------------------------------------------------------------------------

export function applyRipple() {
    if (!R.currentAxis || !R.trueOriginalPositions) return;
    const axisIdx = R.currentAxis === "x" ? 0 : 1;
    const perpIdx = axisIdx === 0 ? 1 : 0;
    const originCoord = axisIdx === 0 ? R.startWorld.x : R.startWorld.y;
    const rawCursorCoord = axisIdx === 0 ? R.lastWorld.x : R.lastWorld.y;
    const mode = R.currentMode;
    const maxDist = settings.maxDistance;
    const inclusion = settings.nodeInclusionMode;
    const safeRadius = Math.max(0, settings.safeZoneRadius);

    const perpRange = getPerpWorldRange(perpIdx);

    const rawDelta = rawCursorCoord - originCoord;
    const rawDir = Math.sign(rawDelta);

    // The safe-zone discount (see below) exists purely so the pusher/puller
    // threshold - and the on-screen distance readout - feel continuous as
    // you cross out of the safe zone; it's about *space*, not about a
    // physical touch. The aligner is a direct physical interaction with the
    // line's actual position, so it deliberately uses the raw, undiscounted
    // cursor position instead - using the discounted one would mean the
    // aligner only "reaches" a node once the line is `safeZoneRadius` worth
    // of extra pixels *inside* it, which doesn't correspond to anything
    // physical.
    let delta, dir, cursorCoord;
    if (mode === RIPPLE_MODE.ALIGNER) {
        delta = rawDelta;
        dir = rawDir;
        cursorCoord = rawCursorCoord;
    } else {
        dir = rawDir;
        delta = dir * Math.max(0, Math.abs(rawDelta) - safeRadius);
        cursorCoord = originCoord + delta;
    }

    R.displayDelta = delta;
    R.displayDir = dir;

    for (const [node, orig] of R.trueOriginalPositions) {
        if (!node || !node.pos) continue;
        const c = axisIdx === 0 ? orig.x : orig.y;
        const w = node.size ? node.size[axisIdx] : 0;
        const nodeMin = c;
        const nodeMax = c + w;

        const perpC = perpIdx === 0 ? orig.x : orig.y;
        const perpH = node.size ? node.size[perpIdx] : 0;
        const inPerp = !perpRange || edgeIncluded((x) => x >= perpRange[0] && x <= perpRange[1], perpC, perpC + perpH, inclusion);

        if (!inPerp && (mode === RIPPLE_MODE.PULLER || mode === RIPPLE_MODE.ALIGNER) && R.captured.has(node)) {
            // "Falls off the side" of a finite line: fully release it rather
            // than just skipping this frame, so it doesn't silently re-stick
            // the instant the line's length/position happens to cover it
            // again later in this run.
            R.captured.delete(node);
        }

        let shiftedCoord = c;
        if (inPerp) {
            const distFromTrueOrigin = Math.abs(c - originCoord);
            if (maxDist === -1 || distFromTrueOrigin <= maxDist) {
                if (mode === RIPPLE_MODE.ALIGNER) {
                    shiftedCoord = c + computeAlignerShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir, inclusion);
                } else if (mode === RIPPLE_MODE.PUSHER) {
                    shiftedCoord = c + computePushShift(nodeMin, nodeMax, originCoord, dir, delta, inclusion);
                } else if (mode === RIPPLE_MODE.PULLER) {
                    shiftedCoord = c + computePullShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir, delta, inclusion);
                }
            }
        }

        const finalCoord = snapValue(shiftedCoord);
        if (axisIdx === 0) {
            node.pos[0] = finalCoord;
            node.pos[1] = orig.y;
        } else {
            node.pos[0] = orig.x;
            node.pos[1] = finalCoord;
        }
    }

    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
    warnAboutVueNodesOnce();
}

export function restoreTrueOriginalPositions() {
    if (!R.trueOriginalPositions) return;
    for (const [node, orig] of R.trueOriginalPositions) {
        if (!node || !node.pos) continue;
        node.pos[0] = orig.x;
        node.pos[1] = orig.y;
    }
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

// ---------------------------------------------------------------------------
// Per-frame orchestration: safe zone, reset-on-change, apply, redraw
// ---------------------------------------------------------------------------

export function tick(e) {
    if (!R.isDragging) return;
    if (!getGraphCanvasEl()) return;

    if (e && typeof e.clientX === "number") {
        const local = clientToCanvasLocal(e.clientX, e.clientY);
        R.lastLocal = local;
        R.lastWorld = canvasLocalToWorld(local.x, local.y);
    }
    if (!R.lastWorld) return;

    const dxTrue = R.lastWorld.x - R.startWorld.x;
    const dyTrue = R.lastWorld.y - R.startWorld.y;
    const distTrue = Math.hypot(dxTrue, dyTrue);
    const safeRadius = Math.max(0, settings.safeZoneRadius);
    const inSafeZone = distTrue <= safeRadius;

    const dominant = () => (Math.abs(dxTrue) >= Math.abs(dyTrue) ? "x" : "y");

    let liveAxis;
    if (!inSafeZone) {
        if (settings.lockOrientationOutsideSafeZone && R.engagedAxis !== null) {
            liveAxis = R.engagedAxis; // locked - ignore further orientation changes this drag
        } else {
            liveAxis = dominant();
            R.engagedAxis = liveAxis;
        }
    } else if (R.engagedAxis !== null) {
        liveAxis = R.engagedAxis; // frozen orientation while back inside the safe zone
    } else {
        liveAxis = dominant(); // never engaged yet - provisional, display-only
    }

    const mode = currentModeFromEvent(e);

    if (inSafeZone) {
        restoreTrueOriginalPositions();
        R.currentAxis = null;
        R.currentMode = null;
        R.captured = null;
        // Keep the distance readout consistent with the visual (which
        // always tracks the raw, near-origin cursor while disengaged)
        // instead of showing a stale number from the last time it was
        // engaged.
        R.displayDelta = 0;
        R.displayDir = 0;
    } else {
        const changed = R.currentAxis !== liveAxis || R.currentMode !== mode;
        if (changed) {
            // No more continuing seamlessly into a new mode/orientation -
            // everything moved so far in this run reverts first.
            restoreTrueOriginalPositions();
            R.captured = new Set();
            R.currentAxis = liveAxis;
            R.currentMode = mode;
        }
        applyRipple();
    }

    R.displayAxis = liveAxis;
    R.displayMode = mode;
    R.displayInSafeZone = inSafeZone;

    redrawOverlays();
}
