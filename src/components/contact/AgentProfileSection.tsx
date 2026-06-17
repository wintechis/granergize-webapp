import { msg } from "../../lib/messages.ts";
import { Box } from "@mui/material";
import { useResolveAgent, useResolveOrg } from "../../hooks/queries.ts";
import {
  DetailRow,
  RdfSourceLink,
  SectionTitle,
  UriLink,
} from "../detail/DetailView.tsx";

/**
 * The agent's read-only profile facts, read by dereferencing the WebID document:
 * the WebID itself (the dereferenceable identity), the organisation it represents
 * when that resolves (`org:memberOf` → name), and the contact facts the document
 * actually holds (postal address, e-mail, telephone, website). A dev-mode link to
 * the backing profile resource closes it out — the WebID *is* the Turtle document,
 * so it doubles as the RDF source link, and the long tail of triples beyond these
 * curated rows lives there.
 */
export default function AgentProfileSection({ webId }: { webId: string }) {
  const { data: agent } = useResolveAgent(webId);
  const { data: org } = useResolveOrg(webId);
  return (
    <Box>
      <SectionTitle>{msg("secProfile")}</SectionTitle>
      <DetailRow label="WebID" value={<UriLink href={webId}>{webId}</UriLink>} />
      {org?.name && <DetailRow label={msg("lblOrganisation")} value={org.name} />}
      {agent?.address && (
        <DetailRow label={msg("lblAddress")} value={agent.address} />
      )}
      {agent?.email && (
        <DetailRow
          label={msg("lblEmail")}
          value={
            <UriLink href={`mailto:${agent.email}`}>{agent.email}</UriLink>
          }
        />
      )}
      {agent?.phone && <DetailRow label={msg("lblPhone")} value={agent.phone} />}
      {agent?.website && (
        <DetailRow
          label={msg("lblWebsite")}
          value={<UriLink href={agent.website}>{agent.website}</UriLink>}
        />
      )}
      <RdfSourceLink href={webId} />
    </Box>
  );
}
