/**
 * Orchestration: the perpendicular line-length filter, applying the ripple
 * to every node, and `tick()` - the per-frame function that handles the
 * safe zone, resets on any (axis, mode) change, and triggers a redraw.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SAFE ZONE IS FOR
 * ---------------------------------------------------------------------------
 * A real mouse gesture rarely starts out moving in a perfectly straight
 * line - the first few pixels of a drag often "tremble" a little (e.g. the
 * overall motion is clearly rightward, but there's a stray pixel or two of
 * vertical drift right at the start). If orientation were picked from the
 * very first hint of movement, that tremble could just as easily pick the
 * wrong axis. The safe zone is a small dead zone around the origin, in
 * *screen* pixels (see below), where nothing happens yet and orientation
 * isn't committed to - it exists purely to give a real gesture enough room
 * to declare its actual direction before the tool acts on it. Once the
 * cursor clears it, the direction it cleared it in is trusted.
 *
 * ---------------------------------------------------------------------------
 * WHY SCREEN PIXELS, NOT GRAPH UNITS
 * ---------------------------------------------------------------------------
 * A physical mouse tremble is a fixed number of *screen* pixels, regardless
 * of how far zoomed in the graph is - so the safe zone is measured and
 * compared in screen/display pixels (`R.startLocal`/`R.lastLocal`), not
 * graph units. Everything downstream of that decision (how far a node
 * actually shifts, the distance label, the off-screen overflow readout)
 * still operates in graph units, since that's the space node positions
 * live in - so the safe-zone radius is converted from display px to graph
 * units (dividing by the current zoom scale) wherever it needs to be
 * combined with a graph-space distance.
 */

import { app } from "../../../scripts/app.js";
import { RIPPLE_MODE } from "./ripple_constants.js";
import { settings, snapValue } from "./ripple_settings.js";
import { getGraphCanvasEl, getScale, screenAxisToWorld, clientToCanvasLocal, canvasLocalToWorld } from "./ripple_coords.js";
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
    // The safe-zone radius is configured in display pixels; convert to
    // graph units at the current zoom to combine with graph-space deltas.
    const safeRadiusGraph = Math.max(0, settings.safeZoneRadius) / getScale();

    const perpRange = getPerpWorldRange(perpIdx);

    const rawDelta = rawCursorCoord - originCoord;
    const rawDir = Math.sign(rawDelta);

    // The safe-zone discount exists purely so the pusher/puller threshold -
    // and the on-screen distance readout - feel continuous as you cross out
    // of the safe zone; it's about *space*, not about a physical touch. The
    // aligner is a direct physical interaction with the line's actual
    // position, so it deliberately uses the raw, undiscounted cursor
    // position instead - using the discounted one would mean the aligner
    // only "reaches" a node once the line is `safeZoneRadius` worth of
    // extra pixels *inside* it, which doesn't correspond to anything
    // physical.
    let delta, dir, cursorCoord;
    if (mode === RIPPLE_MODE.ALIGNER) {
        delta = rawDelta;
        dir = rawDir;
        cursorCoord = rawCursorCoord;
    } else {
        dir = rawDir;
        delta = dir * Math.max(0, Math.abs(rawDelta) - safeRadiusGraph);
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
        const perpTest = (x) => x >= perpRange[0] && x <= perpRange[1];

        // Being "stuck" to the puller/aligner and later falling outside the
        // line's finite length is a *release*: with the default "clear"
        // setting (both edges must be inside to count), applying that same
        // test to "is the node still fully within the line's reach" means
        // the node is released the instant even a sliver of it isn't -
        // which is what "clear" already means everywhere else, just
        // visible here as an exit condition instead of an entry one. No
        // separate "reversed" combinator needed - same `inclusion` setting,
        // same test, applied to "am I still in range" instead of "did I
        // just enter range".
        const wasCaptured = mode !== RIPPLE_MODE.PUSHER && R.captured.has(node);
        if (wasCaptured && perpRange) {
            const stillIn = edgeIncluded(perpTest, perpC, perpC + perpH, inclusion);
            if (!stillIn) R.captured.delete(node);
        }
        const stillCaptured = mode !== RIPPLE_MODE.PUSHER && R.captured.has(node);
        const inPerp = stillCaptured || !perpRange || edgeIncluded(perpTest, perpC, perpC + perpH, inclusion);

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
        // Whole-array assignment (`node.pos = [x, y]`), never indexed
        // (`node.pos[0] = x`). LiteGraph's `pos` is a getter/setter pair;
        // the indexed form mutates the underlying array directly, which the
        // classic canvas picks up by reading that same array back - but
        // under Nodes 2.0 each item is positioned from a separate layout
        // store that only the setter writes to, so an indexed write moves
        // the model and leaves the node/group/reroute on screen exactly
        // where it was. Going through the setter is correct for (and
        // doesn't change anything about) classic rendering too.
        if (axisIdx === 0) {
            node.pos = [finalCoord, orig.y];
        } else {
            node.pos = [orig.x, finalCoord];
        }
    }

    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

export function restoreTrueOriginalPositions() {
    if (!R.trueOriginalPositions) return;
    for (const [node, orig] of R.trueOriginalPositions) {
        if (!node || !node.pos) continue;
        node.pos = [orig.x, orig.y]; // whole-array assignment - see the note in applyRipple()
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
    if (!R.lastWorld || !R.lastLocal || !R.startLocal) return;

    // Safe-zone membership is decided in screen pixels (see the module
    // header comment for why), independent of zoom.
    const distScreen = Math.hypot(R.lastLocal.x - R.startLocal.x, R.lastLocal.y - R.startLocal.y);
    const safeRadiusPx = Math.max(0, settings.safeZoneRadius);
    const inSafeZone = distScreen <= safeRadiusPx;

    const dxTrue = R.lastWorld.x - R.startWorld.x;
    const dyTrue = R.lastWorld.y - R.startWorld.y;
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

    // While the aligner has anything stuck to it, orientation can't change
    // at all - not even while re-passing through the safe zone - since
    // swapping axis with nodes attached has no sensible physical meaning
    // for a "stuck to a stick" gesture. This is unconditional, independent
    // of RippleEdit.SafeZoneLockOrientation (which only governs the normal,
    // nothing-stuck case above).
    if (R.currentMode === RIPPLE_MODE.ALIGNER && R.captured && R.captured.size > 0) {
        liveAxis = R.currentAxis;
    }

    const mode = currentModeFromEvent(e);

    // The icon/line should keep pointing the right way even while inside
    // the safe zone (disengaged) - only the *magnitude* (and therefore any
    // actual node movement) is held at zero there, not the direction.
    const liveAxisIdx = liveAxis === "x" ? 0 : 1;
    const liveRawDelta = liveAxisIdx === 0 ? dxTrue : dyTrue;
    R.displayDir = Math.sign(liveRawDelta);

    if (inSafeZone) {
        restoreTrueOriginalPositions();
        R.currentAxis = null;
        R.currentMode = null;
        R.captured = null;
        R.displayDelta = 0;
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
        applyRipple(); // also refines R.displayDir/R.displayDelta using the safe-zone-discounted math
    }

    R.displayAxis = liveAxis;
    R.displayMode = mode;
    R.displayInSafeZone = inSafeZone;

    redrawOverlays();
}
