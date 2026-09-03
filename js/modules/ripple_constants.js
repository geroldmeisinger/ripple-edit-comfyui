/**
 * Shared constants for the Ripple Edit extension. No dependencies.
 *
 * Naming (internal <-> what the person sees):
 *   PUSHER  = "ripple move, insert space"   (default, no modifier)
 *   PULLER  = "ripple move, remove space"   (Shift)
 *   ALIGNER = physical "broom" sweep, testing (Alt) - previously called
 *             "pusher" in earlier drafts of this tool; renamed to avoid
 *             clashing with the new PUSHER name above.
 */

export const EXT_NAME = "ripple.edit";

export const RIPPLE_MODE = {
    PUSHER: "pusher",
    PULLER: "puller",
    ALIGNER: "aligner",
};

// Fixed (non-configurable) visual constants.
export const COLORS = {
    disengaged: { line: "rgba(150, 150, 150, 0.55)", fill: "rgba(150, 150, 150, 0.08)" },
    helperLine: "rgba(210, 210, 210, 0.55)",
    labelText: "rgba(255, 255, 255, 0.9)",
    labelBg: "rgba(0, 0, 0, 0.6)",
};

export const DEFAULTS = {
    enabled: true,
    safeZoneRadius: 10,     // graph-space units; radius of the "nothing happens yet" zone around origin
    maxDistance: -1,        // graph-space units from the TRUE origin; -1 = infinite
    lineWidth: 5,           // px
    scrollStepPercent: 5,   // % per wheel notch, always relative to the current viewport dimension
    nodeInclusionMode: "clear", // "clear" | "touching" | "center"
    lockOrientationOutsideSafeZone: false,
    hideVisuals: false,

    pusherLineColor: "rgba(60, 220, 130, 0.95)",
    pusherFillColor: "rgba(60, 220, 130, 0.16)",
    pullerLineColor: "rgba(230, 70, 70, 0.95)",
    pullerFillColor: "rgba(230, 70, 70, 0.16)",
    alignerLineColor: "rgba(255, 170, 60, 0.95)",
    alignerFillColor: "rgba(255, 170, 60, 0.10)",
};

export const NODE_INCLUSION_OPTIONS = [
    { value: "clear", text: "Node must be fully clear of the line (default)" },
    { value: "touching", text: "Any part of the node touching the line" },
    { value: "center", text: "Node's center crossing the line" },
];
