import { type MouseEvent, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import type { Quad } from "@rdfjs/types";
import { useDevMode } from "../hooks/devMode.ts";
import {
  type ProvenanceRecord,
  provenanceRecordFor,
  type SourceTier,
} from "../services/rdf/provenanceRecord.ts";
import { getGateway } from "../hooks/session.ts";
import { getStorageRoot } from "../services/pod/solidUtils.ts";
import { UriLink } from "./detail/DetailView.tsx";
import { useT } from "../context/I18nProvider.tsx";

/**
 * The provenance marker — the one-call way to give a GROUP of infos (a detail
 * card/section, a chart, a row) access to its provenance record: timbl's
 * "Oh, yeah?" button (https://www.w3.org/DesignIssues/UI.html) — press it when
 * you doubt what you see, and the system shows why you should believe it.
 * Self-hides outside Developer mode, so callers render it unconditionally (the
 * `RdfSourceLink` pattern). Click opens the record in a popover anchored at
 * the marker: the source documents (named by ring), when they were fetched,
 * the PROV statements about the subject, and the raw statements as the floor.
 * See `plans/plan-per-value-provenance.md`.
 */

const TIER_LABEL_ID: Record<SourceTier, "tierMine" | "tierShared" | "tierOpen"> = {
  mine: "tierMine",
  shared: "tierShared",
  open: "tierOpen",
};

/** Last IRI segment for a compact predicate display. */
function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  return cut >= 0 ? iri.slice(cut + 1) : iri;
}

function statementLine(q: Quad): string {
  const obj = q.object.termType === "Literal"
    ? `"${q.object.value}"`
    : q.object.value;
  return `${localName(q.predicate.value)} → ${obj}`;
}

export interface ProvenanceMarkerProps {
  /** The group's subject IRI(s) — one info, or the rows of a group (system
   * nodes, dataset nodes). An empty array with pinned `sources` makes it a
   * document-level group (the record then shows the documents' contents). */
  subject: string | readonly string[];
  /** Pin the document set when the caller knows it (e.g. the building's own
   * source file); otherwise every dataset graph mentioning a subject. */
  sources?: readonly string[];
}

export function ProvenanceMarker({ subject, sources }: ProvenanceMarkerProps) {
  const dev = useDevMode();
  const t = useT();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [record, setRecord] = useState<ProvenanceRecord | null>(null);

  if (!dev) return null;

  const openRecord = (e: MouseEvent<HTMLElement>) => {
    // Assembled at click time so the popover reflects the current RDF dataset +
    // request log, not a stale snapshot from render time.
    let storageRoot: string | undefined;
    try {
      storageRoot = getStorageRoot(getGateway().webId);
    } catch {
      storageRoot = undefined; // pre-resolve (or headless) → tier falls back
    }
    setRecord(provenanceRecordFor(subject, { storageRoot, sources }));
    setAnchorEl(e.currentTarget);
  };

  const empty = record !== null && record.sources.length === 0 &&
    record.statements.length === 0;

  return (
    <>
      <Tooltip title={t("provTitle")}>
        <IconButton
          size="small"
          aria-label={t("provTitle")}
          onClick={openRecord}
          color="info"
        >
          <FactCheckOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={anchorEl !== null}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        {record && (
          <Stack spacing={1} sx={{ p: 2, maxWidth: 480 }}>
            {record.subjectIris.slice(0, 3).map((iri) => (
              <Typography
                key={iri}
                variant="caption"
                sx={{ wordBreak: "break-all" }}
              >
                {iri}
              </Typography>
            ))}
            {record.subjectIris.length > 3 && (
              <Typography variant="caption" color="text.secondary">
                +{record.subjectIris.length - 3}
              </Typography>
            )}

            {empty && (
              <Typography variant="body2" color="text.secondary">
                {t("provNone")}
              </Typography>
            )}

            {record.sources.map((s) => (
              <Box key={s.graphIri}>
                <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                  <Chip size="small" label={t(TIER_LABEL_ID[s.tier])} />
                  {s.source && (
                    <Typography variant="body2">{s.source.name}</Typography>
                  )}
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ wordBreak: "break-all" }}
                >
                  <UriLink href={s.graphIri}>{s.graphIri}</UriLink>
                </Typography>
                {(s.retrievedAt || s.lastRequest) && (
                  <Typography variant="caption" color="text.secondary">
                    {t("provFetched")}: {s.retrievedAt ?? "—"}
                    {s.lastRequest &&
                      ` · HTTP ${s.lastRequest.status ?? "?"} · ${
                        Math.round(s.lastRequest.durationMs)
                      } ms`}
                  </Typography>
                )}
              </Box>
            ))}

            {record.statements.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {t("provStatements")} ({record.statements.length})
                </Typography>
                <Box
                  sx={{
                    maxHeight: 180,
                    overflow: "auto",
                    fontFamily: "monospace",
                  }}
                >
                  {record.statements.slice(0, 100).map((q, i) => (
                    <Typography
                      key={i}
                      variant="caption"
                      component="div"
                      sx={{ wordBreak: "break-all" }}
                    >
                      {statementLine(q)}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </Stack>
        )}
      </Popover>
    </>
  );
}
