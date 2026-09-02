/**
 * All overlay drawing: origin marker, ripple line + fill rectangle, the
 * orthogonal distance line, and the two label types (distance-moved and
 * off-screen overflow).
 */

import { COLORS, RIPPLE_MODE } from "./ripple_constants.js";
import { settings, isAlwaysSnapEnabled, getGridSize } from "./ripple_settings.js";
import { getScale, worldToCanvasLocal } from "./ripple_coords.js";
import { R } from "./ripple_state.js";
import { ensureOverlays, resizeOverlays, clearOverlays, overlayCtx, labelCtx } from "./ripple_overlay.js";

function paletteFor(inSafeZone, mode) {
    if (inSafeZone) return COLORS.disengaged;
    return COLORS[mode] || COLORS.insert;
}

function drawOriginMarker(ctx, originLocal) {
    const radiusWorld = Math.max(0, settings.safeZoneRadius);
    const radiusPx = radiusWorld * getScale();
    ctx.save();
    ctx.strokeStyle = COLORS.originMarker;
    ctx.fillStyle = COLORS.originMarker;
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

/** Draws the ripple line + fill rectangle. Returns the segment info, used for the overflow label. */
function drawRippleVisuals(ctx, rect, palette, mode, axis, originLocal, cursorLocal) {
    const isVertical = axis === "x"; // shifting X positions -> vertical line
    const viewportExtent = isVertical ? rect.height : rect.width;
    const perpCenter = isVertical ? cursorLocal.y : cursorLocal.x;

    const segLen = R.extentPercent === null ? viewportExtent : (viewportExtent * R.extentPercent) / 100;
    const segStart = perpCenter - segLen / 2;
    const segEnd = perpCenter + segLen / 2;
    const clippedStart = Math.max(0, segStart);
    const clippedEnd = Math.min(viewportExtent, segEnd);

    if (mode !== RIPPLE_MODE.PUSHER) {
        const along0 = Math.min(originLocal[isVertical ? "x" : "y"], cursorLocal[isVertical ? "x" : "y"]);
        const along1 = Math.max(originLocal[isVertical ? "x" : "y"], cursorLocal[isVertical ? "x" : "y"]);
        ctx.save();
        ctx.fillStyle = palette.fill;
        if (isVertical) ctx.fillRect(along0, clippedStart, along1 - along0, clippedEnd - clippedStart);
        else ctx.fillRect(clippedStart, along0, clippedEnd - clippedStart, along1 - along0);
        ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = settings.lineWidth;
    ctx.beginPath();
    if (isVertical) {
        ctx.moveTo(cursorLocal.x, clippedStart);
        ctx.lineTo(cursorLocal.x, clippedEnd);
    } else {
        ctx.moveTo(clippedStart, cursorLocal.y);
        ctx.lineTo(clippedEnd, cursorLocal.y);
    }
    ctx.stroke();
    ctx.restore();

    return {
        isVertical,
        viewportExtent,
        segStart,
        segEnd,
        overflowStart: Math.max(0, -segStart),
        overflowEnd: Math.max(0, segEnd - viewportExtent),
    };
}

function drawOrthogonalDistanceLine(ctx, axis, originLocal, cursorLocal) {
    // Orthogonal to the ripple line: if the ripple line is vertical (axis
    // 'x'), this is a horizontal segment, drawn at the origin's row, from
    // the origin out to the line's current position.
    const isVertical = axis === "x";
    ctx.save();
    ctx.strokeStyle = COLORS.helperLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    if (isVertical) {
        ctx.moveTo(originLocal.x, originLocal.y);
        ctx.lineTo(cursorLocal.x, originLocal.y);
    } else {
        ctx.moveTo(originLocal.x, originLocal.y);
        ctx.lineTo(originLocal.x, cursorLocal.y);
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
    if (!R.isDragging || !R.startWorld || !R.lastWorld || !rect) return;

    const axis = R.displayAxis;
    const mode = R.displayMode;
    const inSafeZone = R.displayInSafeZone;

    const originLocal = worldToCanvasLocal(R.startWorld.x, R.startWorld.y);
    const cursorLocal = R.lastLocal || worldToCanvasLocal(R.lastWorld.x, R.lastWorld.y);

    drawOriginMarker(overlayCtx, originLocal);

    const showLine = axis !== null && (!inSafeZone || R.hasScrolled || R.engagedAxis !== null);
    if (!showLine) return;

    drawOrthogonalDistanceLine(overlayCtx, axis, originLocal, cursorLocal);

    const palette = paletteFor(inSafeZone, mode);
    const segInfo = drawRippleVisuals(overlayCtx, rect, palette, mode, axis, originLocal, cursorLocal);

    // --- labels, on the unclipped top layer ---
    const toLabelSpace = (localX, localY) => ({ x: rect.left + localX, y: rect.top + localY });

    // Distance-moved label, anchored near the ripple line.
    const originCoord = axis === "x" ? R.startWorld.x : R.startWorld.y;
    const cursorCoord = axis === "x" ? R.lastWorld.x : R.lastWorld.y;
    const distWorld = Math.abs(cursorCoord - originCoord);
    const sign = mode === RIPPLE_MODE.REVERSE ? "-" : "+";
    let distText = `${sign}${Math.round(distWorld)}px`;
    if (isAlwaysSnapEnabled()) {
        const g = getGridSize();
        if (g) distText += ` (${sign}${Math.round(distWorld / g)} cells)`;
    }
    const midLocal = segInfo.isVertical
        ? { x: (originLocal.x + cursorLocal.x) / 2, y: originLocal.y - 12 }
        : { x: originLocal.x + 12, y: (originLocal.y + cursorLocal.y) / 2 };
    const midLabelPos = toLabelSpace(midLocal.x, midLocal.y);
    drawLabel(labelCtx, distText, midLabelPos.x, midLabelPos.y, "center");

    // Off-screen overflow labels - only meaningful once the line is finite.
    if (R.extentPercent !== null) {
        if (segInfo.isVertical) {
            if (segInfo.overflowStart > 0) {
                const p = toLabelSpace(cursorLocal.x + 8, 14);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowStart)}px`, p.x, p.y, "left");
            }
            if (segInfo.overflowEnd > 0) {
                const p = toLabelSpace(cursorLocal.x + 8, rect.height - 14);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowEnd)}px`, p.x, p.y, "left");
            }
        } else {
            if (segInfo.overflowStart > 0) {
                const p = toLabelSpace(14, cursorLocal.y - 10);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowStart)}px`, p.x, p.y, "left");
            }
            if (segInfo.overflowEnd > 0) {
                const p = toLabelSpace(rect.width - 14, cursorLocal.y - 10);
                drawLabel(labelCtx, `+${Math.round(segInfo.overflowEnd)}px`, p.x, p.y, "right");
            }
        }
    }
}
