import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

/**
 * Plain footer placed in normal page flow — project credits, the AGPL-3.0
 * source link, and the build commit. The Developer-mode toggle lives behind the
 * header network-activity indicator, not here.
 */
function Footer() {
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
        <Link
          href="https://www.ti.rw.fau.de/granergize/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Granergize@FAU
        </Link>{" · "}
        <Link
          href="https://www.scs.fraunhofer.de/de/referenzen/granergize-graphenbasierter-datenraum-logistikimmobilien.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Granergize@IIS
        </Link>{" · "}
        <Link
          href="https://github.com/wintechis/granergize-webapp"
          target="_blank"
          rel="noopener noreferrer"
        >
          AGPL-3.0
        </Link>{" · "}
        {__APP_COMMIT__}
      </Typography>
    </Box>
  );
}

export default Footer;
