import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import { useContacts } from "../hooks/queries.ts";
import { useRemoveContact, useSaveContact } from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { resolveAgent, webIdFragment } from "../services/agents/agentResolver.ts";
import { formatError } from "../lib/formatError.ts";
import { useT } from "../context/I18nProvider.tsx";
import { RdfSourceLink } from "../components/detail/DetailView.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
import ResourceRow from "../components/ResourceRow.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import QrScanner from "../components/QrScanner.tsx";
import { logError } from "../lib/logError.ts";

interface ContactsFinderProps {
  session: Session;
}

/**
 * The Contacts finder (`/contacts`): a personal address book of WebID agents.
 * Referenced agents (share recipients, building operators) are auto-remembered
 * here; you can also add or remove one by hand. Names/avatars are resolved live
 * from each agent's own profile. Split out of the former Connect page (rooms +
 * contacts).
 */
export default function ContactsFinder({ session }: ContactsFinderProps) {
  const { showNotification } = useNotification();
  const t = useT();

  const contactsQuery = useContacts();
  const contacts = contactsQuery.data ?? [];
  const saveContact = useSaveContact();
  const removeContact = useRemoveContact();
  const [contactInput, setContactInput] = useState("");
  const contactPaging = usePaging(contacts);
  // Whether the QR scanner (one camera view) is open: a scanned code adds a
  // contact by WebID.
  const [scanning, setScanning] = useState(false);

  /** Add a contact: resolve the WebID's name/avatar, then persist it. */
  const addContact = async (webId: string) => {
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
      showNotification(t("contactAdded"), "success");
      void resolveAgent(webId, session)
        .then((agent) => saveContact.mutateAsync(agent))
        .catch((e) => logError("upgrade added contact profile", e));
    } catch (e) {
      showNotification(formatError("actionAddContact", e), "error");
    }
  };

  const handleAddContact = () => addContact(contactInput.trim());

  // A scanned WebID QR (e.g. the one on a solidcommunity.net profile page)
  // is added directly; the input keeps the value so a failed resolve stays
  // visible and editable.
  const handleContactScan = (text: string) => {
    setScanning(false);
    const webId = text.trim();
    setContactInput(webId);
    // addContact catches its own errors (notifies on failure), so its promise
    // never rejects — float it intentionally.
    void addContact(webId);
  };

  const handleRemoveContact = (webId: string) =>
    removeContact.mutate(webId, {
      onSuccess: () => showNotification(t("contactRemoved"), "success"),
    });

  // Backing RDF resource (the contacts), linked so storage is inspectable.
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;

  return (
    <Box component="section" sx={{ p: 3, flexGrow: 1, minHeight: 0, overflow: "auto" }}>
      {/* Contacts — a personal address book of WebID agents. */}
      <Typography variant="h6" sx={{ mb: 1 }}>Contacts</Typography>
      {rdf && <RdfSourceLink href={rdf.contacts} />}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mb: 1 }}>
        <TextField
          size="small"
          label="WebID"
          value={contactInput}
          onChange={(e) => setContactInput(e.target.value)}
          sx={{ minWidth: 320 }}
        />
        <Button
          variant="outlined"
          aria-label="Add contact"
          disabled={!contactInput.trim() || saveContact.isPending}
          onClick={handleAddContact}
        >
          {saveContact.isPending ? "Adding…" : "Add"}
        </Button>
        {/* Opener only — the scanner's own Cancel button (right under the
            camera view) is the one way to close it. */}
        <Button
          variant="outlined"
          onClick={() => setScanning(true)}
          disabled={scanning}
        >
          Scan QR code
        </Button>
      </Stack>
      {scanning && (
        <QrScanner
          onResult={handleContactScan}
          onCancel={() => setScanning(false)}
        />
      )}
      {contactsQuery.isLoading
        ? <Typography variant="body2">Loading…</Typography>
        : contacts.length === 0
        ? (
          <Typography variant="body2">
            {t("contactsEmpty")}
          </Typography>
        )
        : (
          <Box component="ul" aria-label="Contacts" sx={{ listStyle: "none", pl: 0, m: 0 }}>
            {contactPaging.pageItems.map((c) => (
              <ResourceRow
                key={c.webId}
                title={<AgentLabel value={c.webId} />}
                actions={
                  <Tooltip title="Remove contact">
                    <IconButton
                      size="small"
                      color="error"
                      aria-label="Remove contact"
                      onClick={() => handleRemoveContact(c.webId)}
                      disabled={removeContact.isPending}
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
    </Box>
  );
}
