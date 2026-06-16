import { msg } from "../../lib/messages.ts";
import { Box } from "@mui/material";
import { useResolveOrg } from "../../hooks/queries.ts";
import {
  DetailRow,
  RdfSourceLink,
  SectionTitle,
  UriLink,
} from "../detail/DetailView.tsx";

/**
 * The agent's read-only profile facts: the WebID (the dereferenceable identity),
 * the organisation it represents when that resolves (`org:memberOf` → name), and
 * a dev-mode link to the backing profile resource — the WebID itself is the
 * Turtle document, so it doubles as the RDF source link.
 */
export default function AgentProfileSection({ webId }: { webId: string }) {
  const { data: org } = useResolveOrg(webId);
  return (
    <Box>
      <SectionTitle>{msg("secProfile")}</SectionTitle>
      <DetailRow label="WebID" value={<UriLink href={webId}>{webId}</UriLink>} />
      {org?.name && <DetailRow label={msg("lblOrganisation")} value={org.name} />}
      <RdfSourceLink href={webId} />
    </Box>
  );
}
