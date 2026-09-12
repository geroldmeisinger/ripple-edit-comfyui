/**
 * All overlay drawing: origin/safe-zone marker, the ripple line (edge-
 * aligned so nothing is drawn past the cursor), the push/pull/align mode
 * icon, the affected-area indicators, the distance indicator, and the
 * label types (distance-moved, off-screen length overflow, and off-screen
 * affected-item count).
 *
 * Visual positioning (the line and icon) always tracks the raw cursor
 * position - never the safe-zone-discounted "effective" position used for
 * actually computing node shifts. Using the discounted position for
 * visuals made the line/icon visibly lag behind the cursor and feel "stuck"
 * in the safe zone. The *numbers* shown (the distance label) still use the
 * discounted amount, since that's the actual effect size - only the
 * drawing position is raw.
 *
 * The safe-zone radius is configured in *display* pixels (see
 * ripple_engine.js for why) - the origin-marker circle is drawn at that
 * exact radius, unscaled by zoom, while the distance-indicator's "outer
 * edge of the safe zone" start point is computed in graph units (radius /
 * current zoom scale), since that has to combine with node positions,
 * which live in graph space.
 *
 * `R.displayInSafeZone` (true spatial safe-zone membership) controls
 * whether the line is shown at all. `R.displayDisengaged` (in the safe
 * zone OR the orientation-decision timer hasn't elapsed - see
 * ripple_engine.js) controls grey-vs-colored. These are deliberately
 * different: once you've left the safe zone, the (greyed) line is visible
 * even before the timer elapses.
 */

import { COLORS, RIPPLE_MODE } from "./ripple_constants.js";
import { settings, isAlwaysSnapEnabled, getGridSize } from "./ripple_settings.js";
import { getScale, worldToCanvasLocal } from "./ripple_coords.js";
import { R, getRememberedExtentPx } from "./ripple_state.js";
import { ensureOverlays, resizeOverlays, clearOverlays, overlayCtx, labelCtx } from "./ripple_overlay.js";

function paletteFor(mode) {
    if (mode === RIPPLE_MODE.PULLER) return settings.pullerLineColor;
    if (mode === RIPPLE_MODE.ALIGNER) return settings.alignerLineColor;
    return settings.pusherLineColor;
}

function drawOriginMarker(ctx, originLocal, mode) {
    const radiusPx = Math.max(0, settings.safeZoneRadius); // display px, unscaled - see module header
    const color = paletteFor(mode);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    if (radiusPx <= 0) {
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
 * Pure geometry for the ripple line's perpendicular segment - shared by the
 * line itself and the affected-area indicators, computed once per frame so
 * both agree exactly (this used to be computed only inside `drawRippleLine`,
 * which meant anything wanting it earlier - like the pre-engagement
 * MaxDistance preview - couldn't get consistent values).
 */
function computeSegmentBounds(rect, axisIsX, perpCenter) {
    const viewportExtent = axisIsX ? rect.height : rect.width;
    const extentPx = getRememberedExtentPx();
    const segLen = extentPx === null ? viewportExtent * 2 : extentPx;
    const segStart = perpCenter - segLen / 2;
    const segEnd = perpCenter + segLen / 2;
    return {
        isInfinite: extentPx === null,
        viewportExtent,
        rawSegStart: segStart,
        rawSegEnd: segEnd,
        segStart: Math.max(0, segStart),
        segEnd: Math.min(viewportExtent, segEnd),
        overflowStart: Math.max(0, -segStart),
        overflowEnd: Math.max(0, segEnd - viewportExtent),
    };
}

/**
 * Draws the ripple line as a filled, edge-aligned rectangle: the forward
 * edge (in the direction of travel) sits exactly at `cursorLocal`, and the
 * full thickness extends backward from there - nothing is ever drawn past
 * the cursor. Set `RippleEdit.LineWidth` to 0 to skip drawing it entirely
 * (the segment geometry is still returned/used for everything else).
 */
function drawRippleLine(ctx, color, axisIsX, dir, cursorLocal, segInfo) {
    const lw = Math.max(0, settings.lineWidth);
    if (lw <= 0) return;
    ctx.save();
    ctx.fillStyle = color;
    if (axisIsX) {
        const x0 = dir >= 0 ? cursorLocal.x - lw : cursorLocal.x;
        ctx.fillRect(x0, segInfo.segStart, lw, segInfo.segEnd - segInfo.segStart);
    } else {
        const y0 = dir >= 0 ? cursorLocal.y - lw : cursorLocal.y;
        ctx.fillRect(segInfo.segStart, y0, segInfo.segEnd - segInfo.segStart, lw);
    }
    ctx.restore();
}

/**
 * Marks the extent of the affected area (pusher/puller only - the aligner
 * has no "space" concept): a faint dotted line at each perpendicular end of
 * the visible line segment, running orthogonal to the ripple line (i.e.
 * along the drag axis), starting at `fromLocal` and extending to
 * `toLocal` - a preview of how much could be (or could still be) affected
 * out to `RippleEdit.MaxDistance`'s cutoff. Only drawn when MaxDistance is
 * finite; there's no fixed endpoint to show otherwise. Called twice: once
 * for the current direction of travel (in the mode's color, from the
 * cursor), and once for the opposite direction (always grey, from the
 * origin) - drawing both is what fixes an old asymmetry where only
 * whichever side happened to have a line looked "on".
 */
function drawAffectedAreaIndicators(ctx, axisIsX, color, fromLocal, toLocal, segStart, segEnd) {
    const along0 = Math.min(fromLocal[axisIsX ? "x" : "y"], toLocal[axisIsX ? "x" : "y"]);
    const along1 = Math.max(fromLocal[axisIsX ? "x" : "y"], toLocal[axisIsX ? "x" : "y"]);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (axisIsX) {
        ctx.moveTo(along0, segStart);
        ctx.lineTo(along1, segStart);
        ctx.moveTo(along0, segEnd);
        ctx.lineTo(along1, segEnd);
    } else {
        ctx.moveTo(segStart, along0);
        ctx.lineTo(segEnd, along0);
        ctx.moveTo(segStart, along1);
        ctx.lineTo(segEnd, along1);
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * The orthogonal cap at the MaxDistance cutoff itself: a dashed segment
 * perpendicular to the drag axis, positioned at `atLocal`'s along-axis
 * coordinate (i.e. exactly at the cutoff point) and spanning the same
 * `segStart..segEnd` range as the runner lines from
 * `drawAffectedAreaIndicators`, so the two together read as one open-ended
 * bracket: [ runner ][ runner ] with this cap closing the far end. Drawn
 * unconditionally, every frame, for both directions - there is no
 * direction-dependent branching here on purpose, since that's what
 * previously made the cap (and, before this fix, the whole indicator)
 * appear to only "pick one side" depending on which way the cursor moved.
 */
function drawMaxDistanceCap(ctx, axisIsX, color, atLocal, segStart, segEnd) {
    const alongCoord = atLocal[axisIsX ? "x" : "y"];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (axisIsX) {
        ctx.moveTo(alongCoord, segStart);
        ctx.lineTo(alongCoord, segEnd);
    } else {
        ctx.moveTo(segStart, alongCoord);
        ctx.lineTo(segEnd, alongCoord);
    }
    ctx.stroke();
    ctx.restore();
}

/** A dotted blue outline at an item's *original* position and size (title bar included for nodes) - a "ghost" of the pre-drag layout, for whatever is currently affected. */
function drawGhostRect(ctx, topLeftLocal, bottomRightLocal) {
    ctx.save();
    ctx.strokeStyle = COLORS.ghost;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
        topLeftLocal.x,
        topLeftLocal.y,
        bottomRightLocal.x - topLeftLocal.x,
        bottomRightLocal.y - topLeftLocal.y
    );
    ctx.restore();
}

/**
 * The mode icon: a triangle for pusher/puller, or a 3-bar "align to base"
 * glyph for the aligner. Both triangle orientations keep every vertex at or
 * behind `tipLocal` in the direction of travel, so nothing is ever drawn
 * past the cursor either way:
 *   - puller: flat base flush at the cursor, point receding backward.
 *   - pusher: point flush at the cursor, flat base receding backward -
 *     the mirror image of the puller's, so the two read as visually
 *     distinct (not just recolored) while both still stay fully "inside".
 * Not drawn at all while the cursor is exactly at the origin - the
 * direction is undefined there (see ripple_engine.js).
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
        if (mode === RIPPLE_MODE.PUSHER) {
            // Point flush at the cursor, base receding backward.
            if (axisIsX) {
                ctx.moveTo(tipLocal.x, tipLocal.y);
                ctx.lineTo(tipLocal.x - d * len, tipLocal.y - halfWidth);
                ctx.lineTo(tipLocal.x - d * len, tipLocal.y + halfWidth);
            } else {
                ctx.moveTo(tipLocal.x, tipLocal.y);
                ctx.lineTo(tipLocal.x - halfWidth, tipLocal.y - d * len);
                ctx.lineTo(tipLocal.x + halfWidth, tipLocal.y - d * len);
            }
        } else {
            // Puller: flat base flush at the cursor, point receding backward.
            if (axisIsX) {
                ctx.moveTo(tipLocal.x, tipLocal.y - halfWidth);
                ctx.lineTo(tipLocal.x, tipLocal.y + halfWidth);
                ctx.lineTo(tipLocal.x - d * len, tipLocal.y);
            } else {
                ctx.moveTo(tipLocal.x - halfWidth, tipLocal.y);
                ctx.lineTo(tipLocal.x + halfWidth, tipLocal.y);
                ctx.lineTo(tipLocal.x, tipLocal.y - d * len);
            }
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
 * actual outer edge of the safe zone. Drawn as one dashed polyline:
 * safe-zone edge -> elbow point -> cursor.
 */
function drawDistanceIndicator(ctx, axisIsX, safeZoneEdgeLocal, cursorLocal) {
    const elbow = axisIsX ? { x: safeZoneEdgeLocal.x, y: cursorLocal.y } : { x: cursorLocal.x, y: safeZoneEdgeLocal.y };
    ctx.save();
    ctx.strokeStyle = COLORS.helperLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(safeZoneEdgeLocal.x, safeZoneEdgeLocal.y);
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
    const inSafeZone = R.displayInSafeZone; // true spatial membership - line visibility only
    const disengaged = R.displayDisengaged; // safe zone OR orientation timer not elapsed - grey vs colored

    const originLocal = worldToCanvasLocal(R.startWorld.x, R.startWorld.y);
    drawOriginMarker(overlayCtx, originLocal, mode);
    if (axis === null) return;

    const axisIsX = axis === "x";
    const dir = R.displayDir;
    const cursorLocal = R.lastLocal || worldToCanvasLocal(R.lastWorld.x, R.lastWorld.y);
    const drawColor = disengaged ? COLORS.disengaged.line : paletteFor(mode);

    // Before ever engaging (leaving the safe zone) at least once this drag,
    // we don't know the eventual orientation/effect yet, so only the icon
    // (and, if MaxDistance is finite, the two direction previews below) are
    // shown - no line, no distance info. Once engaged at least once,
    // returning to the safe zone shows the line again, greyed. The icon
    // itself is never drawn while the cursor is exactly at the origin - the
    // direction is undefined there.
    const neverLeftSafeZoneYet = inSafeZone && R.engagedAxis === null;

    if (!R.displayAtExactOrigin) {
        drawModeIcon(overlayCtx, mode, axisIsX, dir, cursorLocal, drawColor);
    }

    const perpCenter = axisIsX ? cursorLocal.y : cursorLocal.x;
    const segInfo = computeSegmentBounds(rect, axisIsX, perpCenter);

    // MaxDistance previews, in both directions - drawable even before ever
    // engaging, as soon as a (possibly provisional) orientation is known.
    // The current direction of travel uses the same color as the line
    // (grey while disengaged, the mode's color once engaged); the opposite
    // direction is always grey, since that side is never actually active.
    if (mode !== RIPPLE_MODE.ALIGNER && settings.maxDistance > 0) {
        const towardWorld = axisIsX
            ? { x: R.startWorld.x + settings.maxDistance * (dir || 1), y: R.startWorld.y }
            : { x: R.startWorld.x, y: R.startWorld.y + settings.maxDistance * (dir || 1) };
        const awayWorld = axisIsX
            ? { x: R.startWorld.x - settings.maxDistance * (dir || 1), y: R.startWorld.y }
            : { x: R.startWorld.x, y: R.startWorld.y - settings.maxDistance * (dir || 1) };
        const towardLocal = worldToCanvasLocal(towardWorld.x, towardWorld.y);
        const awayLocal = worldToCanvasLocal(awayWorld.x, awayWorld.y);
        drawAffectedAreaIndicators(overlayCtx, axisIsX, drawColor, cursorLocal, towardLocal, segInfo.segStart, segInfo.segEnd);
        drawMaxDistanceCap(overlayCtx, axisIsX, drawColor, towardLocal, segInfo.segStart, segInfo.segEnd);
        drawAffectedAreaIndicators(overlayCtx, axisIsX, COLORS.disengaged.line, originLocal, awayLocal, segInfo.segStart, segInfo.segEnd);
        drawMaxDistanceCap(overlayCtx, axisIsX, COLORS.disengaged.line, awayLocal, segInfo.segStart, segInfo.segEnd);
    }

    if (neverLeftSafeZoneYet) return;

    drawRippleLine(overlayCtx, drawColor, axisIsX, dir, cursorLocal, segInfo);

    // The outer edge of the safe-zone circle, in the current direction of
    // travel - the distance indicator starts here, not at the origin's
    // exact center.
    const safeRadiusGraph = Math.max(0, settings.safeZoneRadius) / getScale();
    const safeZoneEdgeWorld = axisIsX
        ? { x: R.startWorld.x + safeRadiusGraph * (dir || 1), y: R.startWorld.y }
        : { x: R.startWorld.x, y: R.startWorld.y + safeRadiusGraph * (dir || 1) };
    const safeZoneEdgeLocal = worldToCanvasLocal(safeZoneEdgeWorld.x, safeZoneEdgeWorld.y);

    // Ghost outlines of whatever is actually affected right now, at its
    // *original* (pre-drag) position and size - including the title bar
    // for nodes, matching the title-height-aware bounding box used to
    // decide what's affected in the first place.
    if (R.currentlyAffected && R.currentlyAffected.size > 0 && R.trueOriginalPositions) {
        for (const item of R.currentlyAffected) {
            const orig = R.trueOriginalPositions.get(item);
            if (!orig || !item.size) continue;
            const topLeft = worldToCanvasLocal(orig.x, orig.y - (orig.titleHeight || 0));
            const bottomRight = worldToCanvasLocal(orig.x + item.size[0], orig.y + item.size[1]);
            drawGhostRect(overlayCtx, topLeft, bottomRight);
        }
    }

    const toLabelSpace = (localX, localY) => ({ x: rect.left + localX, y: rect.top + localY });

    // Off-screen *length* overflow labels - shown for every mode, including
    // the aligner. Only meaningful once you've scrolled to a finite length;
    // an infinite line shows the infinity symbol instead of a huge number.
    if (segInfo.overflowStart > 0 || segInfo.overflowEnd > 0) {
        const overflowText = (px) => (segInfo.isInfinite ? formatDistance("", "\u221E", "px") : formatDistance("", Math.round(px), "px"));
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

    // Off-screen *affected item count* labels, at the workspace edges along
    // the drag axis (a different pair of edges than the length-overflow
    // labels above, so the two never collide).
    const before = R.displayOffscreenNodesBefore;
    const after = R.displayOffscreenNodesAfter;
    if (before > 0 || after > 0) {
        const countText = (n) => `+ ${n} node${n === 1 ? "" : "s"}`;
        if (axisIsX) {
            if (before > 0) drawLabel(labelCtx, countText(before), rect.left + 6, rect.top + cursorLocal.y, "left");
            if (after > 0) drawLabel(labelCtx, countText(after), rect.left + rect.width - 6, rect.top + cursorLocal.y, "right");
        } else {
            if (before > 0) drawLabel(labelCtx, countText(before), rect.left + cursorLocal.x, rect.top + 16, "center");
            if (after > 0) drawLabel(labelCtx, countText(after), rect.left + cursorLocal.x, rect.top + rect.height - 16, "center");
        }
    }

    // Bug fix: the aligner is a direct physical interaction with the line's
    // absolute position - "distance from origin" isn't a meaningful concept
    // for it, so no distance indicator/label is drawn for that mode.
    if (mode === RIPPLE_MODE.ALIGNER) return;

    drawDistanceIndicator(overlayCtx, axisIsX, safeZoneEdgeLocal, cursorLocal);

    // No +/- sign - the mode's color/icon already conveys push vs. pull,
    // and the label is just a magnitude.
    const distWorld = Math.abs(R.displayDelta);
    let distText;
    if (isAlwaysSnapEnabled()) {
        const g = getGridSize();
        const steps = g ? Math.round(distWorld / g) : 0;
        distText = formatDistance("", steps, "x");
    } else {
        distText = formatDistance("", Math.round(distWorld), "px");
    }
    // Right next to the icon, with a real gap - offset purely along the
    // drag axis (behind it, opposite the direction of travel), centered on
    // the cursor along the *other* axis, not shifted off of it. The offset
    // accounts for the icon's own length, a fixed visual gap, and half the
    // label's own size (its width when offsetting horizontally, its fixed
    // 16px height when offsetting vertically) so there's always daylight
    // between the two regardless of how wide the text is.
    const iconLen = 14;
    const gap = 6;
    labelCtx.save();
    labelCtx.font = "11px monospace";
    const textWidth = labelCtx.measureText(distText).width + 8;
    labelCtx.restore();
    const halfLabelDim = axisIsX ? textWidth / 2 : 8;
    const offset = iconLen + gap + halfLabelDim;
    const labelLocal = axisIsX
        ? { x: cursorLocal.x - (dir || 1) * offset, y: cursorLocal.y }
        : { x: cursorLocal.x, y: cursorLocal.y - (dir || 1) * offset };
    const labelPos = toLabelSpace(labelLocal.x, labelLocal.y);
    drawLabel(labelCtx, distText, labelPos.x, labelPos.y, "center");
}
