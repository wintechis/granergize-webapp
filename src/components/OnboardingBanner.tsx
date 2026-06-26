import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import { useT } from "../context/I18nProvider.tsx";

interface OnboardingBannerProps {
  /** Show the banner (a fresh Pod with no own buildings and nothing shared in). */
  show: boolean;
  /** A seed is in flight — disables both actions. */
  busy: boolean;
  onSeed: () => void;
  onDecline: () => void;
}

/**
 * Fresh-Pod onboarding for {@link AppShell}: offers the demo buildings instead of
 * writing them silently. Non-blocking (the app stays usable); declining persists
 * to `prefs.ttl` so it doesn't nag on every login.
 */
export default function OnboardingBanner(
  { show, busy, onSeed, onDecline }: OnboardingBannerProps,
) {
  const t = useT();
  return (
    <Collapse in={show} sx={{ flexShrink: 0 }}>
      <Alert
        severity="info"
        sx={{ borderRadius: 0 }}
        action={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Button
              color="inherit"
              size="small"
              onClick={onSeed}
              disabled={busy}
            >
              {busy ? t("addingEllipsis") : t("onboardAddExamples")}
            </Button>
            <Button
              color="inherit"
              size="small"
              onClick={onDecline}
              disabled={busy}
            >
              {t("btnNoThanks")}
            </Button>
          </Box>
        }
      >
        {t("onboardBanner")}
      </Alert>
    </Collapse>
  );
}
