import { useState } from "react";
import { Pager } from "webapp";

// The list pager — "Page X of Y" with prev/next, as it sits under a finder list.
export function MidList() {
  const [page, setPage] = useState(2);
  return (
    <Pager
      paging={{ page, pageCount: 5, pageItems: [], total: 48, setPage }}
    />
  );
}

// First page — the "previous" affordance is disabled at the start.
export function FirstPage() {
  const [page, setPage] = useState(1);
  return (
    <Pager
      paging={{ page, pageCount: 3, pageItems: [], total: 27, setPage }}
    />
  );
}
