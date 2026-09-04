/**
 * All overlay drawing: origin/safe-zone marker, ripple line + fill rectangle
 * (edge-aligned so nothing is drawn past the cursor), the push/pull/align
 * mode icon, the distance indicator, and the two label types (distance-moved
 * and off-screen overflow).
 *
 * Visual positioning (the line, rectangle, and icon) always tracks the raw
 * cursor position - never the safe-zone-discounted "effective" position
 * used for actually computing node shifts. Using the discounted position
 * for visuals made the line/icon visibly lag behind the cursor by
 * `safeZoneRadius` pixels and feel "stuck". The *numbers* shown (the
 * distance label) still use the discounted amount, since that's the actual
 * effect size - only the drawing position is raw.
 */

import { COLORS, RIPPLE_MODE } from "./ripple_constants.js";
import { settings, isAlwaysSnapEnabled, getGridSize } from "./ripple_settings.js";
import { getScale, worldToCanvasLocal } from "./ripple_coords.js";
import { R, getRememberedExtentPx } from "./ripple_state.js";
import { ensureOverlays, resizeOverlays, clearOverlays, overlayCtx, labelCtx } from "./ripple_overlay.js";

function paletteFor(mode) {
    if (mode === RIPPLE_MODE.PULLER) return { line: settings.pullerLineColor, fill: settings.pullerFillColor };
    if (mode === RIPPLE_MODE.ALIGNER) return { line: settings.alignerLineColor, fill: settings.alignerFillColor };
    return { line: settings.pusherLineColor, fill: settings.pusherFillColor };
}

function drawOriginMarker(ctx, originLocal, mode) {
    const radiusWorld = Math.max(0, settings.safeZoneRadius);
    const radiusPx = radiusWorld * getScale();
    const color = paletteFor(mode).line;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    if (radiusWorld <= 0) {
        const s = 7;
        ctx.beginPath();
        ctx.moveTo(originLocal.x - s, originLocal.y);
        ctx.lineTo(originLocal.x + s, originLocal.y);
        ctx.moveTo(originLocal.x, originLocal.y - s);
        ctx.lineTo(originLocal.x, originLocal.y + s);
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.arc(originLocal.x, originLocal.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(originLocal.x, originLocal.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * Draws the ripple line as a filled, edge-aligned rectangle: the forward
 * edge (in the direction of travel) sits exactly at `cursorLocal`, and the
 * full thickness extends backward from there - nothing is ever drawn past
 * the cursor. Also draws the fill rectangle between the origin and the line
 * (skipped for the aligner, which has no "space" concept). An infinite line
 * is drawn at double the viewport dimension, centered on the cursor, so it
 * always reaches both edges regardless of where the cursor currently is.
 * Returns segment info used for the overflow label.
 */
function drawRippleVisuals(ctx, rect, palette, mode, axisIsX, dir, originLocal, cursorLocal) {
    const viewportExtent = axisIsX ? rect.height : rect.width;
    const perpCenter = axisIsX ? cursorLocal.y : cursorLocal.x;

    const extentPx = getRememberedExtentPx();
    const segLen = extentPx === null ? viewportExtent * 2 : extentPx;
    const segStart = perpCenter - segLen / 2;
    const segEnd = perpCenter + segLen / 2;
    const clippedStart = Math.max(0, segStart);
    const clippedEnd = Math.min(viewportExtent, segEnd);

    if (mode !== RIPPLE_MODE.ALIGNER) {
        const along0 = Math.min(originLocal[axisIsX ? "x" : "y"], cursorLocal[axisIsX ? "x" : "y"]);
        const along1 = Math.max(originLocal[axisIsX ? "x" : "y"], cursorLocal[axisIsX ? "x" : "y"]);
        ctx.save();
        ctx.fillStyle = palette.fill;
        if (axisIsX) ctx.fillRect(along0, clippedStart, along1 - along0, clippedEnd - clippedStart);
        else ctx.fillRect(clippedStart, along0, clippedEnd - clippedStart, along1 - along0);
        ctx.restore();
    }

    const lw = Math.max(1, settings.lineWidth);
    ctx.save();
    ctx.fillStyle = palette.line;
    if (axisIsX) {
        const x0 = dir >= 0 ? cursorLocal.x - lw : cursorLocal.x;
        ctx.fillRect(x0, clippedStart, lw, clippedEnd - clippedStart);
    } else {
        const y0 = dir >= 0 ? cursorLocal.y - lw : cursorLocal.y;
        ctx.fillRect(clippedStart, y0, clippedEnd - clippedStart, lw);
    }
    ctx.restore();

    return {
        isInfinite: extentPx === null,
        viewportExtent,
        segStart,
        segEnd,
        overflowStart: Math.max(0, -segStart),
        overflowEnd: Math.max(0, segEnd - viewportExtent),
    };
}

/**
 * The mode icon: a triangle (tip at the line) for pusher/puller, or three
 * short bars sharing a common base edge (an "align to base" glyph) for the
 * aligner. Nothing is drawn past `tipLocal` - the tip/base edge sits
 * exactly there, and the shape extends backward from it.
 */
function drawModeIcon(ctx, mode, axisIsX, dir, tipLocal, color) {
    const d = dir === 0 ? 1 : dir;
    ctx.save();
    ctx.fillStyle = color;

    if (mode === RIPPLE_MODE.ALIGNER) {
        const lengths = [7, 13, 10];
        const thickness = 3;
        const gap = 2;
        const spanIdx = [-1, 0, 1];
        for (let i = 0; i < 3; i++) {
            const len = lengths[i];
            const offset = spanIdx[i] * (thickness + gap);
            if (axisIsX) {
                const x0 = d >= 0 ? tipLocal.x - len : tipLocal.x;
                ctx.fillRect(x0, tipLocal.y + offset - thickness / 2, len, thickness);
            } else {
                const y0 = d >= 0 ? tipLocal.y - len : tipLocal.y;
                ctx.fillRect(tipLocal.x + offset - thickness / 2, y0, thickness, len);
            }
        }
    } else {
        const len = 14;
        const halfWidth = 6;
        ctx.beginPath();
        if (axisIsX) {
            ctx.moveTo(tipLocal.x, tipLocal.y);
            ctx.lineTo(tipLocal.x - d * len, tipLocal.y - halfWidth);
            ctx.lineTo(tipLocal.x - d * len, tipLocal.y + halfWidth);
        } else {
            ctx.moveTo(tipLocal.x, tipLocal.y);
            ctx.lineTo(tipLocal.x - halfWidth, tipLocal.y - d * len);
            ctx.lineTo(tipLocal.x + halfWidth, tipLocal.y - d * len);
        }
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

/**
 * The "distance from origin" indicator: it starts at (and moves with) the
 * cursor, runs along the drag axis at the cursor's own perpendicular
 * position, and then - since that's generally not the safe-zone circle's
 * own row/column - a short *orthogonal* segment closes the gap to the
 * actual tip of the safe-zone circle. Drawn as one dashed polyline:
 * circle-edge -> elbow point -> cursor.
 */
function drawDistanceIndicator(ctx, axisIsX, circleEdgeLocal, cursorLocal) {
    const elbow = axisIsX ? { x: circleEdgeLocal.x, y: cursorLocal.y } : { x: cursorLocal.x, y: circleEdgeLocal.y };
    ctx.save();
    ctx.strokeStyle = COLORS.helperLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(circleEdgeLocal.x, circleEdgeLocal.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(cursorLocal.x, cursorLocal.y);
    ctx.stroke();
    ctx.restore();
}

function drawLabel(ctx, text, x, y, align) {
    ctx.save();
    ctx.font = "11px monospace";
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    const w = ctx.measureText(text).width + 8;
    const bx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.fillStyle = COLORS.labelBg;
    ctx.fillRect(bx, y - 8, w, 16);
    ctx.fillStyle = COLORS.labelText;
    ctx.fillText(text, x, y);
    ctx.restore();
}

/** "+  25px" - sign, then the number right-padded to 4 chars with spaces, then unit. */
function formatDistance(sign, value, unit) {
    return `${sign}${String(value).padStart(4, " ")}${unit}`;
}

export function redrawOverlays() {
    ensureOverlays();
    const rect = resizeOverlays();
    clearOverlays();
    if (settings.hideVisuals) return;
    if (!R.isDragging || !R.startWorld || !R.lastWorld || !rect) return;

    const axis = R.displayAxis;
    const mode = R.displayMode;
    const inSafeZone = R.displayInSafeZone;

    const originLocal = worldToCanvasLocal(R.startWorld.x, R.startWorld.y);
    drawOriginMarker(overlayCtx, originLocal, mode);
    if (axis === null) return;

    const axisIsX = axis === "x";
    const dir = R.displayDir;
    const cursorLocal = R.lastLocal || worldToCanvasLocal(R.lastWorld.x, R.lastWorld.y);
    const palette = paletteFor(mode);
    const drawColor = inSafeZone ? COLORS.disengaged.line : palette.line;
    const drawPalette = inSafeZone ? COLORS.disengaged : palette;

    // Before ever engaging (leaving the safe zone) at least once this drag,
    // we don't know the eventual orientation/effect yet, so only the icon
    // is shown - no line, no rectangle, no distance info. Once engaged at
    // least once, returning to the safe zone shows the line again, greyed.
    const neverEngagedYet = inSafeZone && R.engagedAxis === null;

    drawModeIcon(overlayCtx, mode, axisIsX, dir, cursorLocal, drawColor);
    if (neverEngagedYet) return;

    const segInfo = drawRippleVisuals(overlayCtx, rect, drawPalette, mode, axisIsX, dir, originLocal, cursorLocal);

    const toLabelSpace = (localX, localY) => ({ x: rect.left + localX, y: rect.top + localY });

    // Off-screen overflow labels - shown for every mode, including the
    // aligner. Only meaningful once you've scrolled to a finite length;
    // an infinite line shows the infinity symbol instead of a huge number.
    if (segInfo.overflowStart > 0 || segInfo.overflowEnd > 0) {
        const overflowText = (px) => (segInfo.isInfinite ? "\u221E" : `+${Math.round(px)}px`);
        if (axisIsX) {
            if (segInfo.overflowStart > 0) {
                const p = toLabelSpace(cursorLocal.x + 8, 14);
                drawLabel(labelCtx, overflowText(segInfo.overflowStart), p.x, p.y, "left");
            }
            if (segInfo.overflowEnd > 0) {
                const p = toLabelSpace(cursorLocal.x + 8, rect.height - 14);
                drawLabel(labelCtx, overflowText(segInfo.overflowEnd), p.x, p.y, "left");
            }
        } else {
            if (segInfo.overflowStart > 0) {
                const p = toLabelSpace(14, cursorLocal.y - 10);
                drawLabel(labelCtx, overflowText(segInfo.overflowStart), p.x, p.y, "left");
            }
            if (segInfo.overflowEnd > 0) {
                const p = toLabelSpace(rect.width - 14, cursorLocal.y - 10);
                drawLabel(labelCtx, overflowText(segInfo.overflowEnd), p.x, p.y, "right");
            }
        }
    }

    // Bug fix: the aligner is a direct physical interaction with the line's
    // absolute position - "distance from origin" isn't a meaningful concept
    // for it, so no distance indicator/label is drawn for that mode.
    if (mode === RIPPLE_MODE.ALIGNER) return;

    const circleEdgeWorld = axisIsX
        ? { x: R.startWorld.x + Math.max(0, settings.safeZoneRadius) * (dir || 1), y: R.startWorld.y }
        : { x: R.startWorld.x, y: R.startWorld.y + Math.max(0, settings.safeZoneRadius) * (dir || 1) };
    const circleEdgeLocal = worldToCanvasLocal(circleEdgeWorld.x, circleEdgeWorld.y);

    drawDistanceIndicator(overlayCtx, axisIsX, circleEdgeLocal, cursorLocal);

    const distWorld = Math.abs(R.displayDelta);
    const sign = mode === RIPPLE_MODE.PULLER ? "-" : "+";
    let distText;
    if (isAlwaysSnapEnabled()) {
        const g = getGridSize();
        const steps = g ? Math.round(distWorld / g) : 0;
        distText = formatDistance(sign, steps, "x");
    } else {
        distText = formatDistance(sign, Math.round(distWorld), "px");
    }
    // Anchored behind the icon (opposite the direction of travel).
    const iconClearance = 22;
    const labelLocal = axisIsX
        ? { x: cursorLocal.x - (dir || 1) * iconClearance, y: cursorLocal.y - 14 }
        : { x: cursorLocal.x + 14, y: cursorLocal.y - (dir || 1) * iconClearance };
    const labelPos = toLabelSpace(labelLocal.x, labelLocal.y);
    drawLabel(labelCtx, distText, labelPos.x, labelPos.y, "center");
}
