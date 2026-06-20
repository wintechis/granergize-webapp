import Typography from "@mui/material/Typography";

/**
 * A muted "(n)" item-count suffix for a list-only finder heading — overview-first,
 * hidden when empty. The single-list counterpart to the tiered finders' per-tier
 * "(n)" on the {@link import("./TierFilter.tsx").default}, so every finder reads out
 * how big its collection is.
 */
export default function TitleCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Typography
      component="span"
      variant="body1"
      color="text.secondary"
      sx={{ ml: 1 }}
    >
      ({count})
    </Typography>
  );
}
