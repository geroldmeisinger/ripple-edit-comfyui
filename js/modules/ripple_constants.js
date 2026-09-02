/**
 * Shared constants for the Ripple Edit extension. No dependencies.
 */

export const EXT_NAME = "ripple.edit";

export const RIPPLE_MODE = {
    INSERT: "insert",
    REVERSE: "reverse",
    PUSHER: "pusher",
};

export const COLORS = {
    insert: { line: "rgba(60, 220, 130, 0.95)", fill: "rgba(60, 220, 130, 0.16)" },
    reverse: { line: "rgba(230, 70, 70, 0.95)", fill: "rgba(230, 70, 70, 0.16)" },
    pusher: { line: "rgba(255, 170, 60, 0.95)", fill: "rgba(255, 170, 60, 0.10)" },
    disengaged: { line: "rgba(150, 150, 150, 0.55)", fill: "rgba(150, 150, 150, 0.08)" },
    originMarker: "rgba(255, 255, 255, 0.9)",
    helperLine: "rgba(210, 210, 210, 0.55)",
    labelText: "rgba(255, 255, 255, 0.9)",
    labelBg: "rgba(0, 0, 0, 0.6)",
};

export const DEFAULTS = {
    enabled: true,
    safeZoneRadius: 10,     // graph-space units; radius of the "nothing happens yet" zone around origin
    maxDistance: -1,        // graph-space units from the TRUE origin; -1 = infinite
    lineWidth: 5,           // px
    scrollStepPercent: 5,   // % per wheel notch after the initial scroll
    nodeInclusionMode: "clear", // "clear" | "touching" | "center"
    reversePullFlipped: false,
};

export const NODE_INCLUSION_OPTIONS = [
    { value: "clear", text: "Node must be fully clear of the line (default)" },
    { value: "touching", text: "Any part of the node touching the line" },
    { value: "center", text: "Node's center crossing the line" },
];
