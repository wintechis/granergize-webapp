import { sessionGateway } from "../services/pod/podGateway.ts";
import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import { useAgents } from "../hooks/queries.ts";
import { useRemoveAgent, useSaveAgent } from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { resolveAgent, webIdFragment } from "../services/agents/agentResolver.ts";
import { formatError } from "../lib/formatError.ts";
import { useT } from "../context/I18nProvider.tsx";
import FinderHeader from "../components/FinderHeader.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
import ResourceRow from "../components/ResourceRow.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import SearchField from "../components/SearchField.tsx";
import { filterByText } from "../lib/textSearch.ts";
import QrScanner from "../components/QrScanner.tsx";
import { logError } from "../lib/logError.ts";

interface AgentsFinderProps {
  session: Session;
}

/**
 * The Agents finder (`/agents`): a personal address book of WebID agents.
 * Referenced agents (share recipients, building operators) are auto-remembered
 * here; you can also add or remove one by hand. Names/avatars are resolved live
 * from each agent's own profile. Split out of the former Connect page (rooms +
 * contacts).
 */
export default function AgentsFinder({ session }: AgentsFinderProps) {
  const { showNotification } = useNotification();
  const t = useT();

  const contactsQuery = useAgents();
  const contacts = contactsQuery.data ?? [];
  const saveContact = useSaveAgent();
  const removeAgent = useRemoveAgent();
  const [contactInput, setContactInput] = useState("");
  const { query, setQuery } = useListSearch();
  const filteredContacts = filterByText(
    contacts,
    query,
    (c) => `${c.name ?? ""} ${c.webId}`,
  );
  const contactPaging = usePaging(filteredContacts);
  // Whether the QR scanner (one camera view) is open: a scanned code adds a
  // contact by WebID.
  const [scanning, setScanning] = useState(false);

  /** Add a contact: resolve the WebID's name/avatar, then persist it. */
  const saveAgent = async (webId: string) => {
    if (!/^https?:\/\//i.test(webId)) {
      showNotification(t("enterWebId"), "error");
      return;
    }
    try {
      // Write the contact NOW with the WebID's fragment name — it appears at once and
      // the add never blocks on a slow/dead WebID host. Refine name/avatar from the
      // agent's profile in the BACKGROUND, mirroring `rememberAgent`'s design (the
      // resolve reads the agent's own profile, which can retry for many seconds).
      await saveContact.mutateAsync({ webId, name: webIdFragment(webId) });
      setContactInput("");
      showNotification(t("agentAdded"), "success");
      void resolveAgent(webId, sessionGateway(session))
        .then((agent) => saveContact.mutateAsync(agent))
        .catch((e) => logError("upgrade added contact profile", e));
    } catch (e) {
      showNotification(formatError("actionAddAgent", e), "error");
    }
  };

  const handleAddContact = () => saveAgent(contactInput.trim());

  // A scanned WebID QR (e.g. the one on a solidcommunity.net profile page)
  // is added directly; the input keeps the value so a failed resolve stays
  // visible and editable.
  const handleContactScan = (text: string) => {
    setScanning(false);
    const webId = text.trim();
    setContactInput(webId);
    // saveAgent catches its own errors (notifies on failure), so its promise
    // never rejects — float it intentionally.
    void saveAgent(webId);
  };

  const handleRemoveAgent = (webId: string) =>
    removeAgent.mutate(webId, {
      onSuccess: () => showNotification(t("agentRemoved"), "success"),
    });

  // Backing RDF resource (the contacts), linked so storage is inspectable.
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;

  return (
    <FinderHeader
      title={t("navAgents")}
      count={contacts.length}
      source={rdf?.savedAgents}
      inputs={
        <>
          <TextField
            size="small"
            label={t("lblWebId")}
            value={contactInput}
            onChange={(e) => setContactInput(e.target.value)}
            sx={{ minWidth: 320 }}
          />
          <Button
            variant="outlined"
            aria-label={t("agentAddAria")}
            disabled={!contactInput.trim() || saveContact.isPending}
            onClick={handleAddContact}
          >
            {saveContact.isPending ? t("addingEllipsis") : t("btnAdd")}
          </Button>
          {/* Opener only — the scanner's own Cancel button (right under the
              camera view) is the one way to close it. */}
          <Button
            variant="outlined"
            onClick={() => setScanning(true)}
            disabled={scanning}
          >
            {t("scanQrCode")}
          </Button>
        </>
      }
      controls={contacts.length > 0 && (
        <SearchField value={query} onChange={setQuery} />
      )}
    >
      {scanning && (
        <QrScanner
          onResult={handleContactScan}
          onCancel={() => setScanning(false)}
        />
      )}
      {contactsQuery.isLoading
        ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
        : contacts.length === 0
        ? (
          <Typography variant="body2">
            {t("agentsEmpty")}
          </Typography>
        )
        : filteredContacts.length === 0
        ? (
          <Typography variant="body2">
            {t("searchNoMatches", { query })}
          </Typography>
        )
        : (
          <Box component="ul" aria-label={t("navAgents")} sx={{ listStyle: "none", pl: 0, m: 0 }}>
            {contactPaging.pageItems.map((c) => (
              <ResourceRow
                key={c.webId}
                title={<strong><AgentLabel value={c.webId} /></strong>}
                actions={
                  <Tooltip title={t("agentRemoveAria")}>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={t("agentRemoveAria")}
                      onClick={() => handleRemoveAgent(c.webId)}
                      disabled={removeAgent.isPending}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              />
            ))}
          </Box>
        )}
      <Pager paging={contactPaging} />
    </FinderHeader>
  );
}
