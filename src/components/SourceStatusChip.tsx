import { Chip, Tooltip } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  hasWrapperProbe,
  probeWrapper,
  type WrapperHealth,
} from "../services/sources/wrapperStatus.ts";

/** Chip colour + label per health state. (Labels are prototype English — i18n TODO.) */
const LABEL: Record<WrapperHealth, string> = {
  conformant: "conformant",
  available: "available",
  down: "down",
};
const COLOR: Record<WrapperHealth, "success" | "warning" | "error"> = {
  conformant: "success",
  available: "warning",
  down: "error",
};

/**
 * Live status badge for an open-data wrapper on the Data-sources page: probes the source
 * (see {@link probeWrapper}) and shows `conformant` (green) / `available` (amber, reachable but the
 * response drifted from the app's schema) / `down` (red). Renders nothing for a source with no
 * probe registered. Cached 5 min; no retry (a probe failure IS the signal).
 */
export function SourceStatusChip({ id }: { id: string }) {
  const enabled = hasWrapperProbe(id);
  const q = useQuery({
    queryKey: ["wrapperStatus", id],
    queryFn: () => probeWrapper(id)!,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!enabled) return null;
  if (q.isLoading) {
    return <Chip size="small" variant="outlined" label="checking…" />;
  }
  if (q.isError || !q.data) {
    return (
      <Tooltip title={q.error instanceof Error ? q.error.message : "unreachable"}>
        <Chip size="small" color="error" label={LABEL.down} />
      </Tooltip>
    );
  }
  const s = q.data;
  const chip = <Chip size="small" color={COLOR[s.health]} label={LABEL[s.health]} />;
  return s.detail ? <Tooltip title={s.detail}>{chip}</Tooltip> : chip;
}
