/** Operational modes: how modelled street flood status is PRIORITISED in guidance text (prototype).
 *  No routes, travel times or live road status are computed; no external service is connected. */
export type OpMode = "emergency" | "transit" | "navigation";

export const OP_MODES: { key: OpMode; label: string; summary: string }[] = [
  { key: "emergency", label: "Emergency", summary: "Prioritise avoiding streets at HIGH RISK or ROAD CLOSURE RISK." },
  { key: "transit", label: "Transit", summary: "Keep major corridors (motorway, trunk, primary) in service; avoid only ROAD CLOSURE RISK streets." },
  { key: "navigation", label: "Navigation", summary: "Balance travel continuity with modelled risk: avoid ROAD CLOSURE RISK, take care on HIGH RISK." },
];

export const MODE_LABEL = "Operational mode — routing integration prototype";
export const MODE_HELP =
  "Changes prioritisation guidance for modelled street flood status only. It does not perform live routing, " +
  "calculate travel times or report live road status, and is not connected to emergency, transit or navigation services.";

export type Advisory = "AVOID" | "CAUTION" | "NO FLOOD CONSTRAINT";

const MAJOR = /^(motorway|trunk|primary)(_link)?$/;

/** Guidance for one road segment from its street flood status index (0 CLEAR .. 3 ROAD CLOSURE RISK) and OSM class. */
export function modeAdvisory(mode: OpMode, status: number, highway: string | null): { level: Advisory; reason: string } {
  const major = MAJOR.test(highway ?? "");
  if (mode === "emergency") {
    if (status >= 2) return { level: "AVOID", reason: "Emergency mode avoids HIGH RISK and ROAD CLOSURE RISK streets." };
    if (status === 1) return { level: "CAUTION", reason: "Shallow modelled ponding; usable with care." };
  } else if (mode === "transit") {
    if (status >= 3) return { level: "AVOID", reason: "Transit mode avoids ROAD CLOSURE RISK streets." };
    if (status >= 1) return { level: "CAUTION", reason: major
      ? "Major corridor: keep in service with care while modelled depth stays below the closure band."
      : "Not a major corridor; lower priority for keeping services running." };
  } else {
    if (status >= 3) return { level: "AVOID", reason: "Navigation mode avoids ROAD CLOSURE RISK streets." };
    if (status === 2) return { level: "CAUTION", reason: "Usable with care if no lower-risk alternative is known." };
    if (status === 1) return { level: "CAUTION", reason: "Shallow modelled ponding; minor delay risk." };
  }
  return { level: "NO FLOOD CONSTRAINT", reason: "No modelled flood constraint at this step." };
}
