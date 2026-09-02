/**
 * Drag lifecycle (start/end/cancel/wheel) and all DOM listener wiring.
 */

import { app } from "../../../scripts/app.js";
import { settings } from "./ripple_settings.js";
import { getGraphCanvasEl, canvasLocalToWorld } from "./ripple_coords.js";
import { ensureOverlays, resizeOverlays, clearOverlays } from "./ripple_overlay.js";
import { R, resetDragState, snapshotCurrentPositions } from "./ripple_state.js";
import { tick, restoreTrueOriginalPositions } from "./ripple_engine.js";
import { redrawOverlays } from "./ripple_draw.js";

// ---------------------------------------------------------------------------
// Drag lifecycle
// ---------------------------------------------------------------------------

function startDrag(e) {
    ensureOverlays();
    resizeOverlays();

    const localPoint = { x: e.offsetX, y: e.offsetY };
    const world = canvasLocalToWorld(localPoint.x, localPoint.y);

    resetDragState();
    R.isDragging = true;
    R.startWorld = world;
    R.lastWorld = world;
    R.lastLocal = localPoint;
    R.trueOriginalPositions = snapshotCurrentPositions();

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

function handleWheel(e) {
    if (!R.isDragging || !R.displayAxis) return;
    e.preventDefault();
    e.stopPropagation();

    const step = Math.max(1, settings.scrollStepPercent);
    if (!R.hasScrolled) {
        R.hasScrolled = true;
        R.extentPercent = e.deltaY > 0 ? 80 : 20;
    } else {
        const base = R.extentPercent === null ? 100 : R.extentPercent;
        R.extentPercent = Math.min(100, Math.max(3, base + (e.deltaY > 0 ? -step : step)));
    }
    tick(e);
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

export function attachCanvasListeners() {
    const gcEl = getGraphCanvasEl();
    if (!gcEl) return false;
    if (gcEl.__rippleEditAttached) return true;
    gcEl.__rippleEditAttached = true;

    gcEl.addEventListener(
        "pointerdown",
        (e) => {
            if (!settings.enabled) return;
            if (e.button === 2 && e.ctrlKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                startDrag(e);
            }
        },
        { capture: true }
    );

    gcEl.addEventListener(
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

    gcEl.addEventListener(
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

    gcEl.addEventListener("wheel", handleWheel, { capture: true, passive: false });

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
    if (!gcEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
        if (R.isDragging) redrawOverlays();
    });
    ro.observe(gcEl);
}
