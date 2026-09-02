/**
 * ComfyUI Ripple Edit - entry point
 * ==================================
 * Video-editor-style "ripple edit" tool for the ComfyUI node graph.
 *
 * Trigger:   Ctrl + Right-click, then drag.
 * Modifiers (checked live, can be toggled mid-drag):
 *    Shift  -> reverse mode  (remove space / pull nodes in)   -> red visuals
 *    Alt    -> pusher mode   (physical "broom" push, testing) -> orange visuals
 *    Esc    -> cancel the in-progress drag, restore original positions
 *
 * No global keydown shortcuts are ever registered - the only thing listened
 * for globally is pointer events on the graph canvas element, gated behind
 * Ctrl+RightMouseDown, so this can never collide with an existing
 * ComfyUI/LiteGraph keybinding.
 *
 * This file only wires things together. The actual implementation lives in
 * ./modules/, split by concern:
 *   ripple_constants.js  - shared enums, colors, defaults (no dependencies)
 *   ripple_settings.js   - registered settings + grid-snap helpers
 *   ripple_coords.js     - world/canvas/screen coordinate conversions
 *   ripple_overlay.js    - the two overlay <canvas> elements
 *   ripple_state.js      - the mutable drag-state object `R`
 *   ripple_math.js       - pure per-node shift math (insert/reverse/pusher)
 *   ripple_engine.js     - per-frame orchestration (safe zone, segments, tick)
 *   ripple_draw.js        - all overlay drawing
 *   ripple_events.js     - drag lifecycle + DOM listener wiring
 *
 * See each module's header comment, and the README, for the behavior
 * details (safe zone, segment continuity, reverse-mode capture, etc).
 */

import { app } from "../../scripts/app.js";
import { EXT_NAME } from "./modules/ripple_constants.js";
import { registerSettings } from "./modules/ripple_settings.js";
import { ensureOverlays } from "./modules/ripple_overlay.js";
import {
    attachCanvasListeners,
    attachGlobalContextMenuSuppression,
    attachGlobalSafetyListeners,
    attachResizeObserver,
} from "./modules/ripple_events.js";

app.registerExtension({
    name: EXT_NAME,
    async setup() {
        registerSettings();
        ensureOverlays();
        attachGlobalContextMenuSuppression();
        attachGlobalSafetyListeners();

        // The graph canvas element may not exist the instant setup() runs on
        // every ComfyUI version; poll briefly until it's available.
        let attempts = 0;
        const tryAttach = () => {
            attempts += 1;
            if (attachCanvasListeners()) {
                attachResizeObserver();
                return;
            }
            if (attempts < 50) setTimeout(tryAttach, 100);
        };
        tryAttach();
    },
});
