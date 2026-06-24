import { Divider, Stack } from "@mui/material";
import AgentHeader from "../components/agent/AgentHeader.tsx";
import AgentProfileSection from "../components/agent/AgentProfileSection.tsx";
import AppearsInSection from "../components/agent/AppearsInSection.tsx";

/**
 * Standalone read-first detail page for an agent — a person or organisation
 * referenced by a building's operatedBy / ownedBy / investor / attributedTo / …, or
 * any saved contact. Reached by clicking an agent anywhere it's surfaced
 * ({@link AgentLabel} → `/agent?uri=<webId>`), routing in-app rather than opening the
 * raw WebID off-app. Read-first scrolling sections in the building-page master-detail
 * style. The agent's own profile / appears-in sections are read-only (their Pod isn't
 * ours to write) — but the header's stored label and the local annotations (kind,
 * org fields, "works for") are yours to edit (an inline `[Edit]`). As a standalone
 * full-page route it carries its own plain "Loading…" text (the header activity
 * indicator isn't mounted here — see the loading-spinner policy).
 */
export default function Agent({ webId }: { webId: string }) {
  return (
    <Stack spacing={3} divider={<Divider />}>
      <AgentHeader webId={webId} />
      <AgentProfileSection webId={webId} />
      <AppearsInSection webId={webId} />
    </Stack>
  );
}
