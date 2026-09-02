/**
 * Settings registration and the live `settings` object, plus the
 * snap-to-grid helpers that read ComfyUI's own LiteGraph > Canvas settings
 * ("Always Snap To Grid" / "Snap to grid size").
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
    add("RippleEdit.ScrollStepPercent", "Ripple Edit: Scroll-wheel resize step (%)", "number", DEFAULTS.scrollStepPercent, "scrollStepPercent");
    add(
        "RippleEdit.NodeInclusionMode",
        "Ripple Edit: How boundary-straddling nodes are counted",
        "combo",
        DEFAULTS.nodeInclusionMode,
        "nodeInclusionMode",
        { options: NODE_INCLUSION_OPTIONS }
    );
    add("RippleEdit.ReversePullFlipped", "Ripple Edit: Reverse mode - pull from the opposite side instead", "boolean", DEFAULTS.reversePullFlipped, "reversePullFlipped");
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
