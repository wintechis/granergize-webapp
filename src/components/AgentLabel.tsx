import { Avatar, Box } from "@mui/material";
import { useResolveAgent } from "../hooks/queries.ts";
import { UriLink } from "./detail/DetailView.tsx";

/**
 * Render a referenced agent. `value` is either a WebID IRI — resolved (name +
 * avatar) and shown as an avatar + external link — or a free-text name (e.g. a
 * `customer`/`investor` that holds a plain name rather than a WebID), shown as
 * plain text. This is the one way the app surfaces an agent reference; it replaces
 * the old `createAgentLink`, which crashed (`new URL(value)`) on a non-URL name.
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
      <UriLink href={value}>{name}</UriLink>
    </Box>
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
