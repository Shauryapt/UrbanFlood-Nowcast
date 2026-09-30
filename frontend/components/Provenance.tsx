"use client";
import { useEffect } from "react";
import { RESOLUTION_NOTE } from "@/lib/api";
import type { DataClass, Meta } from "@/lib/types";

const TAG: Record<DataClass, { color: string; text: string }> = {
  REAL: { color: "var(--real)", text: "Real" },
  REPRESENTATIVE: { color: "var(--repr)", text: "Representative" },
  SIMULATED: { color: "var(--sim)", text: "Simulated" },
};

export function DataTag({ cls }: { cls: DataClass }) {
  const t = TAG[cls];
  return (
    <span className="label inline-flex items-center gap-1 border px-1 py-[1px] text-[10px]" style={{ color: t.color, borderColor: t.color }}>
      {t.text}
    </span>
  );
}

const MEANING: Record<DataClass, string> = {
  REAL: "Public dataset, processed without alteration beyond resampling to the analysis grid.",
  REPRESENTATIVE: "Constructed to be physically plausible from real inputs; not the actual asset or record.",
  SIMULATED: "Scenario input or model output.",
};

export default function Provenance({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-ground/60" onClick={onClose}>
      <aside role="dialog" aria-label="Data provenance" onClick={(e) => e.stopPropagation()}
        className="scroll-thin h-full w-full max-w-[560px] overflow-y-auto border-l border-line-strong bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="label text-ink">Data provenance · {meta.name}</h2>
            <p className="text-[12px] text-dim">Every layer and output, with its source and status.</p>
          </div>
          <button onClick={onClose} className="label hover:text-ink">Close</button>
        </div>
        <div className="grid gap-1.5 border-b border-line px-4 py-3">
          {(Object.keys(TAG) as DataClass[]).map((c) => (
            <div key={c} className="grid grid-cols-[120px_1fr] items-start gap-2 text-[12px]">
              <div><DataTag cls={c} /></div><span className="text-dim">{MEANING[c]}</span>
            </div>
          ))}
        </div>
        <table className="w-full text-left text-[12px]">
          <tbody>
            {meta.provenance.map((p) => (
              <tr key={p.layer} className="border-b border-line align-top">
                <td className="w-[128px] px-4 py-2"><DataTag cls={p.cls} /></td>
                <td className="py-2 pr-4">
                  <div className="text-ink">{p.layer}</div>
                  <div className="text-dim">{p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">{p.source}</a> : p.source}</div>
                  <div className="text-[11px] text-faint">{p.detail}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 text-[11px] leading-relaxed text-faint">
          Risk score = sum of weighted factors ({meta.model.factors.map((f) => `${f.label.toLowerCase()} ${Math.round(f.weight * 100)}`).join(", ")}).
          The class is the higher of the score class (thresholds {meta.model.score_thresholds.join(" / ")}) and the depth class
          ({meta.model.depth_thresholds_m.map((d) => `${d * 100} cm`).join(" / ")}). Weights and thresholds are set by expert judgement and are not trained. Full references are in REFERENCES.md. {RESOLUTION_NOTE}
        </div>
      </aside>
    </div>
  );
}
