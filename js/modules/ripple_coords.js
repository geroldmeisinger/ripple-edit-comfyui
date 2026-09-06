/**
 * World (graph-space) <-> canvas-local <-> screen coordinate helpers.
 */

import { app } from "../../../scripts/app.js";

export function getGraphCanvasEl() {
    return app.canvas && app.canvas.canvas;
}

// `getBoundingClientRect()` can force a synchronous layout reflow. Several
// places need the graph canvas's rect within the same animation frame
// (position conversion, the perpendicular line-length filter, resizing the
// overlay canvases) - caching it for the duration of one frame avoids
// paying for that reflow multiple times per frame. `invalidateCanvasRectCache`
// is called once at the start of every `tick()` (see ripple_engine.js) so
// the cache never goes stale beyond a single frame, and also on resize.
let cachedRect = null;

export function getCachedGraphCanvasRect() {
    if (cachedRect) return cachedRect;
    const gcEl = getGraphCanvasEl();
    if (!gcEl) return null;
    cachedRect = gcEl.getBoundingClientRect();
    return cachedRect;
}

export function invalidateCanvasRectCache() {
    cachedRect = null;
}

/** World (graph-space) -> canvas-local CSS-pixel coordinates. */
export function worldToCanvasLocal(wx, wy) {
    const p = app.canvas.ds.convertOffsetToCanvas([wx, wy]);
    return { x: p[0], y: p[1] };
}

/** Canvas-local CSS-pixel coordinates -> world (graph-space) coordinates. */
export function canvasLocalToWorld(cx, cy) {
    const p = app.canvas.ds.convertCanvasToOffset([cx, cy]);
    return { x: p[0], y: p[1] };
}

/**
 * Viewport (`clientX`/`clientY`) -> canvas-local CSS-pixel coordinates.
 * Needed because our pointer listeners are attached at the window level
 * (so they still fire when the cursor is over a Vue-rendered node overlay
 * rather than the LiteGraph <canvas> element itself) - `event.offsetX/Y`
 * would be relative to whatever element the event actually targeted, which
 * is no longer reliably the graph canvas.
 */
export function clientToCanvasLocal(clientX, clientY) {
    const rect = getCachedGraphCanvasRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
}

/** Is the given viewport point within the graph canvas's own bounding box? */
export function isPointInGraphCanvas(clientX, clientY) {
    const r = getCachedGraphCanvasRect();
    if (!r) return false;
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

export function getScale() {
    return (app.canvas && app.canvas.ds && app.canvas.ds.scale) || 1;
}

/** Single-axis canvas-local CSS px -> world, without needing the other coordinate. */
export function screenAxisToWorld(value, axisIdx) {
    const scale = getScale();
    const offset = app.canvas.ds.offset;
    return value / scale - offset[axisIdx];
}
