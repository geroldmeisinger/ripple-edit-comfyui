/**
 * Orchestration: the perpendicular line-length filter, applying the ripple
 * to every node, and `tick()` - the per-frame function that handles the
 * safe zone, resets on any (axis, mode, direction) change, and triggers a
 * redraw.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE SAFE ZONE (AND THE ORIENTATION TIMER) ARE FOR
 * ---------------------------------------------------------------------------
 * A real mouse gesture rarely starts out moving in a perfectly straight
 * line - the first few pixels of a drag often "tremble" a little (e.g. the
 * overall motion is clearly rightward, but there's a stray pixel or two of
 * vertical drift right at the start). If orientation were picked from the
 * very first hint of movement, that tremble could just as easily pick the
 * wrong axis. Two independent safeguards exist against this:
 *
 *  - The safe zone (`RippleEdit.SafeZoneRadius`, display px): a small dead
 *    zone around the origin. Nothing moves and orientation isn't committed
 *    to while the cursor is inside it.
 *  - The orientation timer (`RippleEdit.SafeZoneOrientationTimeoutMs`): even
 *    once the cursor has cleared the safe zone, the tool stays visually
 *    "disengaged" (greyed line, orientation still free to swap, nothing
 *    moves) until this much time has passed since the cursor first moved
 *    away from the *exact* origin point. This catches a fast tremble that's
 *    already large enough to clear a small safe zone in a single event, by
 *    also requiring a *moment* of continued movement before committing.
 *
 * Both must be satisfied (outside the safe zone AND the timer elapsed)
 * before the tool is considered truly "engaged": orientation locks in, and
 * nodes start actually moving.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SAFE ZONE IS IN SCREEN PIXELS, NOT GRAPH UNITS
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
import { getScale, screenAxisToWorld, clientToCanvasLocal, canvasLocalToWorld, getCachedGraphCanvasRect, invalidateCanvasRectCache } from "./ripple_coords.js";
import { R, currentModeFromEvent, getRememberedExtentPx } from "./ripple_state.js";
import { computePushShift, computePullShift, computeAlignerShift, edgeIncluded } from "./ripple_math.js";
import { redrawOverlays } from "./ripple_draw.js";

// ---------------------------------------------------------------------------
// Perpendicular line-length filter
// ---------------------------------------------------------------------------

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

/** The visible workspace's world-space bounds along one axis, for the off-screen-affected-item count. */
function getVisibleWorldRange(axisIdx) {
    const rect = getCachedGraphCanvasRect();
    if (!rect) return null;
    const extent = axisIdx === 0 ? rect.width : rect.height;
    const a = screenAxisToWorld(0, axisIdx);
    const b = screenAxisToWorld(extent, axisIdx);
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
    // 0 (or any non-positive value) means "no limit" - see RippleEdit.MaxDistance.
    const maxDist = settings.maxDistance;
    const inclusion = settings.nodeInclusionMode;
    // The safe-zone radius is configured in display pixels; convert to
    // graph units at the current zoom to combine with graph-space deltas.
    const safeRadiusGraph = Math.max(0, settings.safeZoneRadius) / getScale();

    const perpRange = getPerpWorldRange(perpIdx);
    const perpTest = perpRange ? (x) => x >= perpRange[0] && x <= perpRange[1] : null;

    const rawDelta = rawCursorCoord - originCoord;
    const naturalDir = Math.sign(rawDelta);
    // RippleEdit.SafeZoneLockOrientation, once a direction is established,
    // freezes it for the pusher/puller (see tick()) - `R.forcedDir` carries
    // that override in here. The aligner deliberately ignores it: it's a
    // direct physical interaction with wherever the line actually is, and
    // "lock the direction" has no sensible meaning once something's
    // magnetically attached to a stick that has to be able to move back the
    // way it came.
    const rawDir = mode !== RIPPLE_MODE.ALIGNER && R.forcedDir !== null ? R.forcedDir : naturalDir;

    let delta, dir, cursorCoord;
    if (mode === RIPPLE_MODE.ALIGNER) {
        // The aligner is a direct physical interaction with the line's
        // actual position - no safe-zone discount, that's a pusher/puller
        // "space" concept.
        delta = rawDir * Math.abs(rawDelta);
        dir = rawDir;
        cursorCoord = originCoord + delta;
    } else {
        dir = rawDir;
        delta = dir * Math.max(0, Math.abs(rawDelta) - safeRadiusGraph);
        cursorCoord = originCoord + delta;
    }

    R.displayDelta = delta;
    R.displayDir = dir;

    // MaxDistance combined with NodeInclusionMode: "clear" (default) needs
    // the node's *far* edge (in the direction of travel) within the cutoff -
    // the most conservative reading, matching how "clear" already means
    // "the harder-to-satisfy endpoint" everywhere else in this tool.
    // "touching" only needs the *near* edge within it - the most inclusive.
    // Both fall out of the same edgeIncluded() combinator already used
    // elsewhere, applied to a one-sided "how far past origin, in the
    // direction of travel" test instead of the old single-point check.
    // Doesn't apply to the aligner at all - "how far can this reach" isn't
    // a meaningful concept for a direct physical touch.
    const maxDistTest = mode !== RIPPLE_MODE.ALIGNER && maxDist > 0 ? (x) => (x - originCoord) * dir <= maxDist : null;

    const visibleRange = getVisibleWorldRange(axisIdx);
    let offBefore = 0;
    let offAfter = 0;
    R.currentlyAffected = new Set();

    for (const [node, orig] of R.trueOriginalPositions) {
        if (!node || !node.pos) continue;

        // LiteGraph draws a node's title bar *above* `pos` - `pos`/`size`
        // only describe the body. All eligibility/shift math below happens
        // in this "visual" coordinate space (title included) so a node's
        // actual on-screen extent is what's being tested against, not just
        // its body; the title-height offset is added back once, right when
        // computing the final real position to write to `node.pos`. Groups
        // and reroutes carry `titleHeight: 0`, so this is a no-op for them.
        const titleAdj = axisIdx === 1 ? orig.titleHeight || 0 : 0;
        const realC = axisIdx === 0 ? orig.x : orig.y;
        const c = realC - titleAdj;
        const w = (node.size ? node.size[axisIdx] : 0) + titleAdj;
        const nodeMin = c;
        const nodeMax = c + w;

        const perpTitleAdj = perpIdx === 1 ? orig.titleHeight || 0 : 0;
        const realPerpC = perpIdx === 0 ? orig.x : orig.y;
        const perpC = realPerpC - perpTitleAdj;
        const perpH = (node.size ? node.size[perpIdx] : 0) + perpTitleAdj;

        // Being "stuck" to the puller/aligner and later falling outside the
        // line's finite length is a *release*: with the default "clear"
        // setting (both edges must be inside to count), applying that same
        // test to "is the node still fully within the line's reach" means
        // the node is released the instant even a sliver of it isn't.
        const wasCaptured = mode !== RIPPLE_MODE.PUSHER && R.captured.has(node);
        if (wasCaptured && perpRange) {
            const stillIn = edgeIncluded(perpTest, perpC, perpC + perpH, inclusion);
            if (!stillIn) {
                R.captured.delete(node);
                if (R.captureDir) R.captureDir.delete(node);
            }
        }
        const stillCaptured = mode !== RIPPLE_MODE.PUSHER && R.captured.has(node);
        const inPerp = stillCaptured || !perpRange || edgeIncluded(perpTest, perpC, perpC + perpH, inclusion);
        const withinMaxDist = !maxDistTest || edgeIncluded(maxDistTest, nodeMin, nodeMax, inclusion);

        let shiftedCoord = c;
        let affected = false;
        if (inPerp && withinMaxDist) {
            if (mode === RIPPLE_MODE.ALIGNER) {
                shiftedCoord = c + computeAlignerShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir);
            } else if (mode === RIPPLE_MODE.PUSHER) {
                shiftedCoord = c + computePushShift(nodeMin, nodeMax, originCoord, dir, delta, inclusion);
            } else if (mode === RIPPLE_MODE.PULLER) {
                shiftedCoord = c + computePullShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir, delta, inclusion);
            }
            affected = shiftedCoord !== c;
        }
        if (affected) R.currentlyAffected.add(node);

        const finalCoord = snapValue(shiftedCoord + titleAdj); // back to real (body) coordinate space before snapping
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

        if (affected && visibleRange) {
            const farEdge = finalCoord + (node.size ? node.size[axisIdx] : 0);
            if (farEdge < visibleRange[0]) offBefore++;
            else if (finalCoord > visibleRange[1]) offAfter++;
        }
    }

    R.displayOffscreenNodesBefore = offBefore;
    R.displayOffscreenNodesAfter = offAfter;

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
// Per-frame orchestration: safe zone, orientation timer, reset-on-change,
// apply, redraw
// ---------------------------------------------------------------------------

export function tick(e) {
    if (!R.isDragging) return;

    // One fresh canvas-rect read per frame, shared by everything below.
    invalidateCanvasRectCache();
    if (!getCachedGraphCanvasRect()) return;

    if (e && typeof e.clientX === "number") {
        const local = clientToCanvasLocal(e.clientX, e.clientY);
        R.lastLocal = local;
        R.lastWorld = canvasLocalToWorld(local.x, local.y);
    }
    if (!R.lastWorld || !R.lastLocal || !R.startLocal) return;

    const distScreen = Math.hypot(R.lastLocal.x - R.startLocal.x, R.lastLocal.y - R.startLocal.y);
    const safeRadiusPx = Math.max(0, settings.safeZoneRadius);
    const inSafeZone = distScreen <= safeRadiusPx;
    const atExactOrigin = distScreen === 0;

    // Orientation-decision timer (see the module header for why this exists
    // alongside the safe zone).
    if (atExactOrigin) {
        R.awayFromOriginSince = null;
    } else if (R.awayFromOriginSince === null) {
        R.awayFromOriginSince = Date.now();
    }
    const timeoutMs = Math.max(0, settings.safeZoneOrientationTimeoutMs);
    const timeoutElapsed = R.awayFromOriginSince !== null && Date.now() - R.awayFromOriginSince >= timeoutMs;

    // "Disengaged": nodes don't move and the line is greyed, whether because
    // we're spatially in the safe zone or because the timer hasn't elapsed.
    let disengaged = inSafeZone || !timeoutElapsed;

    // Mode is decided purely from the event's modifier keys, so it's safe
    // to compute this early and use it below.
    const mode = currentModeFromEvent(e);

    const alignerHasStuckNodes = R.currentMode === RIPPLE_MODE.ALIGNER && R.captured && R.captured.size > 0;

    const dxTrue = R.lastWorld.x - R.startWorld.x;
    const dyTrue = R.lastWorld.y - R.startWorld.y;
    const dominant = () => (Math.abs(dxTrue) >= Math.abs(dyTrue) ? "x" : "y");

    let liveAxis;
    if (!disengaged) {
        if (settings.lockOrientationOutsideSafeZone && R.engagedAxis !== null) {
            liveAxis = R.engagedAxis; // locked - ignore further orientation changes this drag
        } else {
            liveAxis = dominant();
            R.engagedAxis = liveAxis;
        }
    } else if (R.engagedAxis !== null) {
        liveAxis = R.engagedAxis; // frozen orientation while disengaged
    } else {
        liveAxis = dominant(); // never engaged yet - provisional, display-only
    }

    // Aligner stickiness overrides everything above: axis can't change at
    // all while something is attached, unconditionally.
    if (alignerHasStuckNodes) {
        liveAxis = R.currentAxis;
    }

    // Direction locking: with RippleEdit.SafeZoneLockOrientation on, once a
    // real direction has been established it's frozen for the rest of the
    // drag too - not just the axis. While frozen, only the *magnitude* of
    // displacement from the origin matters; the literal screen direction
    // that produced it doesn't. Deliberately doesn't apply to the aligner
    // (see the note in applyRipple() for why).
    let forcedDir = null;
    if (mode !== RIPPLE_MODE.ALIGNER && settings.lockOrientationOutsideSafeZone) {
        if (!disengaged) {
            const axisIdxNow = liveAxis === "x" ? 0 : 1;
            const rawNow = Math.sign(axisIdxNow === 0 ? dxTrue : dyTrue);
            if (R.engagedDir === null && rawNow !== 0) {
                R.engagedDir = rawNow;
            }
        }
        forcedDir = R.engagedDir;
    } else if (mode !== RIPPLE_MODE.ALIGNER) {
        R.engagedDir = null;
    }
    R.forcedDir = forcedDir;

    // Direction-locked "dead zone": once a direction is locked in, moving
    // to the *wrong* side of the origin (outside the safe zone, in the
    // opposite direction from the locked one) makes the tool do nothing at
    // all for pusher/puller - everything reverts to its original position.
    // This is evaluated fresh every frame (not "sticky"): returning to the
    // originally-locked side resumes normally, since the direction itself
    // never actually changed, only which side of it you're currently on.
    // The aligner is exempt: nodes stuck to it have to be able to follow it
    // back across the origin (see computeAlignerShift/applyRipple), so
    // there's no "wrong side" for it.
    if (mode !== RIPPLE_MODE.ALIGNER && forcedDir !== null && !inSafeZone) {
        const axisIdxNow = liveAxis === "x" ? 0 : 1;
        const rawNow = Math.sign(axisIdxNow === 0 ? dxTrue : dyTrue);
        if (rawNow !== 0 && rawNow !== forcedDir) {
            disengaged = true;
        }
    }

    // Icon/line direction keeps live-updating even while disengaged - only
    // the magnitude (and therefore any actual node movement) is held at
    // zero there, not the direction.
    const liveAxisIdx = liveAxis === "x" ? 0 : 1;
    const liveRawDelta = liveAxisIdx === 0 ? dxTrue : dyTrue;
    R.displayDir = forcedDir !== null ? forcedDir : Math.sign(liveRawDelta);

    if (disengaged) {
        restoreTrueOriginalPositions();
        // The aligner is a special case: if anything is currently stuck to
        // it, dipping through the safe zone only *visually* disengages
        // (positions revert, line greys out) - the underlying "what's
        // stuck, and which of its edges" bookkeeping is preserved, so that
        // leaving the safe zone again immediately resumes moving those same
        // items, rather than requiring them to be re-touched from scratch.
        // Pusher/puller (and an aligner with nothing currently stuck) get a
        // full reset instead, same as before.
        if (!alignerHasStuckNodes) {
            R.currentAxis = null;
            R.currentMode = null;
            R.currentDir = null;
            R.captured = null;
            R.captureDir = null;
        }
        R.displayDelta = 0;
        R.displayOffscreenNodesBefore = 0;
        R.displayOffscreenNodesAfter = 0;
        R.currentlyAffected = null;
    } else {
        const axisIdxNow = liveAxis === "x" ? 0 : 1;
        const rawDeltaNow = axisIdxNow === 0 ? dxTrue : dyTrue;
        const rawDirNow = Math.sign(rawDeltaNow);

        // A direction reversal *within the same (axis, mode) run* only
        // needs special handling for the puller - see the note in
        // ripple_math.js for why the pusher and aligner don't need this.
        // Locked direction (forcedDir set) can't flip by construction, so
        // this never fires while locked.
        let dirFlipped = false;
        if (mode === RIPPLE_MODE.PULLER && forcedDir === null && R.currentDir !== null && R.currentDir !== 0 && rawDirNow !== 0) {
            dirFlipped = rawDirNow !== R.currentDir;
        }

        const changed = R.currentAxis !== liveAxis || R.currentMode !== mode || dirFlipped;
        if (changed) {
            // No more continuing seamlessly into a new mode/orientation -
            // everything moved so far in this run reverts first.
            restoreTrueOriginalPositions();
            R.captured = new Set();
            R.captureDir = new Map();
            R.currentAxis = liveAxis;
            R.currentMode = mode;
            R.currentDir = rawDirNow !== 0 ? rawDirNow : null;
        } else if (R.currentDir === null && rawDirNow !== 0) {
            R.currentDir = rawDirNow;
        }
        applyRipple();
    }

    R.displayAxis = liveAxis;
    R.displayMode = mode;
    R.displayInSafeZone = inSafeZone;
    R.displayDisengaged = disengaged;
    R.displayAtExactOrigin = atExactOrigin;

    redrawOverlays();
}
