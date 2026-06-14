import { Avatar, Box, Chip, type ChipProps } from "@mui/material";
import { useResolveAgent } from "../hooks/queries.ts";
import { RefLink } from "./detail/DetailView.tsx";

/**
 * Render a referenced agent. `value` is either a WebID IRI — resolved (name +
 * avatar) and shown as an avatar + a link to its in-app contact detail view
 * (`/contact/:webId`) — or a free-text name (e.g. a `customer`/`investor` that
 * holds a plain name rather than a WebID), shown as plain text. This is the one way
 * the app surfaces an agent reference; it replaces the old `createAgentLink`, which
 * crashed (`new URL(value)`) on a non-URL name.
 *
 * Per the loading policy there is no spinner while resolving: until the name
 * arrives the WebID `#fragment` stands in (today's behaviour).
 */
export function AgentLabel({ value }: { value: string }) {
  // Hooks run unconditionally; the query is disabled for a non-WebID value.
  const webId = isWebId(value) ? value : undefined;
  const { data } = useResolveAgent(webId);

  if (!webId) return <>{value}</>;

  const name = data?.name ?? fragmentOf(value);
  const avatarUrl = data?.avatarUrl;
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
    >
      <Avatar
        component="span"
        src={avatarUrl}
        // eslint-disable-next-line no-restricted-syntax -- initials scale with the small avatar box, not a text tier
        sx={{ width: 22, height: 22, fontSize: "0.7rem" }}
      >
        {avatarUrl ? null : initials(name)}
      </Avatar>
      <RefLink to={`/contact/${encodeURIComponent(value)}`}>{name}</RefLink>
    </Box>
  );
}

/**
 * The chip-shaped sibling of {@link AgentLabel}: avatar + resolved name as an
 * MUI Chip, no navigation (a link inside a removable token would fight its
 * delete affordance). For places where agents appear as tokens — the share
 * dialog's recipient chips and its confirm list — so a picked recipient reads
 * as a person, not a raw IRI. The IRI stays discoverable via the title
 * attribute. Until (or unless) a name resolves, the WebID fragment stands in.
 */
export function AgentChip({ value, ...chipProps }: { value: string } & ChipProps) {
  const webId = isWebId(value) ? value : undefined;
  const { data } = useResolveAgent(webId);
  const name = webId ? data?.name ?? fragmentOf(value) : value;
  const avatarUrl = data?.avatarUrl;
  return (
    <Chip
      avatar={
        <Avatar src={avatarUrl}>{avatarUrl ? null : initials(name)}</Avatar>
      }
      label={name}
      title={value}
      {...chipProps}
    />
  );
}

/** A value we can resolve against a profile (an http(s) WebID), vs free text. */
function isWebId(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** The local name of a WebID (fragment after `#`, else last path segment). */
function fragmentOf(value: string): string {
  const hash = value.split("#")[1];
  if (hash) return hash;
  const path = value.split("/").filter(Boolean);
  return path[path.length - 1] ?? value;
}

/** Up-to-two-letter initials for the avatar fallback. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
