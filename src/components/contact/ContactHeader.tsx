import { Box, Button, Stack, Typography } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import {
  useContacts,
  useResolveAgent,
  useResolveOrg,
} from "../../hooks/queries.ts";
import { useSaveContact } from "../../hooks/mutations.ts";
import { BackLink } from "../detail/DetailView.tsx";

/**
 * The contact page's header (mirrors BuildingHeader): a back link, the agent's
 * identity (person icon + resolved name, WebID fragment until a profile name
 * resolves), the producing org's logo when present, and the page's one action —
 * "Add to contacts" — shown only while the agent isn't already in the address
 * book. A contact is another agent's WebID, so the page is read-only otherwise.
 */
export default function ContactHeader({ webId }: { webId: string }) {
  const { data: agent } = useResolveAgent(webId);
  const { data: org } = useResolveOrg(webId);
  const contacts = useContacts();
  const saveContact = useSaveContact();

  const name = agent?.name ?? webId;
  const known = (contacts.data ?? []).some((c) => c.webId === webId);

  return (
    <Box>
      <BackLink />
      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 1, alignItems: "center" }}
      >
        <PersonIcon color="action" />
        <Typography variant="h5" sx={{ flexGrow: 1 }}>{name}</Typography>
        {!known && contacts.isSuccess && (
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
        )}
      </Stack>
      {org?.logoUrl && (
        <Box
          component="img"
          src={org.logoUrl}
          alt={org.name ?? ""}
          title={org.name}
          sx={{ mt: 1, maxHeight: 48, maxWidth: 200, objectFit: "contain" }}
        />
      )}
    </Box>
  );
}
