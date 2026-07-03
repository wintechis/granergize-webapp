import { msg } from "./messages.ts";
import type { SystemKind, TechnicalSystem } from "../types.ts";

/**
 * The ONE way a technical system (`bldg:hasSystem` node) is described in the UI,
 * shared by the building page's system rows (`SystemListSection`) and the
 * observation page's per-unit headings (`UnitObservationsSection`) so the same
 * system reads identically on both — a row links to a heading, and the reader
 * must recognise it as the same thing.
 */

/** The kind's display label (reuses the master-data system labels). */
export const systemKindLabel = (kind: SystemKind): string =>
  msg(
    kind === "battery"
      ? "mdBatteryStorage"
      : kind === "chp"
      ? "mdChpSystem"
      : kind === "pv"
      ? "mdPvSystem"
      : kind === "heatpump"
      ? "mdHeatPump"
      : kind === "gasboiler"
      ? "mdGasBoiler"
      : kind === "districtheating"
      ? "mdDistrictHeating"
      : kind === "oilboiler"
      ? "mdOilBoiler"
      : "mdElectricBoiler",
  );

/** One-line capacity summary ("750 kW, since 2018" / "215.5 kWh" / "120 kW th, since
 * 2019"), or "Yes" when present but undetailed. */
export const systemSummary = (s: TechnicalSystem): string => {
  const parts: string[] = [];
  if (s.capacityKW != null) parts.push(`${s.capacityKW} kW${s.kind === "chp" ? " el" : ""}`);
  if (s.storageCapacityKWh != null) parts.push(`${s.storageCapacityKWh} kWh`);
  if (s.thermalCapacityKW != null) parts.push(`${s.thermalCapacityKW} kW th`);
  if (s.commissioningYear != null) parts.push(`since ${s.commissioningYear}`);
  return parts.length ? parts.join(", ") : "Yes";
};

/** "Solaranlage Langguth · 63.45 kW, since 2011" — the row VALUE beside the kind
 * label (the name leads when the system has one). */
export const systemValueLine = (s: TechnicalSystem): string =>
  s.label ? `${s.label} · ${systemSummary(s)}` : systemSummary(s);
