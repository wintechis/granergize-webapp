import { Divider, Stack } from "@mui/material";
import ContactHeader from "../components/contact/ContactHeader.tsx";
import AgentProfileSection from "../components/contact/AgentProfileSection.tsx";
import AppearsInSection from "../components/contact/AppearsInSection.tsx";

/**
 * Standalone read-first detail page for an agent (a party referenced by a
 * building's operatedBy / ownedBy / investor / attributedTo / …). Reached by
 * clicking an agent anywhere it's surfaced ({@link AgentLabel} → /contact/:webId),
 * routing through contacts rather than opening the raw WebID off-app. Read-first
 * scrolling sections in the building-page master-detail style; a contact is
 * someone else's WebID, so every section is read-only. As a standalone full-page
 * route it carries its own plain "Loading…" text (the header activity indicator
 * isn't mounted here — see the loading-spinner policy).
 */
export default function Contact({ webId }: { webId: string }) {
  return (
    <Stack spacing={3} divider={<Divider />}>
      <ContactHeader webId={webId} />
      <AgentProfileSection webId={webId} />
      <AppearsInSection webId={webId} />
    </Stack>
  );
}
