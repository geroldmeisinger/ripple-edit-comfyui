/**
 * Pure(ish) per-node shift computation for the three ripple modes. The only
 * bit of shared state touched here is `R.captured` (the reverse-mode sticky
 * pull set), which is intentionally part of this module's contract since
 * it's what prevents the "snaps back to original position" glitch.
 */

import { R } from "./ripple_state.js";

/**
 * Combines a point predicate into a span (nodeMin..nodeMax) test according
 * to the "node inclusion mode" setting:
 *   "clear"    -> both ends must satisfy it (node fully on the affected side)
 *   "touching" -> either end satisfies it (any overlap counts)
 *   "center"   -> the node's center point satisfies it
 */
export function edgeIncluded(testFn, nodeMin, nodeMax, inclusion) {
    if (inclusion === "touching") return testFn(nodeMin) || testFn(nodeMax);
    if (inclusion === "center") return testFn((nodeMin + nodeMax) / 2);
    return testFn(nodeMin) && testFn(nodeMax); // "clear" (default)
}

/** INSERT mode: push nodes on the drag-direction side of the origin. */
export function computeInsertShift(nodeMin, nodeMax, originCoord, dir, delta, inclusion) {
    if (dir === 0) return 0;
    const onDirSide = edgeIncluded((x) => (x - originCoord) * dir >= 0, nodeMin, nodeMax, inclusion);
    return onDirSide ? delta : 0;
}

/**
 * REVERSE mode: collapse the [origin, cursor] region and pull the far side
 * in to close the gap. Nodes are "captured" into the sticky pull set the
 * first time they qualify; once captured they keep being pulled using the
 * continuous formula (clamped so they never overshoot past the origin) even
 * if the growing region would otherwise reclassify them - this is what
 * prevents the "snaps back to original position" glitch. `R.captured` is
 * reset whenever a new segment starts (see ripple_engine.js).
 */
export function computeReverseShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir, delta, inclusion, flipped) {
    if (dir === 0) return 0;
    const dirEff = flipped ? -dir : dir;

    if (!flipped) {
        const lo = Math.min(originCoord, cursorCoord);
        const hi = Math.max(originCoord, cursorCoord);
        const insideRegion = edgeIncluded((x) => x >= lo && x <= hi, nodeMin, nodeMax, inclusion);
        if (insideRegion && !R.captured.has(node)) return 0;
    }

    const eligible = R.captured.has(node) || edgeIncluded((x) => (x - originCoord) * dirEff >= 0, nodeMin, nodeMax, inclusion);
    if (!eligible) return 0;
    R.captured.add(node);

    const cRef = dirEff > 0 ? nodeMin : nodeMax;
    const shiftMag = flipped ? delta : -delta;
    let np = cRef + shiftMag;
    np = dirEff > 0 ? Math.max(np, originCoord) : Math.min(np, originCoord);
    return np - cRef;
}

/** PUSHER mode: sweep [origin, cursor] like a rigid stick; shove anything it touches. */
export function computePusherShift(nodeMin, nodeMax, originCoord, cursorCoord) {
    const delta = cursorCoord - originCoord;
    const dir = Math.sign(delta);
    if (dir === 0) return 0;

    const sweptLo = Math.min(originCoord, cursorCoord);
    const sweptHi = Math.max(originCoord, cursorCoord);
    const overlaps = nodeMax > sweptLo && nodeMin < sweptHi;
    if (!overlaps) return 0;

    if (dir > 0) return Math.max(0, cursorCoord - nodeMin);
    return Math.min(0, cursorCoord - nodeMax);
}
