/**
 * World (graph-space) <-> canvas-local <-> screen coordinate helpers.
 */

import { app } from "../../../scripts/app.js";

export function getGraphCanvasEl() {
    return app.canvas && app.canvas.canvas;
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

export function getScale() {
    return (app.canvas && app.canvas.ds && app.canvas.ds.scale) || 1;
}

/** Single-axis canvas-local CSS px -> world, without needing the other coordinate. */
export function screenAxisToWorld(value, axisIdx) {
    const scale = getScale();
    const offset = app.canvas.ds.offset;
    return value / scale - offset[axisIdx];
}
