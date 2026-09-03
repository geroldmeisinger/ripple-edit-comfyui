/**
 * Settings registration and the live `settings` object, plus the
 * snap-to-grid helpers that read ComfyUI's own LiteGraph > Canvas settings
 * ("Always Snap To Grid" / "Snap to grid size"), and Nodes 2.0 detection.
 */

import { app } from "../../../scripts/app.js";
import { DEFAULTS, NODE_INCLUSION_OPTIONS } from "./ripple_constants.js";

export const settings = { ...DEFAULTS };

export function registerSettings() {
    if (!app.ui || !app.ui.settings || typeof app.ui.settings.addSetting !== "function") {
        console.warn("[RippleEdit] app.ui.settings not available - using defaults.");
        return;
    }
    const add = (id, name, type, defaultValue, key, extra = {}) => {
        try {
            app.ui.settings.addSetting({
                id,
                name,
                type,
                defaultValue,
                onChange: (v) => {
                    if (type === "boolean") settings[key] = !!v;
                    else if (type === "number") settings[key] = Number(v);
                    else settings[key] = v;
                },
                ...extra,
            });
            const current = app.ui.settings.getSettingValue?.(id, defaultValue);
            if (type === "boolean") settings[key] = !!current;
            else if (type === "number") settings[key] = Number(current);
            else settings[key] = current;
        } catch (err) {
            console.warn(`[RippleEdit] Failed to register setting ${id}:`, err);
        }
    };

    add("RippleEdit.Enabled", "Ripple Edit: Enable Ctrl+Right-drag tool", "boolean", DEFAULTS.enabled, "enabled");
    add("RippleEdit.SafeZoneRadius", "Ripple Edit: Safe-zone radius around origin before anything moves (graph units)", "number", DEFAULTS.safeZoneRadius, "safeZoneRadius");
    add("RippleEdit.MaxDistance", "Ripple Edit: Maximum node distance from origin affected, -1 = infinite (graph units)", "number", DEFAULTS.maxDistance, "maxDistance");
    add("RippleEdit.LineWidth", "Ripple Edit: Ripple line thickness (px)", "number", DEFAULTS.lineWidth, "lineWidth");
    add("RippleEdit.ScrollStepPercent", "Ripple Edit: Scroll-wheel resize step (% of current viewport dimension)", "number", DEFAULTS.scrollStepPercent, "scrollStepPercent");
    add(
        "RippleEdit.NodeInclusionMode",
        "Ripple Edit: How boundary-straddling nodes are counted",
        "combo",
        DEFAULTS.nodeInclusionMode,
        "nodeInclusionMode",
        { options: NODE_INCLUSION_OPTIONS }
    );
    add("RippleEdit.LockOrientationOutsideSafeZone", "Ripple Edit: Lock orientation once engaged (no swapping mid-drag)", "boolean", DEFAULTS.lockOrientationOutsideSafeZone, "lockOrientationOutsideSafeZone");
    add("RippleEdit.HideVisuals", "Ripple Edit: Hide all ripple visuals (line, rectangle, icon, labels)", "boolean", DEFAULTS.hideVisuals, "hideVisuals");

    add("RippleEdit.PusherLineColor", "Ripple Edit: Pusher (insert space) line color", "text", DEFAULTS.pusherLineColor, "pusherLineColor");
    add("RippleEdit.PusherFillColor", "Ripple Edit: Pusher (insert space) box color", "text", DEFAULTS.pusherFillColor, "pusherFillColor");
    add("RippleEdit.PullerLineColor", "Ripple Edit: Puller (remove space) line color", "text", DEFAULTS.pullerLineColor, "pullerLineColor");
    add("RippleEdit.PullerFillColor", "Ripple Edit: Puller (remove space) box color", "text", DEFAULTS.pullerFillColor, "pullerFillColor");
    add("RippleEdit.AlignerLineColor", "Ripple Edit: Aligner (physical sweep) line color", "text", DEFAULTS.alignerLineColor, "alignerLineColor");
    add("RippleEdit.AlignerFillColor", "Ripple Edit: Aligner (physical sweep) box color", "text", DEFAULTS.alignerFillColor, "alignerFillColor");
}

// ---------------------------------------------------------------------------
// Snap-to-grid (LiteGraph > Canvas > "Always Snap To Grid" / "Snap to grid size")
// ---------------------------------------------------------------------------

export function isAlwaysSnapEnabled() {
    try {
        if (app.ui?.settings?.getSettingValue) {
            const v1 = app.ui.settings.getSettingValue("Comfy.Graph.AlwaysSnapToGrid", undefined);
            if (v1 !== undefined) return !!v1;
            const v2 = app.ui.settings.getSettingValue("pysssss.SnapToGrid", undefined);
            if (v2 !== undefined) return !!v2;
        }
    } catch (err) {
        /* fall through */
    }
    try {
        if (app.canvas && typeof app.canvas.align_to_grid !== "undefined") return !!app.canvas.align_to_grid;
    } catch (err) {
        /* fall through */
    }
    return false;
}

export function getGridSize() {
    try {
        if (app.ui?.settings?.getSettingValue) {
            const v = app.ui.settings.getSettingValue("Comfy.SnapToGrid.GridSize", undefined);
            if (v) return Number(v);
        }
    } catch (err) {
        /* fall through */
    }
    try {
        if (window.LiteGraph && LiteGraph.CANVAS_GRID_SIZE) return LiteGraph.CANVAS_GRID_SIZE;
    } catch (err) {
        /* fall through */
    }
    return 10;
}

export function snapValue(v) {
    if (!isAlwaysSnapEnabled()) return v;
    const g = getGridSize();
    if (!g) return v;
    return Math.round(v / g) * g;
}

// ---------------------------------------------------------------------------
// Nodes 2.0 (Vue-rendered nodes) detection
// ---------------------------------------------------------------------------
// See https://docs.comfy.org/interface/nodes-2 - when enabled, ComfyUI
// renders nodes via a Vue/CRDT-backed layout store instead of drawing them
// on the LiteGraph canvas, and (as of this writing) that store is not a
// documented/stable public API. This extension still computes and writes
// `node.pos`, which is correct for classic rendering and for anything that
// reads positions later (saving, re-enabling classic mode), but it cannot
// currently push a live position into the Vue layout store, so moved nodes
// may not visually update in real time under Nodes 2.0. We only warn about
// this once per session rather than silently doing nothing.

let warnedAboutVueNodes = false;

export function isVueNodesEnabled() {
    try {
        return !!app.ui?.settings?.getSettingValue?.("Comfy.VueNodes.Enabled", false);
    } catch (err) {
        return false;
    }
}

export function warnAboutVueNodesOnce() {
    if (warnedAboutVueNodes) return;
    if (!isVueNodesEnabled()) return;
    warnedAboutVueNodes = true;
    console.warn(
        "[RippleEdit] Nodes 2.0 (Comfy.VueNodes.Enabled) is on. ComfyUI's Vue node " +
        "renderer stores positions in a separate layout store that this extension " +
        "cannot currently write to directly, so moved nodes may not visually update " +
        "in real time. Node positions are still computed correctly (useful if you " +
        "later disable Nodes 2.0). If this is disruptive, switch back to classic " +
        "rendering via the ComfyUI logo menu > Nodes 2.0 toggle."
    );
}
