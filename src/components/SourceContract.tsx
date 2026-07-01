import type { ReactNode } from "react";
import { Link, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  fetchRouteManifest,
  hasWrapperContract,
  isPaginated,
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
 * a link to the live route manifest; per required route its purpose plus the params it accepts and
 * formats it serves (read faithfully from the live `/routes` manifest — so pagination
 * (`count`/`offset`) and formats are reported, not hand-maintained); a dereferenceable **example
 * entity** pulled live from the probe; and the wrapper's **LIDS** service-call example entities.
 * Renders nothing for a source with no contract. Labels are English (i18n TODO).
 */
export function SourceContract({ id }: { id: string }) {
  const contract = hasWrapperContract(id) ? wrapperContract(id) : null;
  // Shares the ["wrapperStatus", id] cache with SourceStatusChip — for the live example entity.
  const status = useQuery({
    queryKey: ["wrapperStatus", id],
    queryFn: () => probeWrapper(id)!,
    enabled: hasWrapperProbe(id),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // The live interface manifest (params/formats/pagination per route).
  const manifest = useQuery({
    queryKey: ["routeManifest", id],
    queryFn: () => fetchRouteManifest(id),
    enabled: !!contract,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!contract) return null;
  const example = status.data?.exampleEntity;
  const routes = manifest.data;

  return (
    <Stack spacing={0.25} sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary">
        Interface (<Ext href={contract.routesUrl}>routes</Ext>):
      </Typography>
      {contract.requires.map((r) => {
        const info = routes?.get(r.route);
        return (
          <Typography
            key={r.route}
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ pl: 1 }}
          >
            <code>{r.route}</code> — {r.purpose}
            {info && info.params.length > 0 && (
              <>
                {" · params: "}
                {info.params.join(", ")}
                {isPaginated(info) && " (paginated)"}
              </>
            )}
            {info && info.formats.length > 0 && <>{" · formats: " + info.formats.join(", ")}</>}
          </Typography>
        );
      })}
      {example && (
        <Typography variant="caption" color="text.secondary">
          Example entity: <Ext href={example}>{shortIri(example)}</Ext>
        </Typography>
      )}
      {contract.lidsExamples.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="div">
          LIDS examples:{" "}
          {contract.lidsExamples.map((e, i) => (
            <span key={e.url}>
              {i ? " · " : ""}
              <Ext href={e.url}>{e.label}</Ext>
            </span>
          ))}
        </Typography>
      )}
    </Stack>
  );
}
