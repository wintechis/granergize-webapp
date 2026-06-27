import { Box, Divider, Link, Stack, Typography } from "@mui/material";
import { msg } from "../lib/messages.ts";
import { BackLink } from "../components/detail/DetailView.tsx";
import { DATA_SOURCES } from "../constants/dataSources.ts";
import { HOME } from "../routes.ts";

/**
 * "Data sources & licences" — the app-level attribution / credits page, reached
 * from the profile menu (present in both modes; legal attribution, not
 * dev-gated). Lists every external source from the registry with its homepage,
 * licence and a one-line use note — the legally-robust blanket attribution for
 * OSM/CC/dl-de/by data, and a discovery surface mirroring `vocab/<id>.md`.
 */
export default function DataSources() {
  return (
    <Box>
      <Box sx={{ mb: 1 }}>
        <BackLink fallback={HOME} />
      </Box>
      <Typography variant="h5" gutterBottom>{msg("menuDataSources")}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {msg("dsIntro")}
      </Typography>
      <Stack spacing={2} divider={<Divider />}>
        {DATA_SOURCES.map((s) => (
          <Box key={s.id}>
            <Typography variant="subtitle2">
              {s.homepage
                ? (
                  <Link
                    href={s.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {s.name}
                  </Link>
                )
                : s.name}
              {s.license && (
                <>
                  {" · "}
                  {s.licenseHref
                    ? (
                      <Link
                        href={s.licenseHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {s.license}
                      </Link>
                    )
                    : s.license}
                </>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {s.note}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
