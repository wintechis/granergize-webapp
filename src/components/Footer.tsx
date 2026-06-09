import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { setDevMode, useDevMode } from "../hooks/devMode.ts";

/** Plain footer placed in normal page flow. */
function Footer() {
  const dev = useDevMode();
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 1,
        py: 1.5,
        px: 2,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Research project{" "}
        <Link
          href="https://www.scs.fraunhofer.de/de/referenzen/granergize-graphenbasierter-datenraum-logistikimmobilien.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Granergize
        </Link>. Contact:{" "}
        <Link href="mailto:thomas.wehr@fau.de">Thomas Wehr</Link>.{" "}
        <Link
          href="https://ti.rw.fau.de/"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://ti.rw.fau.de/
        </Link>{" "}
        and{" "}
        <Link
          href="https://iis.fraunhofer.de/"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://iis.fraunhofer.de/
        </Link>.
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {__APP_COMMIT__}
      </Typography>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={dev}
            onChange={(e) => setDevMode(e.target.checked)}
          />
        }
        label={
          <Typography variant="caption" color="text.secondary">
            Developer mode
          </Typography>
        }
        sx={{ m: 0 }}
      />
    </Box>
  );
}

export default Footer;
