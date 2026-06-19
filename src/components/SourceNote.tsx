import { Fragment } from "react";
import { Link, Typography } from "@mui/material";
import { msg } from "../lib/messages.ts";
import type { DataSource } from "../constants/dataSources.ts";

/**
 * A one-line attribution note: `"{label} {Name} ({licence}) · {Name} (…)"`, each
 * name + licence linking out. The user-facing, legally-required credit for
 * externally-sourced data — distinct from the dev-only `RdfSourceLink` (which
 * shows the raw RDF IRI and self-hides outside Developer mode). Reuses the
 * `dataSourceLabel` prefix by default; pass `label` for a different lead-in
 * (e.g. the coordinates line). Theme typography only (`body2`/`caption` +
 * `text.secondary`).
 */
export default function SourceNote(
  { sources, label, variant = "body2" }: {
    sources: DataSource | readonly DataSource[];
    label?: string;
    variant?: "body2" | "caption";
  },
) {
  const list = Array.isArray(sources) ? sources : [sources as DataSource];
  return (
    <Typography variant={variant} color="text.secondary" sx={{ display: "block" }}>
      {label ?? msg("dataSourceLabel")}{" "}
      {list.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && " · "}
          {s.homepage
            ? (
              <Link href={s.homepage} target="_blank" rel="noopener noreferrer">
                {s.name}
              </Link>
            )
            : s.name}
          {s.license && (
            <>
              {" ("}
              {s.licenseHref
                ? (
                  <Link
                    href={s.licenseHref}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {s.license}
                  </Link>
                )
                : s.license}
              {")"}
            </>
          )}
        </Fragment>
      ))}
    </Typography>
  );
}
