import { Link as RouterLink } from "react-router-dom";
import { Box, Button, Link, Typography } from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import "../guide.css";

/**
 * A captioned screenshot. Images live in `public/guide/`. If an image is missing
 * the whole figure hides itself (no broken-image icon, no orphan caption), so
 * the guide reads fine until the screenshots are added.
 */
function Figure({ src, caption }: { src: string; caption: string }) {
  return (
    <figure className="guide-figure">
      <img
        src={`${import.meta.env.BASE_URL}guide/${src}`}
        alt={caption}
        onError={(e) => {
          const fig = e.currentTarget.closest("figure");
          if (fig instanceof HTMLElement) fig.style.display = "none";
        }}
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/**
 * In-app **how-to-use** guide (German, "Kurzanleitung"). Task/step instructions
 * only. Reached at #/guide from the avatar menu. The "Als PDF
 * speichern" button prints this page via the browser (see guide.css for the
 * print/cover styling), so the PDF stays in sync with the app.
 */
export default function GuidePage() {
  return (
    <Box className="guide" sx={{ p: 3 }}>
      {/* On-screen toolbar — hidden when printing. */}
      <Box
        className="no-print"
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 2,
          mb: 3,
        }}
      >
        <Link component={RouterLink} to="/">🠠 Zurück zur App</Link>
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="outlined"
          startIcon={<PictureAsPdfIcon />}
          onClick={() => globalThis.print()}
        >
          Als PDF speichern
        </Button>
      </Box>

      {/* Print-only cover page. */}
      <div className="guide-cover">
        <Typography variant="h3" gutterBottom>Granergize</Typography>
        <Typography variant="h5" color="text.secondary">Kurzanleitung</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
          So nutzen Sie die Granergize-Webanwendung
        </Typography>
      </div>

      <Typography variant="h4" gutterBottom>Granergize – Kurzanleitung</Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Diese Anleitung beschreibt Schritt für Schritt, wie Sie die
        Granergize-Webanwendung bedienen: vom Einrichten Ihres Solid Pods über
        das Anmelden und Hinzufügen von Gebäuden bis zum Teilen von Daten.
      </Typography>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          1. Was Sie brauchen
        </Typography>
        <Typography variant="body1">
          Sie benötigen lediglich einen aktuellen Webbrowser (Chrome, Edge,
          Firefox oder Safari) und einen <strong>Solid Pod</strong> – Ihren
          persönlichen Datenspeicher im Internet. Ihre Gebäude- und Energiedaten
          bleiben auf Ihrem Pod; die Anwendung greift nur mit Ihrer Erlaubnis
          darauf zu. Es ist keine Installation nötig.
        </Typography>
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          2. Solid Pod einrichten
        </Typography>
        <ol>
          <li>
            Öffnen Sie{" "}
            <Link
              href="https://solidcommunity.net/"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://solidcommunity.net/
            </Link>{" "}
            und klicken Sie auf <em>Sign up</em> bzw. <em>Register</em>.
          </li>
          <li>
            Wählen Sie einen Benutzernamen. Daraus ergibt sich Ihre{" "}
            <strong>WebID</strong> (z. B.{" "}
            <code>https://max.solidcommunity.net/profile/card#me</code>) – Ihre
            digitale Kennung.
          </li>
          <li>
            Geben Sie E-Mail-Adresse und ein sicheres Passwort an und legen Sie
            den Pod an.
          </li>
          <li>
            <strong>Notieren Sie sich Ihre WebID.</strong> Sie benötigen sie zum
            Anmelden und damit andere Daten mit Ihnen teilen können.
          </li>
        </ol>
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          3. Anmelden
        </Typography>
        <ol>
          <li>Öffnen Sie die Granergize-Webanwendung in Ihrem Browser.</li>
          <li>
            Wählen Sie unter „Sign in with an Identity Provider“ einen der
            vorgegebenen Identity Provider (z. B. solidcommunity.net) oder geben
            Sie unter „Sign in with another Identity Provider“ die Adresse Ihres
            eigenen Identity Providers ein.
          </li>
          <li>
            Melden Sie sich beim Anbieter an und <strong>bestätigen</strong> Sie,
            dass Granergize auf Ihren Pod zugreifen darf. Diese Berechtigung
            können Sie jederzeit widerrufen.
          </li>
        </ol>
        <Figure src="anmelden.png" caption="Anmeldung: Identity Provider wählen" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          4. Einem Raum beitreten oder einen Raum erstellen
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          Ein <strong>Raum</strong> bündelt die Akteure, die untereinander Daten
          teilen. Er ist die Grundlage für das rollenbasierte Teilen (siehe
          Schritt 7). Im Tab <strong>Connect</strong>:
        </Typography>
        <ul>
          <li>
            <strong>Raum erstellen:</strong> „Host a data room“ legt einen Raum
            auf Ihrem Pod an. Teilen Sie dessen Link oder QR-Code, damit andere
            beitreten können.
          </li>
          <li>
            <strong>Beitreten:</strong> Fügen Sie eine Raum-URI in das Feld ein
            und klicken Sie auf „Add“, oder nutzen Sie „Scan QR code“, um einen
            angezeigten Code abzuscannen.
          </li>
          <li>
            <strong>Rolle wählen:</strong> Weisen Sie sich Ihre Rolle(n) zu –
            <strong>User</strong>, <strong>Investor</strong> oder{" "}
            <strong>Benchmark Service Provider</strong> – und speichern Sie mit
            „Save roles“. Über diese Rollen können andere gezielt „By role“ mit
            Ihnen teilen. Die Rolle ist unabhängig von der Mitgliedschaft und
            jederzeit änderbar.
          </li>
        </ul>
        <Figure src="room.png" caption="Tab „Connect“: Raum erstellen oder beitreten und Rolle wählen" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          5. Gebäude hinzufügen
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          Im Tab <strong>Manage</strong> unter „Your buildings“:
        </Typography>
        <ul>
          <li>
            <strong>Add Building:</strong> Ein einzelnes Gebäude über das
            Formular erfassen (Adresse, Koordinaten, Fläche usw.).
          </li>
          <li>
            <strong>Autofill from file:</strong> Mehrere Gebäude auf einmal aus
            einer Excel-Datei importieren. Die eingelesenen Gebäude können Sie vor
            dem Speichern prüfen und anpassen.
          </li>
        </ul>
        <Figure src="add-building.png" caption="Tab „Manage“: das Formular „Add Building“ zum Erfassen eines Gebäudes" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          6. Daten ansehen
        </Typography>
        <Typography variant="body1">
          Wählen Sie im Tab <strong>Explore</strong> einen Gebäude-Marker. Im rechten
          Bereich wechseln Sie über die Reiter zwischen <strong>Building data</strong>,{" "}
          <strong>Energy data</strong> und <strong>Weather data</strong>. Unter der
          Karte sehen Sie den Energiemix für den aktuell sichtbaren Kartenausschnitt.
        </Typography>
        <Figure src="map-tabs.png" caption="Gebäudedetails im Explore-Tab mit Reitern" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          7. Gebäude teilen, exportieren und Zugriff widerrufen
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          Im Tab <strong>Manage</strong> hat jedes Gebäude unter „Your buildings“
          eigene Symbole zum Bearbeiten, Teilen, Herunterladen und Löschen.
        </Typography>
        <ol>
          <li>
            <strong>Teilen:</strong> Klicken Sie beim gewünschten Gebäude auf das
            Teilen-Symbol. Im Dialog wählen Sie, an wen geteilt wird:{" "}
            <strong>By WebID</strong> (eine oder mehrere WebIDs eingeben) oder{" "}
            <strong>By role</strong> (eine Rolle wählen – geteilt wird dann mit
            allen Raum-Mitgliedern, die diese Rolle haben).
          </li>
          <li>
            Wählen Sie, welche Daten geteilt werden: „Static building data only“
            (nur Stammdaten) oder „Static building data and energy readings“
            (zusätzlich die Verbrauchsdaten). Dann auf <em>Share</em> klicken.
          </li>
          <li>
            <strong>Exportieren:</strong> Über das Download-Symbol speichern Sie
            die Daten eines Gebäudes als Turtle-Datei.
          </li>
          <li>
            <strong>Widerrufen:</strong> Beim jeweiligen Gebäude unter „Shared
            with:“ entfernen Sie einen Empfänger über das Lösch-Symbol. Hinweis:
            Der Empfänger wird darüber nicht benachrichtigt.
          </li>
        </ol>
        <Figure src="share-building.png" caption="Tab „Manage“: Pro Gebäude die Symbole zum Bearbeiten, Teilen, Herunterladen und Löschen" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          8. Mit Ihnen geteilte Daten
        </Typography>
        <Typography variant="body1">
          Gebäude, die andere mit Ihnen geteilt haben, finden Sie im Tab{" "}
          <strong>Share</strong> unter „Buildings shared with you“. Sie erscheinen
          zusätzlich auf der Karte im Tab <strong>Explore</strong>, sodass Sie sie
          gemeinsam mit Ihren eigenen Gebäuden auswerten können.
        </Typography>
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          9. Aggregierte Ansicht erstellen und teilen
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          Aggregierte Ansichten („Views“) fassen mehrere Gebäude zu Durchschnitt,
          Summe, Minimum oder Maximum zusammen – ohne Einzelgebäude offenzulegen.
          Im Tab <strong>Manage</strong> unter „Aggregated views“:
        </Typography>
        <ol>
          <li>
            „Create View“ öffnen, einen Namen vergeben, Gebäude und Kennzahlen
            sowie die Aggregatsfunktion wählen und erstellen.
          </li>
          <li>
            Die fertige Ansicht über den Teilen-Button mit der WebID des
            Empfängers teilen.
          </li>
        </ol>
        <Figure src="create-view.png" caption="Create-View-Dialog" />
      </Box>
    </Box>
  );
}
