/** Map colours and class breaks, shared by MapView (paint) and MapLegend. */

/** Map colours per theme. Risk hues match the CSS tokens of the same theme. */
export const MAP_PALETTE = {
  dark: {
    basemap: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    risk: ["transparent", "#d4b24c", "#e07b39", "#d0353f"],
    road: "#8795a1", roadMinor: "#6c7a86", water: "#3e7394", spot: "#dfe6ea", select: "#ffffff",
    pipe: "#5d6d79", nodeIdle: "#51616d", nodeOk: "#9aa7b1", outfallRing: "#c5d0d8",
    rain: ["#1c3a4d", "#2b5f80", "#3f86ad", "#6fb3d6", "#b9e0f2"],
    depth: ["#9ecae1", "#6baed6", "#3182bd", "#1c5a99", "#0b3470"],
    elev: ["#26343c", "#3f5a55", "#6f8468", "#a9a17e", "#d8cfb4"],
    imperv: ["#3f6b4a", "#8a8c7c", "#b9b3a6"],
  },
  light: {
    basemap: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    risk: ["transparent", "#c9a21f", "#d8651c", "#b3202b"],
    road: "#5d6b77", roadMinor: "#7d8a95", water: "#2f78a8", spot: "#17212b", select: "#111111",
    pipe: "#8a98a4", nodeIdle: "#9aa6b0", nodeOk: "#5f6c77", outfallRing: "#17212b",
    rain: ["#d7ebf5", "#9fcbe3", "#5aa0c9", "#2b73a6", "#0e4a7a"],
    depth: ["#c6dbef", "#9ecae1", "#4292c6", "#2166ac", "#08306b"],
    elev: ["#e9eee6", "#c7d6bf", "#a3b890", "#8c8a64", "#6b5a3e"],
    imperv: ["#79a882", "#c9c3b3", "#6e6a78"],
  },
} as const;

export const RAIN_STOPS = [0, 10, 25, 50, 100];
export const DEPTH_STOPS = [5, 15, 30, 60, 100];
export const ELEV_STOPS = [0, 5, 15, 40, 120];
export const UTIL_STEPS = [0.8, 1.0, 1.5, 3];
