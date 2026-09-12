/**
 * Shared constants for the Ripple Edit extension. No dependencies.
 *
 * Naming (internal <-> what the person sees):
 *   PUSHER  = "ripple move, insert space"   (default, no modifier)
 *   PULLER  = "ripple move, remove space"   (Shift)
 *   ALIGNER = physical "broom" sweep, testing (Alt)
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
    ghost: "rgba(70, 140, 255, 0.85)", // original-position/size outline
};

export const DEFAULTS = {
    enabled: true,
    safeZoneRadius: 10,     // display px; radius of the "nothing happens yet" zone around origin
    safeZoneOrientationTimeoutMs: 150, // ms the cursor must be away from the exact origin before orientation locks in
    maxDistance: 0,         // graph-space units from the TRUE origin; 0 (or any non-positive value) = infinite
    lineWidth: 5,           // px
    scrollStepPercent: 20,   // % per wheel notch, always relative to the current viewport dimension
    nodeInclusionMode: "clear", // "clear" | "touching" | "center"
    lockOrientationOutsideSafeZone: true,
    hideVisuals: false,

    pusherLineColor: "rgba(60, 220, 130, 0.95)",
    pullerLineColor: "rgba(230, 70, 70, 0.95)",
    alignerLineColor: "rgba(255, 170, 60, 0.95)",
};

export const NODE_INCLUSION_OPTIONS = [
    { value: "clear", text: "Node must be fully clear of the line (default)" },
    { value: "touching", text: "Any part of the node touching the line" },
    { value: "center", text: "Node's center crossing the line" },
];
