import Box from "@mui/material/Box";
import Pagination from "@mui/material/Pagination";
import Typography from "@mui/material/Typography";
import type { Paging } from "./usePaging.ts";

/**
 * Page control for the resource lists. Renders nothing for a single page, so
 * short lists are unaffected; for longer ones it shows numbered pages plus an
 * "x–y of N" summary.
 */
export default function Pager<T>({ paging }: { paging: Paging<T> }) {
  const { page, pageCount, total } = paging;
  if (pageCount <= 1) return null;
  const pageSize = Math.ceil(total / pageCount);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 1,
        mt: 1,
      }}
    >
      <Pagination
        count={pageCount}
        page={page}
        onChange={(_, p) => paging.setPage(p)}
        size="small"
        siblingCount={1}
      />
      <Typography variant="caption" color="text.secondary">
        {from}–{to} of {total}
      </Typography>
    </Box>
  );
}
