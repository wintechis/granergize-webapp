import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

/** Plain footer placed in normal page flow. */
function Footer() {
  return (
    <Box sx={{ textAlign: "center", py: 1.5, px: 2 }}>
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
        </Link>.{" "}
        <Link href="#/guide">Anleitung</Link>.
      </Typography>
    </Box>
  );
}

export default Footer;
