import { useState } from "react";
import IconAction from "../components/IconAction.tsx";
import { getGateway } from "../hooks/session.ts";
import {
  Box,
  Button,
  TextField,
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
import { referencedAgentTiers } from "../services/agents/agentAppearances.ts";
import type { SavedAgent } from "../services/savedAgents.ts";
import { formatError } from "../lib/formatError.ts";
import { useT } from "../context/I18nProvider.tsx";
import { useListFacet } from "../hooks/useListFacet.ts";
import { AGENT_TIERS, type Tier } from "../constants/tiers.ts";
import TierFilter from "../components/TierFilter.tsx";
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

/** One finder row: a WebID with its provenance tier(s) and address-book record (an
 *  agent can hold several tiers — saved AND referenced by an own + a shared building). */
interface AgentRow {
  webId: string;
  saved?: SavedAgent;
  tiers: Set<Tier>;
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
  const facet = useListFacet("tiers", AGENT_TIERS);

  // Union by WebID into provenance tiers (mine/shared/open — the same source facet the
  // other finders wear): a saved agent is `mine` (your address book); a referenced one
  // takes the tier(s) of the buildings it appears in (referencedAgentTiers). An agent
  // both saved AND referenced in a shared building holds `mine` + `shared`.
  const tierOf = referencedAgentTiers(buildings);
  const byId = new Map<string, AgentRow>();
  for (const a of savedQuery.data ?? []) {
    byId.set(a.webId, { webId: a.webId, saved: a, tiers: new Set<Tier>(["mine"]) });
  }
  for (const [webId, tiers] of tierOf) {
    const row = byId.get(webId) ?? { webId, tiers: new Set<Tier>() };
    for (const t of tiers) row.tiers.add(t);
    byId.set(webId, row);
  }
  const agents = [...byId.values()];
  const tierCount = (t: Tier) => agents.filter((a) => a.tiers.has(t)).length;

  // Filter by the ticked tiers (union), then by the free-text search.
  const inFacet = (a: AgentRow) => [...a.tiers].some((t) => facet.isSelected(t));
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
    void resolveAgent(webId, getGateway())
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
          <SearchField value={query} onChange={setQuery} />
          <TierFilter
            facet={facet}
            options={AGENT_TIERS}
            counts={{
              mine: tierCount("mine"),
              shared: tierCount("shared"),
              open: tierCount("open"),
            }}
          />
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
                    <IconAction
  label={t("agentRemoveAria")}
  icon={<DeleteIcon fontSize="small" />}
  color="error"
  disabled={removeAgentMut.isPending}
  onClick={() => handleRemove(a.webId)}
/>
                  )
                  : (
                    <IconAction
                      label={t("agentSaveToBookAria")}
                      icon={<PersonAddAlt1Icon fontSize="small" />}
                      disabled={saveAgentMut.isPending}
                      onClick={() => handleSaveReferenced(a.webId)}
                    />
                  )}
              />
            ))}
          </Box>
        )}
      <Pager paging={paging} />
    </FinderHeader>
  );
}
