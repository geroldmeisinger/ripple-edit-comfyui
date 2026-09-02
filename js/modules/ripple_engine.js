/**
 * Orchestration: the perpendicular line-length filter, applying the ripple
 * to every node in the current segment, and `tick()` - the per-frame
 * function that handles the safe zone, (re)commits a new "segment" whenever
 * the mode or orientation changes, and triggers a redraw.
 */

import { app } from "../../../scripts/app.js"
import { RIPPLE_MODE } from "./ripple_constants.js"
import { canvasLocalToWorld, getGraphCanvasEl, screenAxisToWorld } from "./ripple_coords.js"
import { redrawOverlays } from "./ripple_draw.js"
import { computeInsertShift, computePusherShift, computeReverseShift } from "./ripple_math.js"
import { settings, snapValue } from "./ripple_settings.js"
import { R, currentModeFromEvent, snapshotCurrentPositions } from "./ripple_state.js"

// ---------------------------------------------------------------------------
// Perpendicular line-length filter
// ---------------------------------------------------------------------------
// When the ripple line's visible extent is a finite percentage (rather than
// "infinite"), only nodes whose bounding box actually falls within that
// segment (in the perpendicular dimension) are eligible for movement.
// Returns [worldMin, worldMax] or null when the line is infinite (no filter).

export function getPerpWorldRange(axisIdx, perpIdx) {
    if (R.extentPercent === null) return null;
    const gcEl = getGraphCanvasEl();
    if (!gcEl || !R.lastLocal) return null;
    const rect = gcEl.getBoundingClientRect();
    const viewportExtent = axisIdx === 0 ? rect.height : rect.width;
    const segLen = (viewportExtent * R.extentPercent) / 100;
    const perpCenterLocal = perpIdx === 0 ? R.lastLocal.x : R.lastLocal.y;
    const startLocal = perpCenterLocal - segLen / 2;
    const endLocal = perpCenterLocal + segLen / 2;
    const a = screenAxisToWorld(startLocal, perpIdx);
    const b = screenAxisToWorld(endLocal, perpIdx);
    return [Math.min(a, b), Math.max(a, b)];
}

// ---------------------------------------------------------------------------
// Apply ripple to all nodes in the current segment
// ---------------------------------------------------------------------------

export function applyRipple() {
    if (!R.segmentSnapshot || !R.segmentAxis) return;
    const axisIdx = R.segmentAxis === "x" ? 0 : 1;
    const perpIdx = axisIdx === 0 ? 1 : 0;
    const originCoord = axisIdx === 0 ? R.segmentOrigin.x : R.segmentOrigin.y;
    const rawCursorCoord = axisIdx === 0 ? R.lastWorld.x : R.lastWorld.y;
    const trueOriginCoord = axisIdx === 0 ? R.startWorld.x : R.startWorld.y;
    const mode = R.segmentMode;
    const maxDist = settings.maxDistance;
    const inclusion = settings.nodeInclusionMode;
    const flipped = settings.reversePullFlipped;

    const perpRange = getPerpWorldRange(axisIdx, perpIdx);

    // For a segment that starts right as the tool re-engages after the safe
    // zone, `segmentOrigin` is the true origin (unshifted, so the ripple
    // threshold stays exactly where the origin marker is drawn) - but that
    // means the raw distance already includes the safe-zone radius the
    // moment you cross out of it. Subtracting it back out of the magnitude
    // (never the sign) keeps the transition jump-free without moving the
    // threshold itself. For a segment started by a mid-drag mode/axis
    // switch, `segmentSafeRadius` is 0, so this is a no-op there.
    const rawDelta = rawCursorCoord - originCoord;
    const dir = Math.sign(rawDelta);
    const delta = dir * Math.max(0, Math.abs(rawDelta) - R.segmentSafeRadius);
    const cursorCoord = originCoord + delta;

	let i = 0
    for (const [node, seg] of R.segmentSnapshot) {
        if (!node || !node.pos) continue;
        const c = axisIdx === 0 ? seg.x : seg.y;
        const w = node.size ? node.size[axisIdx] : 0;
        const nodeMin = c;
        const nodeMax = c + w;

        const perpC = perpIdx === 0 ? seg.x : seg.y;
        const perpH = node.size ? node.size[perpIdx] : 0;
        const inPerp = !perpRange || (perpC + perpH > perpRange[0] && perpC < perpRange[1]);

        let shiftedCoord = c;
        if (inPerp) {
            const distFromTrueOrigin = Math.abs(c - trueOriginCoord);
            if (maxDist === -1 || distFromTrueOrigin <= maxDist) {
                if (mode === RIPPLE_MODE.PUSHER) {
                    shiftedCoord = c + computePusherShift(nodeMin, nodeMax, originCoord, cursorCoord);
                } else if (mode === RIPPLE_MODE.INSERT) {
                    shiftedCoord = c + computeInsertShift(nodeMin, nodeMax, originCoord, dir, delta, inclusion);
                } else if (mode === RIPPLE_MODE.REVERSE) {
                    shiftedCoord = c + computeReverseShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir, delta, inclusion, flipped);
                }
            }
        }

        const finalCoord = snapValue(shiftedCoord);
        if (axisIdx === 0) {
			if (i == 0) { console.log(`${node.pos[0]} ${finalCoord}`) }
            node.pos[0] = finalCoord;
            node.pos[1] = seg.y;
        } else {
            node.pos[0] = seg.x;
            node.pos[1] = finalCoord;
        }
		i++
    }

    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
}

export function restoreTrueOriginalPositions() {
	console.log("restoreTrueOriginalPositions")
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
// Per-frame orchestration: safe zone, segment (re)commit, apply, redraw
// ---------------------------------------------------------------------------

export function tick(e) {
    if (!R.isDragging) return;

    if (e && typeof e.offsetX === "number") {
        R.lastLocal = { x: e.offsetX, y: e.offsetY };
        R.lastWorld = canvasLocalToWorld(e.offsetX, e.offsetY);
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
        liveAxis = dominant();
        R.engagedAxis = liveAxis;
    } else if (R.engagedAxis !== null) {
        liveAxis = R.engagedAxis; // frozen orientation while back inside the safe zone
    } else {
        liveAxis = dominant(); // never engaged yet - provisional, display-only
    }

    const mode = currentModeFromEvent(e);

    if (inSafeZone) {
        restoreTrueOriginalPositions();
        // Arm a clean slate so the next engagement starts with zero jump.
        R.segmentSnapshot = null;
        R.segmentOrigin = null;
        R.segmentAxis = null;
        R.segmentMode = null;
        R.captured = null;
    } else {
        // `segmentSnapshot` is only ever null here right as the tool
        // (re)engages after being in the safe zone (including the very
        // first engagement of the drag) - every other reset path (mode or
        // axis switch, below) replaces it with a fresh Map in the same tick.
        const reengagingFromSafeZone = !R.segmentSnapshot;
        const needNewSegment = reengagingFromSafeZone || R.segmentAxis !== liveAxis || R.segmentMode !== mode;
        if (needNewSegment) {
            R.segmentSnapshot = snapshotCurrentPositions();
            if (reengagingFromSafeZone) {
                // Anchor at the TRUE origin so the ripple threshold matches
                // the origin marker exactly; continuity across the safe-zone
                // boundary is instead handled inside applyRipple() by
                // discounting the safe-zone radius from the shift magnitude.
                R.segmentOrigin = { x: R.startWorld.x, y: R.startWorld.y };
                R.segmentSafeRadius = Math.max(0, settings.safeZoneRadius);
            } else {
                // Mid-drag mode/axis switch: anchor at the current cursor so
                // movement continues from wherever the nodes already are,
                // with zero jump (no safe-zone discount needed here).
                R.segmentOrigin = { x: R.lastWorld.x, y: R.lastWorld.y };
                R.segmentSafeRadius = 0;
            }
            R.segmentAxis = liveAxis;
            R.segmentMode = mode;
            R.captured = new Set();
        }
        applyRipple();
    }

    R.displayAxis = liveAxis;
    R.displayMode = mode;
    R.displayInSafeZone = inSafeZone;

    redrawOverlays();
}
