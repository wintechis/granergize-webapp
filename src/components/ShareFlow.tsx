import type { ReactNode } from "react";
import { Alert, Box } from "@mui/material";
import { AgentChip } from "./AgentLabel.tsx";

/**
 * The share-flow blocks BOTH share dialogs render identically
 * (`ShareBuildingDialog`, `ShareAggregationDialog`): the success `<Alert>`
 * naming the recipients, and the confirm-step recipient preview. One home so
 * the two flows can't drift in look or wording (they once duplicated ~150
 * lines of this).
 */

/** A row of recipient chips (the WebIDs resolve to agent labels). */
function RecipientChips({ recipients }: { recipients: readonly string[] }) {
  return (
    <>
      {recipients.map((r) => (
        <AgentChip key={r} value={r} size="small" variant="outlined" />
      ))}
    </>
  );
}

/** The persistent in-context success state: "Shared with" + recipient chips. */
export function ShareSuccessAlert(
  { label, recipients }: { label: string; recipients: readonly string[] },
) {
  return (
    <Alert severity="success" sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
        {label} <RecipientChips recipients={recipients} />
      </Box>
    </Alert>
  );
}

/** The confirm step's "sharing with these recipients" preview. */
export function ShareRecipientsPreview(
  { label, recipients, children }: {
    label: ReactNode;
    recipients: readonly string[];
    children?: ReactNode;
  },
) {
  return (
    <>
      <Box sx={{ mb: 2 }}>{label}</Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
        <RecipientChips recipients={recipients} />
      </Box>
      {children}
    </>
  );
}
