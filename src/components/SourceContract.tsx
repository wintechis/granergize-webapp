import type { ReactNode } from "react";
import { Link, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  hasWrapperContract,
  wrapperContract,
} from "../services/sources/wrapperContract.ts";
import { hasWrapperProbe, probeWrapper } from "../services/sources/wrapperStatus.ts";

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  );
}

/** Strip the host from an IRI for a compact link label. */
const shortIri = (iri: string) => iri.replace(/^https?:\/\/[^/]+\//, "");

/**
 * The interface a wrapper must satisfy, shown under its Data-sources entry (prototype: mastr):
 * a link to the live route manifest, the routes the app calls (+ purpose), a dereferenceable
 * **example entity** pulled live from the probe, and the wrapper's **LIDS** service-call example
 * entities. Renders nothing for a source with no contract described. Labels are English (i18n TODO).
 */
export function SourceContract({ id }: { id: string }) {
  const contract = hasWrapperContract(id) ? wrapperContract(id) : null;
  // Shares the ["wrapperStatus", id] cache with SourceStatusChip — for the live example entity.
  const q = useQuery({
    queryKey: ["wrapperStatus", id],
    queryFn: () => probeWrapper(id)!,
    enabled: hasWrapperProbe(id),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!contract) return null;
  const example = q.data?.exampleEntity;

  return (
    <Stack spacing={0.25} sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        Interface (<Ext href={contract.routesUrl}>routes</Ext>):{" "}
        {contract.requires.map((r, i) => (
          <span key={r.route}>
            {i ? "; " : ""}
            <code>{r.route}</code> — {r.purpose}
          </span>
        ))}
      </Typography>
      {example && (
        <Typography variant="caption" color="text.secondary">
          Example entity: <Ext href={example}>{shortIri(example)}</Ext>
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" component="div">
        LIDS examples:{" "}
        {contract.lidsExamples.map((e, i) => (
          <span key={e.url}>
            {i ? " · " : ""}
            <Ext href={e.url}>{e.label}</Ext>
          </span>
        ))}
      </Typography>
    </Stack>
  );
}
