/**
 * Drag lifecycle (start/end/cancel/wheel) and all DOM listener wiring.
 *
 * Listeners are attached at the `window` level (capture phase) rather than
 * scoped to the LiteGraph <canvas> element. Under Nodes 2.0, nodes render
 * as separate DOM elements overlaid on the canvas, so a right-click landing
 * on a node would never reach a canvas-scoped listener at all - it's a
 * sibling element, not a descendant. Window-level capture fires regardless
 * of which specific element is under the cursor; `isPointInGraphCanvas`
 * keeps it scoped to the graph area so it doesn't fire over the sidebar/
 * topbar/etc, the same way element-scoping used to.
 */

import { app } from "../../../scripts/app.js";
import { settings } from "./ripple_settings.js";
import { getGraphCanvasEl, isPointInGraphCanvas, clientToCanvasLocal, canvasLocalToWorld } from "./ripple_coords.js";
import { ensureOverlays, resizeOverlays, clearOverlays } from "./ripple_overlay.js";
import { R, resetDragState, snapshotCurrentPositions, getRememberedExtentPx, setRememberedExtentPx, getInfiniteSource, setInfiniteSource } from "./ripple_state.js";
import { tick, restoreTrueOriginalPositions } from "./ripple_engine.js";
import { redrawOverlays } from "./ripple_draw.js";

// ---------------------------------------------------------------------------
// Drag lifecycle
// ---------------------------------------------------------------------------

function startDrag(e) {
    ensureOverlays();
    resizeOverlays();

    const localPoint = clientToCanvasLocal(e.clientX, e.clientY);
    const world = canvasLocalToWorld(localPoint.x, localPoint.y);

    resetDragState();
    R.isDragging = true;
    R.startWorld = world;
    R.lastWorld = world;
    R.lastLocal = localPoint;
    R.trueOriginalPositions = snapshotCurrentPositions();

    // A fresh drag always starts "as if" the (possibly still-infinite) line
    // was approached from the wheel-up side.
    if (getRememberedExtentPx() === null) setInfiniteSource("up");

    tick(e);
}

function endDrag() {
    if (!R.isDragging) return;
    resetDragState();
    clearOverlays();
    if (app.canvas && typeof app.canvas.setDirty === "function") {
        app.canvas.setDirty(true, true);
    }
    try {
        if (app.graph && typeof app.graph.change === "function") app.graph.change();
    } catch (err) {
        /* best-effort undo integration only */
    }
}

function cancelDrag() {
    if (!R.isDragging) return;
    restoreTrueOriginalPositions();
    resetDragState();
    clearOverlays();
}

/**
 * The remembered line length is absolute pixels, persisted across drags and
 * across mode/orientation changes - only a wheel event ever changes it.
 *
 * There are two distinct "infinite" states depending on which direction you
 * arrived from: "up" (grew past 100% + 5 steps) and "down" (shrank below one
 * step). Scrolling *further the same way* while infinite is a no-op - it
 * doesn't jump anywhere. Scrolling the *other* way re-enters finite
 * territory landing one step inside whichever boundary you were at, rather
 * than always resetting to a fixed 80%/20%.
 */
function handleWheel(e) {
    if (!R.isDragging || !R.displayAxis) return;
    e.preventDefault();
    e.stopPropagation();

    const gcEl = getGraphCanvasEl();
    if (!gcEl) return;
    const rect = gcEl.getBoundingClientRect();
    const viewportExtent = R.displayAxis === "x" ? rect.height : rect.width;
    const step = Math.max(1, settings.scrollStepPercent);
    const upperThreshold = 100 + 5 * step;
    const shrinking = e.deltaY > 0; // "scroll down" = shrink; "scroll up" = grow

    const current = getRememberedExtentPx();
    const toPx = (percent) => (viewportExtent * percent) / 100;

    if (current === null) {
        const source = getInfiniteSource();
        if (source === "up") {
            if (!shrinking) return; // further growth while already infinite-from-up: no-op
            setRememberedExtentPx(toPx(upperThreshold - step));
        } else {
            if (shrinking) return; // further shrinkage while already infinite-from-down: no-op
            setRememberedExtentPx(toPx(step * 2));
        }
    } else {
        const currentPercent = (current / viewportExtent) * 100;
        const nextPercent = currentPercent + (shrinking ? -step : step);
        if (nextPercent < step) {
            setRememberedExtentPx(null);
            setInfiniteSource("down");
        } else if (nextPercent > upperThreshold) {
            setRememberedExtentPx(null);
            setInfiniteSource("up");
        } else {
            setRememberedExtentPx(toPx(Math.round(nextPercent / step) * step));
        }
    }
    tick(e);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

let attached = false;

export function attachGlobalPointerListeners() {
    if (attached) return true;
    attached = true;

    window.addEventListener(
        "pointerdown",
        (e) => {
            if (!settings.enabled) return;
            if (e.button !== 2 || !e.ctrlKey) return;
            if (!isPointInGraphCanvas(e.clientX, e.clientY)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            startDrag(e);
        },
        { capture: true }
    );

    window.addEventListener(
        "pointermove",
        (e) => {
            if (!R.isDragging) return;
            if ((e.buttons & 2) === 0) {
                endDrag();
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            tick(e);
        },
        { capture: true }
    );

    window.addEventListener(
        "pointerup",
        (e) => {
            if (!R.isDragging) return;
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            endDrag();
        },
        { capture: true }
    );

    window.addEventListener("wheel", handleWheel, { capture: true, passive: false });

    return true;
}

// Right-click-drag can easily end with the cursor outside the graph canvas
// element (e.g. over the sidebar), in which case the browser fires
// 'contextmenu' on whatever element is actually under the cursor at
// mouseup - not necessarily the canvas. A window-level, capture-phase
// listener catches it regardless of target. Plain right-click (no Ctrl, and
// not mid-drag) is left completely alone.
export function attachGlobalContextMenuSuppression() {
    window.addEventListener(
        "contextmenu",
        (e) => {
            if (R.isDragging || e.ctrlKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        },
        { capture: true }
    );
}

export function attachGlobalSafetyListeners() {
    window.addEventListener("keydown", (e) => {
        if (!R.isDragging) return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelDrag();
            return;
        }
        if (e.key === "Shift" || e.key === "Alt") {
            tick(e);
        }
    });
    window.addEventListener("keyup", (e) => {
        if (!R.isDragging) return;
        if (e.key === "Shift" || e.key === "Alt") {
            tick(e);
        }
    });
    window.addEventListener("blur", () => {
        if (R.isDragging) endDrag();
    });
    window.addEventListener("resize", () => {
        if (R.isDragging) redrawOverlays();
    });
}

export function attachResizeObserver() {
    const gcEl = getGraphCanvasEl();
    if (!gcEl || typeof ResizeObserver === "undefined") return false;
    const ro = new ResizeObserver(() => {
        if (R.isDragging) redrawOverlays();
    });
    ro.observe(gcEl);
    return true;
}
