import { sessionGateway } from "../services/pod/podGateway.ts";
import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import { Session } from "@inrupt/solid-client-authn-browser";
import { useAgents, useSolidData } from "../hooks/queries.ts";
import { useRemoveAgent, useSaveAgent } from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { resolveAgent, webIdFragment } from "../services/agents/agentResolver.ts";
import { referencedAgentWebIds } from "../services/agents/agentAppearances.ts";
import type { SavedAgent } from "../services/savedAgents.ts";
import { formatError } from "../lib/formatError.ts";
import { useT } from "../context/I18nProvider.tsx";
import { useListFacet } from "../hooks/useListFacet.ts";
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

/** The finder's two source tiers (the agent-world analogue of the buildings
 *  own/shared/open facet): `saved` = in your address book; `referenced` = a party
 *  that appears in your data (a building's operator/owner/…) but isn't saved yet. */
const AGENT_TIERS = ["saved", "referenced"] as const;

/** One finder row: a WebID with its tier membership (an agent can be both). */
interface AgentRow {
  webId: string;
  saved?: SavedAgent;
  referenced: boolean;
}

/**
 * The Agents finder (`/agents`): the people and organisations you deal with. Two
 * tiers, unioned via a source facet (mirroring the Buildings finder's
 * mine/shared/open): **saved** agents (your address book, `agents.ttl`) and
 * **referenced** agents — every WebID that appears in your buildings
 * (`operatedBy`/`ownedBy`/`attributedTo`/…) but isn't saved yet, so a bulk-imported
 * portfolio's operators show up without first being remembered. A referenced agent
 * can be saved with one click; names/avatars resolve live from each agent's own
 * profile. Add by WebID/QR, or open any agent for its detail page.
 */
export default function AgentsFinder({ session }: AgentsFinderProps) {
  const { showNotification } = useNotification();
  const t = useT();

  const savedQuery = useAgents();
  const { buildings, isLoading: buildingsLoading } = useSolidData();
  const saveAgentMut = useSaveAgent();
  const removeAgentMut = useRemoveAgent();
  const [webIdInput, setWebIdInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const { query, setQuery } = useListSearch();
  const facet = useListFacet("tier", AGENT_TIERS);

  // Union the two tiers by WebID: a saved agent carries its record; a referenced one
  // is flagged. An agent that is both keeps its saved record + the referenced flag.
  const byId = new Map<string, AgentRow>();
  for (const a of savedQuery.data ?? []) {
    byId.set(a.webId, { webId: a.webId, saved: a, referenced: false });
  }
  for (const webId of referencedAgentWebIds(buildings)) {
    const existing = byId.get(webId);
    if (existing) existing.referenced = true;
    else byId.set(webId, { webId, referenced: true });
  }
  const agents = [...byId.values()];
  const savedCount = agents.filter((a) => a.saved).length;
  const referencedCount = agents.filter((a) => a.referenced).length;

  // Filter by the ticked tiers (union), then by the free-text search.
  const inFacet = (a: AgentRow) =>
    (a.saved != null && facet.isSelected("saved")) ||
    (a.referenced && facet.isSelected("referenced"));
  const visible = filterByText(
    agents.filter(inFacet),
    query,
    (a) => `${a.saved?.name ?? ""} ${a.webId}`,
  );
  const paging = usePaging(visible);

  /** Persist a WebID to the address book: write it NOW with the fragment name (it
   *  appears at once, never blocking on a slow/dead host), then refine name/avatar
   *  from the agent's profile in the BACKGROUND — mirroring `rememberAgent`. */
  const addToBook = async (webId: string) => {
    await saveAgentMut.mutateAsync({ webId, name: webIdFragment(webId) });
    showNotification(t("agentAdded"), "success");
    void resolveAgent(webId, sessionGateway(session))
      .then((agent) => saveAgentMut.mutateAsync(agent))
      .catch((e) => logError("upgrade added agent profile", e));
  };

  const handleAddFromInput = async () => {
    const webId = webIdInput.trim();
    if (!/^https?:\/\//i.test(webId)) {
      showNotification(t("enterWebId"), "error");
      return;
    }
    try {
      await addToBook(webId);
      setWebIdInput("");
    } catch (e) {
      showNotification(formatError("actionAddAgent", e), "error");
    }
  };

  // A scanned WebID QR (e.g. on a solidcommunity.net profile page) adds directly; the
  // input keeps the value so a failed resolve stays visible and editable.
  const handleScan = (text: string) => {
    setScanning(false);
    setWebIdInput(text.trim());
    void handleAddFromInput();
  };

  const handleSaveReferenced = (webId: string) =>
    addToBook(webId).catch((e) =>
      showNotification(formatError("actionAddAgent", e), "error")
    );

  const handleRemove = (webId: string) =>
    removeAgentMut.mutate(webId, {
      onSuccess: () => showNotification(t("agentRemoved"), "success"),
    });

  // Backing RDF resource (the address book), linked so storage is inspectable.
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const loading = savedQuery.isLoading || buildingsLoading;

  return (
    <FinderHeader
      title={t("navAgents")}
      count={agents.length}
      source={rdf?.savedAgents}
      inputs={
        <>
          <TextField
            size="small"
            label={t("lblWebId")}
            value={webIdInput}
            onChange={(e) => setWebIdInput(e.target.value)}
            sx={{ minWidth: 320 }}
          />
          <Button
            variant="outlined"
            aria-label={t("agentAddAria")}
            disabled={!webIdInput.trim() || saveAgentMut.isPending}
            onClick={handleAddFromInput}
          >
            {saveAgentMut.isPending ? t("addingEllipsis") : t("btnAdd")}
          </Button>
          {/* Opener only — the scanner's own Cancel button closes it. */}
          <Button
            variant="outlined"
            onClick={() => setScanning(true)}
            disabled={scanning}
          >
            {t("scanQrCode")}
          </Button>
        </>
      }
      controls={agents.length > 0 && (
        <>
          <ToggleButtonGroup
            size="small"
            value={facet.selected}
            onChange={(_, values: string[]) => facet.replace(values)}
            aria-label={t("agentTierFacetAria")}
          >
            <ToggleButton value="saved">
              {t("agentTierSaved")} ({savedCount})
            </ToggleButton>
            <ToggleButton value="referenced">
              {t("agentTierReferenced")} ({referencedCount})
            </ToggleButton>
          </ToggleButtonGroup>
          <SearchField value={query} onChange={setQuery} />
        </>
      )}
    >
      {scanning && (
        <QrScanner onResult={handleScan} onCancel={() => setScanning(false)} />
      )}
      {loading
        ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
        : agents.length === 0
        ? <Typography variant="body2">{t("agentsEmpty")}</Typography>
        : visible.length === 0
        ? <Typography variant="body2">{t("searchNoMatches", { query })}</Typography>
        : (
          <Box
            component="ul"
            aria-label={t("navAgents")}
            sx={{ listStyle: "none", pl: 0, m: 0 }}
          >
            {paging.pageItems.map((a) => (
              <ResourceRow
                key={a.webId}
                title={<strong><AgentLabel value={a.webId} /></strong>}
                subtitle={!a.saved ? t("agentReferencedHint") : undefined}
                actions={a.saved
                  ? (
                    <Tooltip title={t("agentRemoveAria")}>
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={t("agentRemoveAria")}
                        onClick={() => handleRemove(a.webId)}
                        disabled={removeAgentMut.isPending}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )
                  : (
                    <Tooltip title={t("agentSaveToBookAria")}>
                      <IconButton
                        size="small"
                        aria-label={t("agentSaveToBookAria")}
                        onClick={() => handleSaveReferenced(a.webId)}
                        disabled={saveAgentMut.isPending}
                      >
                        <PersonAddAlt1Icon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
              />
            ))}
          </Box>
        )}
      <Pager paging={paging} />
    </FinderHeader>
  );
}
