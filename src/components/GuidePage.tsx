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
 * only. Reached at #/guide from the footer and the avatar menu. The "Als PDF
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
            Wählen Sie einen empfohlenen Identity Provider (z. B.
            solidcommunity.net) oder geben Sie unter „Sign in with a new
            provider“ eine eigene Provider-Adresse ein.
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
          teilen. Im Tab <strong>Room</strong>:
        </Typography>
        <ul>
          <li>
            <strong>Raum erstellen:</strong> „Create a room“ legt einen Raum auf
            Ihrem Pod an. Teilen Sie dessen URI oder QR-Code, damit andere
            beitreten können.
          </li>
          <li>
            <strong>Beitreten:</strong> Fügen Sie eine Raum-URI ein oder scannen
            Sie den QR-Code und klicken Sie „Add yourself to the data room“.
          </li>
          <li>
            <strong>Rolle wählen:</strong> Weisen Sie sich Ihre Rolle(n) zu –
            Investor, User oder Benchmark Service Provider. Die Rolle ist
            unabhängig von der Mitgliedschaft und jederzeit änderbar.
          </li>
        </ul>
        <Figure src="room.png" caption="Room-Tab: Raum erstellen oder beitreten" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          5. Gebäude hinzufügen
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          Im Tab <strong>Sharing</strong> unter „Buildings you own“:
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
        <Figure src="add-building.png" caption="„Buildings you own“ mit Add Building und Autofill from file" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          6. Daten ansehen
        </Typography>
        <Typography variant="body1">
          Wählen Sie im Tab <strong>Map</strong> einen Gebäude-Marker. Im rechten
          Bereich wechseln Sie über die Reiter zwischen <strong>Building data</strong>,{" "}
          <strong>Energy data</strong> und <strong>Weather data</strong>. Unter der
          Karte sehen Sie den Energiemix für den aktuell sichtbaren Kartenausschnitt.
        </Typography>
        <Figure src="map-tabs.png" caption="Gebäudedetails im Map-Tab mit Reitern" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          7. Gebäude teilen und Zugriff widerrufen
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          Im Tab <strong>Sharing</strong>:
        </Typography>
        <ol>
          <li>
            Klicken Sie beim gewünschten Gebäude auf den Teilen-Button und geben
            Sie die <strong>WebID</strong> des Empfängers ein (oder wählen Sie ein
            Raum-Mitglied aus der Liste).
          </li>
          <li>
            Optional „Include Energy Data“ aktivieren, wenn auch die
            Verbrauchsdaten geteilt werden sollen, dann bestätigen.
          </li>
          <li>
            <strong>Daten exportieren:</strong> Über das Download-Symbol neben
            einem Gebäude speichern Sie dessen Daten als Datei.
          </li>
          <li>
            <strong>Widerrufen:</strong> Unter „Buildings you share“ entfernen Sie
            einen Empfänger über das Lösch-Symbol. Hinweis: Der Empfänger wird
            darüber nicht benachrichtigt.
          </li>
        </ol>
        <Figure src="sharing.png" caption="Sharing-Tab: teilen, exportieren, widerrufen" />
      </Box>

      <Box component="section">
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          8. Aggregierte Ansicht erstellen und teilen
        </Typography>
        <Typography variant="body1" sx={{ mb: 1 }}>
          Aggregierte Ansichten („Views“) fassen mehrere Gebäude zu Durchschnitt,
          Summe, Minimum oder Maximum zusammen – ohne Einzelgebäude offenzulegen.
          Im Tab <strong>Sharing</strong>:
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
