/**
 * Pure(ish) per-node shift computation for the three ripple modes. The only
 * bit of shared state touched here is `R.captured` (the sticky pull/align
 * set), which is intentionally part of this module's contract - it's what
 * makes both the puller and the aligner "stick" once a node has been
 * touched, instead of re-testing eligibility from scratch every frame.
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

/** PUSHER (insert space): push nodes on the drag-direction side of the origin. */
export function computePushShift(nodeMin, nodeMax, originCoord, dir, delta, inclusion) {
    if (dir === 0) return 0;
    const onDirSide = edgeIncluded((x) => (x - originCoord) * dir >= 0, nodeMin, nodeMax, inclusion);
    return onDirSide ? delta : 0;
}

/**
 * PULLER (remove space): collapse the [origin, cursor] region and pull the
 * far side in to close the gap. Nodes are "captured" into the sticky pull
 * set the first time they qualify; once captured they keep being pulled
 * using the continuous `-delta` formula even if the growing region would
 * otherwise reclassify them - this is what prevents the "snaps back to
 * original position" glitch. There is deliberately no clamp on how far a
 * node can be pulled - it can be pulled straight through and past the
 * origin with no limit. `R.captured` is reset whenever axis or mode changes
 * (see ripple_engine.js).
 */
export function computePullShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir, delta, inclusion) {
    if (dir === 0) return 0;

    const lo = Math.min(originCoord, cursorCoord);
    const hi = Math.max(originCoord, cursorCoord);
    const insideRegion = edgeIncluded((x) => x >= lo && x <= hi, nodeMin, nodeMax, inclusion);
    if (insideRegion && !R.captured.has(node)) return 0;

    const eligible = R.captured.has(node) || edgeIncluded((x) => (x - originCoord) * dir >= 0, nodeMin, nodeMax, inclusion);
    if (!eligible) return 0;
    R.captured.add(node);

    return -delta;
}

/**
 * ALIGNER (physical sweep, testing): once the sweeping line touches a node,
 * that node sticks to it - flush against the line's current position - for
 * the rest of this (axis, mode) run, so pulling the line back also pulls
 * the node back with it. It can only ever be pulled back as far as its own
 * original position, though: once the line retreats past where the node
 * started, the node just sits there again (released) rather than being
 * dragged along past its own start.
 */
export function computeAlignerShift(node, nodeMin, nodeMax, originCoord, cursorCoord, dir) {
    if (dir === 0) return 0;

    const sweptLo = Math.min(originCoord, cursorCoord);
    const sweptHi = Math.max(originCoord, cursorCoord);
    const overlapsNow = nodeMax > sweptLo && nodeMin < sweptHi;
    const eligible = R.captured.has(node) || overlapsNow;
    if (!eligible) return 0;
    R.captured.add(node);

    const cRef = dir > 0 ? nodeMin : nodeMax; // the edge that stays flush with the line
    let newRef = dir > 0 ? Math.max(cursorCoord, cRef) : Math.min(cursorCoord, cRef);
    return newRef - cRef;
}
