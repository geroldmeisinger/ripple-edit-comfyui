/**
 * All overlay drawing: origin/safe-zone marker, ripple line + fill rectangle
 * (edge-aligned so nothing is drawn past the cursor), the push/pull/align
 * mode icon, the orthogonal distance line, and the two label types
 * (distance-moved and off-screen overflow).
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

function drawOriginMarker(ctx, originLocal, mode, inSafeZone) {
    const radiusWorld = Math.max(0, settings.safeZoneRadius);
    const radiusPx = radiusWorld * getScale();
    const color = inSafeZone ? paletteFor(mode).line : paletteFor(mode).line;
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
 * edge (in the direction of travel) sits exactly at `lineLocal`, and the
 * full thickness extends backward from there - nothing is ever drawn past
 * the line's actual position. Also draws the fill rectangle between the
 * origin and the line (skipped for the aligner, which has no "space"
 * concept). Returns segment info used for the overflow label.
 */
function drawRippleVisuals(ctx, rect, palette, mode, axisIsX, dir, originLocal, lineLocal) {
    const viewportExtent = axisIsX ? rect.height : rect.width;
    const perpCenter = axisIsX ? lineLocal.y : lineLocal.x;

    const extentPx = getRememberedExtentPx();
    const segLen = extentPx === null ? viewportExtent : extentPx;
    const segStart = perpCenter - segLen / 2;
    const segEnd = perpCenter + segLen / 2;
    const clippedStart = Math.max(0, segStart);
    const clippedEnd = Math.min(viewportExtent, segEnd);

    if (mode !== RIPPLE_MODE.ALIGNER) {
        const along0 = Math.min(originLocal[axisIsX ? "x" : "y"], lineLocal[axisIsX ? "x" : "y"]);
        const along1 = Math.max(originLocal[axisIsX ? "x" : "y"], lineLocal[axisIsX ? "x" : "y"]);
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
        const x0 = dir >= 0 ? lineLocal.x - lw : lineLocal.x;
        ctx.fillRect(x0, clippedStart, lw, clippedEnd - clippedStart);
    } else {
        const y0 = dir >= 0 ? lineLocal.y - lw : lineLocal.y;
        ctx.fillRect(clippedStart, y0, clippedEnd - clippedStart, lw);
    }
    ctx.restore();

    return {
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

function drawOrthogonalDistanceLine(ctx, axisIsX, startLocal, endLocal) {
    ctx.save();
    ctx.strokeStyle = COLORS.helperLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    if (axisIsX) {
        ctx.moveTo(startLocal.x, startLocal.y);
        ctx.lineTo(endLocal.x, startLocal.y);
    } else {
        ctx.moveTo(startLocal.x, startLocal.y);
        ctx.lineTo(startLocal.x, endLocal.y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawLabel(ctx, text, x, y, align) {
    ctx.save();
    ctx.font = "11px sans-serif";
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

    drawOriginMarker(overlayCtx, originLocal, mode, inSafeZone);

    const extentPx = getRememberedExtentPx();
    const showLine = axis !== null && (!inSafeZone || extentPx !== null || R.engagedAxis !== null);
    if (!showLine) return;

    const axisIsX = axis === "x";
    const dir = R.displayDir;

    // The visual line sits at the origin plus the (possibly safe-zone
    // discounted) delta - i.e. exactly where the ripple actually takes
    // effect, not necessarily the raw mouse position.
    const originCoordWorld = axisIsX ? R.startWorld.x : R.startWorld.y;
    const lineCoordWorld = originCoordWorld + R.displayDelta;
    const lineWorldPoint = axisIsX ? { x: lineCoordWorld, y: R.lastWorld.y } : { x: R.lastWorld.x, y: lineCoordWorld };
    const lineLocal = worldToCanvasLocal(lineWorldPoint.x, lineWorldPoint.y);

    const palette = paletteFor(mode);
    const drawColor = inSafeZone ? COLORS.disengaged.line : palette.line;
    const drawPalette = inSafeZone ? COLORS.disengaged : palette;

    const segInfo = drawRippleVisuals(overlayCtx, rect, drawPalette, mode, axisIsX, dir, originLocal, lineLocal);
    drawModeIcon(overlayCtx, mode, axisIsX, dir, lineLocal, drawColor);

    // Bug fix: the aligner is a direct physical interaction with the line's
    // absolute position - "distance from origin" isn't a meaningful concept
    // for it, so no distance line/label is drawn for that mode.
    if (mode === RIPPLE_MODE.ALIGNER) return;

    const safeRadiusPx = Math.max(0, settings.safeZoneRadius) * getScale();
    const distStartWorld = axisIsX
        ? { x: R.startWorld.x + Math.max(0, settings.safeZoneRadius) * (dir || 1), y: R.startWorld.y }
        : { x: R.startWorld.x, y: R.startWorld.y + Math.max(0, settings.safeZoneRadius) * (dir || 1) };
    const distStartLocal = worldToCanvasLocal(distStartWorld.x, distStartWorld.y);

    drawOrthogonalDistanceLine(overlayCtx, axisIsX, distStartLocal, lineLocal);

    // --- labels, on the unclipped top layer ---
    const toLabelSpace = (localX, localY) => ({ x: rect.left + localX, y: rect.top + localY });

    const distWorld = Math.abs(R.displayDelta);
    const sign = mode === RIPPLE_MODE.PULLER ? "-" : "+";
    let distText;
    if (isAlwaysSnapEnabled()) {
        const g = getGridSize();
        const steps = g ? Math.round(distWorld / g) : 0;
        distText = `${sign}${steps}x`;
    } else {
        distText = `${sign}${Math.round(distWorld)}px`;
    }
    // Anchored towards the cursor, right before the icon (i.e. behind it,
    // opposite the direction of travel).
    const iconClearance = 20;
    const labelLocal = axisIsX
        ? { x: lineLocal.x - (dir || 1) * iconClearance, y: lineLocal.y - 14 }
        : { x: lineLocal.x + 14, y: lineLocal.y - (dir || 1) * iconClearance };
    const labelPos = toLabelSpace(labelLocal.x, labelLocal.y);
    drawLabel(labelCtx, distText, labelPos.x, labelPos.y, "center");

    // Off-screen overflow labels - only meaningful once the line length is finite.
    if (extentPx !== null) {
        if (axisIsX) {
            if (segInfo.overflowStart > 0) {
                const p = toLabelSpace(lineLocal.x + 8, 14);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowStart)}px`, p.x, p.y, "left");
            }
            if (segInfo.overflowEnd > 0) {
                const p = toLabelSpace(lineLocal.x + 8, rect.height - 14);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowEnd)}px`, p.x, p.y, "left");
            }
        } else {
            if (segInfo.overflowStart > 0) {
                const p = toLabelSpace(14, lineLocal.y - 10);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowStart)}px`, p.x, p.y, "left");
            }
            if (segInfo.overflowEnd > 0) {
                const p = toLabelSpace(rect.width - 14, lineLocal.y - 10);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowEnd)}px`, p.x, p.y, "right");
            }
        }
    }
}
