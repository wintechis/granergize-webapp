import { Box, Button, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import {
  useContacts,
  useResolveAgent,
  useResolveOrgLogo,
  useSolidData,
} from "../hooks/queries.ts";
import { useSaveContact } from "../hooks/mutations.ts";
import {
  DetailCard,
  DetailRow,
  RefLink,
  SectionTitle,
  UriLink,
} from "../components/detail/DetailView.tsx";
import { appearancesOf } from "../services/agents/agentAppearances.ts";
import type { BuildingType } from "../types.ts";

/** Display label for a building row (address, else its id). */
function buildingLabel(b: BuildingType): string {
  const addr = b.streetAddress?.toString().trim();
  return addr && addr.length > 0 ? addr : `Building ${b.id}`;
}

/**
 * Standalone detail view for an agent (a party referenced by a building's
 * customer/operatedBy/investor/attributedTo). Resolves the agent's profile
 * (name/avatar) and organisation logo, lists the buildings the agent appears in,
 * and offers "Add to contacts" when the agent isn't yet in the address book.
 *
 * It's reached by clicking an agent anywhere it's surfaced ({@link AgentLabel}),
 * routing through contacts rather than opening the raw WebID off-app. As a
 * standalone full-page route it carries its own plain "Loading…" text (the header
 * activity indicator isn't mounted here — see the loading-spinner policy).
 */
export default function Contact({ webId }: { webId: string }) {
  const { data: agent } = useResolveAgent(webId);
  const { data: orgLogo } = useResolveOrgLogo(webId);
  const { buildings, isLoading } = useSolidData();
  const contacts = useContacts();
  const saveContact = useSaveContact();

  const name = agent?.name ?? webId;
  const known = (contacts.data ?? []).some((c) => c.webId === webId);
  const appearances = appearancesOf(webId, buildings);

  return (
    <DetailCard
      icon={<PersonIcon />}
      title={name}
      action={!known && contacts.isSuccess
        ? (
          <Button
            size="small"
            variant="outlined"
            disabled={saveContact.isPending}
            onClick={() =>
              saveContact.mutate({
                webId,
                name: agent?.name,
                avatarUrl: agent?.avatarUrl,
              })}
          >
            {saveContact.isPending ? "Adding…" : "Add to contacts"}
          </Button>
        )
        : undefined}
      spacing={2}
    >
      {orgLogo && (
        <Box
          component="img"
          src={orgLogo}
          alt=""
          sx={{ maxHeight: 48, maxWidth: 200, objectFit: "contain" }}
        />
      )}

      <DetailRow label="WebID" value={<UriLink href={webId}>{webId}</UriLink>} />

      <Box>
        <SectionTitle divider>Appears in</SectionTitle>
        {isLoading ? <Typography>Loading…</Typography> : (
          appearances.length === 0
            ? (
              <Typography color="text.secondary">
                Not referenced by any building you can see.
              </Typography>
            )
            : (
              appearances.map(({ building, roles }) => (
                <DetailRow
                  key={building.id}
                  label={roles.join(", ")}
                  value={
                    <RefLink to={`/building/${building.id}`}>
                      {buildingLabel(building)}
                    </RefLink>
                  }
                  dense
                />
              ))
            )
        )}
      </Box>

      <RefLink to="/">🠠 Back to map overview</RefLink>
    </DetailCard>
  );
}
