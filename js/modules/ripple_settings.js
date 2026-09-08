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
    add("RippleEdit.SafeZoneRadius", "Ripple Edit: Safe zone - radius around origin before anything moves (display px, independent of zoom)", "number", DEFAULTS.safeZoneRadius, "safeZoneRadius");
    add("RippleEdit.SafeZoneOrientationTimeoutMs", "Ripple Edit: Safe zone - time cursor must be away from origin before orientation locks in (ms)", "number", DEFAULTS.safeZoneOrientationTimeoutMs, "safeZoneOrientationTimeoutMs");
    add("RippleEdit.SafeZoneLockOrientation", "Ripple Edit: Safe zone - lock orientation AND direction once engaged (no changes at all for the rest of the drag)", "boolean", DEFAULTS.lockOrientationOutsideSafeZone, "lockOrientationOutsideSafeZone");
    add("RippleEdit.MaxDistance", "Ripple Edit: Maximum node distance from origin affected, 0 = infinite (graph units)", "number", DEFAULTS.maxDistance, "maxDistance");
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
    add("RippleEdit.HideVisuals", "Ripple Edit: Hide all ripple visuals (line, icon, labels)", "boolean", DEFAULTS.hideVisuals, "hideVisuals");

    add("RippleEdit.ColorPusherLine", "Ripple Edit: Pusher (insert space) line color", "text", DEFAULTS.pusherLineColor, "pusherLineColor");
    add("RippleEdit.ColorPullerLine", "Ripple Edit: Puller (remove space) line color", "text", DEFAULTS.pullerLineColor, "pullerLineColor");
    add("RippleEdit.ColorAlignerLine", "Ripple Edit: Aligner (physical sweep) line color", "text", DEFAULTS.alignerLineColor, "alignerLineColor");
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
// See https://docs.comfy.org/interface/nodes-2. Movement now works correctly
// under Nodes 2.0 (see ripple_engine.js - positions are written via
// `node.pos = [x, y]`, which goes through LiteGraph's setter and reaches the
// Vue layout store, rather than `node.pos[0] = x`, which doesn't). This
// detector is kept around only in case something else about Nodes 2.0 needs
// special-casing in the future - nothing currently uses it.

export function isVueNodesEnabled() {
    try {
        return !!app.ui?.settings?.getSettingValue?.("Comfy.VueNodes.Enabled", false);
    } catch (err) {
        return false;
    }
}
