/**
 * ComfyUI Ripple Edit - entry point
 * ==================================
 * Video-editor-style "ripple edit" tool for the ComfyUI node graph.
 *
 * Trigger:   Ctrl + Right-click, then drag.
 * Modes (checked live, can be toggled mid-drag - but any change resets
 * nodes moved so far back to their original position first):
 *    (no modifier) -> pusher  - insert space, push nodes away  -> configurable color (green by default)
 *    Shift          -> puller - remove space, pull nodes in    -> configurable color (red by default)
 *    Alt            -> aligner - physical "broom" sweep, testing -> configurable color (orange by default)
 *    Esc            -> cancel the in-progress drag, restore original positions
 *
 * No global keydown shortcuts are ever registered - the only thing listened
 * for globally is pointer events gated behind Ctrl+RightMouseDown and
 * scoped to the graph canvas area, so this can never collide with an
 * existing ComfyUI/LiteGraph keybinding.
 *
 * This file only wires things together. The actual implementation lives in
 * ./modules/, split by concern:
 *   ripple_constants.js  - shared enums, colors, defaults (no dependencies)
 *   ripple_settings.js   - registered settings, grid-snap + Nodes 2.0 helpers
 *   ripple_coords.js     - world/canvas/screen coordinate conversions
 *   ripple_overlay.js    - the two overlay <canvas> elements
 *   ripple_state.js      - the mutable drag-state object `R`
 *   ripple_math.js       - pure per-node shift math (pusher/puller/aligner)
 *   ripple_engine.js     - per-frame orchestration (safe zone, reset-on-change, tick)
 *   ripple_draw.js       - all overlay drawing
 *   ripple_events.js     - drag lifecycle + DOM listener wiring
 *
 * See each module's header comment, and the README, for behavior details.
 */

import { app } from "../../scripts/app.js";
import { EXT_NAME } from "./modules/ripple_constants.js";
import { registerSettings } from "./modules/ripple_settings.js";
import { ensureOverlays } from "./modules/ripple_overlay.js";
import {
    attachGlobalPointerListeners,
    attachGlobalContextMenuSuppression,
    attachGlobalSafetyListeners,
    attachResizeObserver,
} from "./modules/ripple_events.js";

app.registerExtension({
    name: EXT_NAME,
    async setup() {
        registerSettings();
        ensureOverlays();

        // Pointer/contextmenu/keyboard listeners are window-scoped, so they
        // can attach immediately - they don't need the graph canvas element
        // to exist yet, only to check against it at event time.
        attachGlobalPointerListeners();
        attachGlobalContextMenuSuppression();
        attachGlobalSafetyListeners();

        // The ResizeObserver does need the actual canvas element, which may
        // not exist the instant setup() runs on every ComfyUI version.
        let attempts = 0;
        const tryObserve = () => {
            attempts += 1;
            if (attachResizeObserver()) return;
            if (attempts < 50) setTimeout(tryObserve, 100);
        };
        tryObserve();
    },
});
