/**
 * The two overlay canvases:
 *  - `overlayEl`: sized to exactly match the graph canvas element's bounding
 *    rect every frame. The ripple line, fill rectangle, origin marker and
 *    orthogonal distance line all live here, so they're automatically
 *    confined to the workspace area (never drawn over the topbar / sidebar /
 *    console, which are separate DOM elements outside that rect).
 *  - `labelEl`: a full-viewport, unclipped layer for text labels only (the
 *    distance-moved readout and the off-screen-overflow readout). These are
 *    explicitly allowed to render on top of other UI so they stay legible
 *    even near/behind panels.
 * Both are pointer-events:none so neither ever intercepts a click.
 */

import { getGraphCanvasEl } from "./ripple_coords.js";

export let overlayEl = null;
export let overlayCtx = null;
export let labelEl = null;
export let labelCtx = null;

export function ensureOverlays() {
    if (!overlayEl || !document.body.contains(overlayEl)) {
        overlayEl = document.createElement("canvas");
        overlayEl.id = "ripple-edit-overlay";
        Object.assign(overlayEl.style, {
            position: "fixed",
            left: "0px",
            top: "0px",
            width: "0px",
            height: "0px",
            pointerEvents: "none",
            zIndex: "5",
        });
        document.body.appendChild(overlayEl);
        overlayCtx = overlayEl.getContext("2d");
    }
    if (!labelEl || !document.body.contains(labelEl)) {
        labelEl = document.createElement("canvas");
        labelEl.id = "ripple-edit-labels";
        Object.assign(labelEl.style, {
            position: "fixed",
            left: "0px",
            top: "0px",
            width: `${window.innerWidth}px`,
            height: `${window.innerHeight}px`,
            pointerEvents: "none",
            zIndex: "99999", // deliberately above everything, incl. panels
        });
        document.body.appendChild(labelEl);
        labelCtx = labelEl.getContext("2d");
    }
}

export function resizeOverlays() {
    const gcEl = getGraphCanvasEl();
    if (!gcEl) return null;
    const rect = gcEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    overlayEl.style.left = `${rect.left}px`;
    overlayEl.style.top = `${rect.top}px`;
    overlayEl.style.width = `${rect.width}px`;
    overlayEl.style.height = `${rect.height}px`;
    const pxW = Math.max(1, Math.round(rect.width * dpr));
    const pxH = Math.max(1, Math.round(rect.height * dpr));
    if (overlayEl.width !== pxW || overlayEl.height !== pxH) {
        overlayEl.width = pxW;
        overlayEl.height = pxH;
    }
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    labelEl.style.width = `${vw}px`;
    labelEl.style.height = `${vh}px`;
    const lpxW = Math.max(1, Math.round(vw * dpr));
    const lpxH = Math.max(1, Math.round(vh * dpr));
    if (labelEl.width !== lpxW || labelEl.height !== lpxH) {
        labelEl.width = lpxW;
        labelEl.height = lpxH;
    }
    labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return rect;
}

export function clearOverlays() {
    if (overlayCtx && overlayEl) {
        overlayCtx.save();
        overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
        overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
        overlayCtx.restore();
    }
    if (labelCtx && labelEl) {
        labelCtx.save();
        labelCtx.setTransform(1, 0, 0, 1, 0, 0);
        labelCtx.clearRect(0, 0, labelEl.width, labelEl.height);
        labelCtx.restore();
    }
}
