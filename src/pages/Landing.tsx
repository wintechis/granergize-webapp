/* eslint-disable no-restricted-syntax -- The public landing page is a marketing
   surface with its own deliberate typographic scale (per the design handoff:
   clamp() hero/section headings, 12.5–18px marketing body, a dark band) that is
   intentionally outside the app shell's calm three-tier Typography scale. Inline
   fontSize/fontWeight here are by design, not drift. */
import { type ReactNode, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Link from "@mui/material/Link";
import CheckIcon from "@mui/icons-material/Check";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import GridViewIcon from "@mui/icons-material/GridView";
import InsightsIcon from "@mui/icons-material/Insights";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PublicIcon from "@mui/icons-material/Public";
import CodeIcon from "@mui/icons-material/Code";
import SouthIcon from "@mui/icons-material/South";
import SyncAltIcon from "@mui/icons-material/SyncAlt";
import StorageIcon from "@mui/icons-material/Storage";
import GroupIcon from "@mui/icons-material/Group";
import BoltIcon from "@mui/icons-material/Bolt";

import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import Modal from "../components/Modal.tsx";
import { useT } from "../context/I18nProvider.tsx";

const LOGO = `${import.meta.env.BASE_URL}favicon.svg`;
const MAXW = 1120;
const INK = "#18222e";
const BODY = "#38424f";
const MUTED = "#667281";
const LINE = "#e2e8f0";
const PAPER_SHADOW = "0 6px 20px rgba(16,33,53,.08)";
const CARD_RADIUS = "18px";

const NAV = [
  { id: "was", key: "landingNavWhat" as const },
  { id: "use-cases", key: "landingNavUseCases" as const },
  { id: "sicher", key: "landingNavSovereignty" as const },
  { id: "vorschau", key: "landingNavPreview" as const },
];

/** Centred max-width content wrapper (≈1120px), the design's `.wrap`. */
function Wrap({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Box sx={{ maxWidth: MAXW, mx: "auto", px: { xs: 2.5, md: 3 }, ...sx }}>
      {children}
    </Box>
  );
}

/** Section eyebrow + h2 + lead, the design's `.sect-head`. */
function SectionHead(
  { eyebrow, title, lead, center, light }: {
    eyebrow: string;
    title: string;
    lead?: string;
    center?: boolean;
    light?: boolean;
  },
) {
  return (
    <Box sx={{ maxWidth: 760, mx: center ? "auto" : 0, textAlign: center ? "center" : "left" }}>
      <Typography
        sx={{
          textTransform: "uppercase",
          letterSpacing: ".08em",
          fontSize: 12.5,
          fontWeight: 600,
          color: light ? "#7fc4ec" : "primary.main",
        }}
      >
        {eyebrow}
      </Typography>
      <Typography
        component="h2"
        sx={{
          mt: 1.5,
          fontSize: "clamp(27px,3.6vw,40px)",
          fontWeight: 700,
          letterSpacing: "-.02em",
          lineHeight: 1.15,
          color: light ? "#fff" : INK,
        }}
      >
        {title}
      </Typography>
      {lead && (
        <Typography sx={{ mt: 2, fontSize: 18, lineHeight: 1.6, color: light ? "#aebccd" : BODY }}>
          {lead}
        </Typography>
      )}
    </Box>
  );
}

/** A bordered marketing card with a hover lift. */
function LiftCard({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Card
      sx={{
        p: 3.5,
        borderRadius: CARD_RADIUS,
        border: `1px solid ${LINE}`,
        height: "100%",
        transition: "transform .2s, box-shadow .2s",
        "&:hover": { transform: "translateY(-4px)", boxShadow: PAPER_SHADOW },
        ...sx,
      }}
    >
      {children}
    </Card>
  );
}

/**
 * The public marketing landing page (de/en/fr). Shown to logged-out visitors; the
 * `login` slot renders the real {@link Login} chooser inside the "Anmelden" section,
 * so the page's CTAs lead to a working OIDC sign-in. Copy is fully i18n'd; the
 * active locale is negotiated from the browser (see `lib/language.ts`).
 */
export default function Landing(
  { login, loginErrorOpen }: { login: ReactNode; loginErrorOpen?: boolean },
) {
  const t = useT();
  // The chooser lives in a dialog so logging in is one click from the sticky
  // header — never a scroll to the bottom of the page.
  // A failed silent restore (e.g. a stale OIDC client) surfaces its remedy in the
  // chooser — open the dialog on the error so it's reachable without hunting for it.
  // Seed from the prop so an error already present at first render opens the dialog
  // too (not only a later false→true transition); the user can still close it.
  const [loginOpen, setLoginOpen] = useState(!!loginErrorOpen);
  // Adjust state during render on a later prop transition (no effect needed).
  const [prevErr, setPrevErr] = useState(loginErrorOpen);
  if (loginErrorOpen !== prevErr) {
    setPrevErr(loginErrorOpen);
    if (loginErrorOpen) setLoginOpen(true);
  }
  const openLogin = () => setLoginOpen(true);

  const barData = [
    { year: "2022", electricity: 98000, heat: 64000 },
    { year: "2023", electricity: 92000, heat: 61000 },
    { year: "2024", electricity: 90000, heat: 60000 },
  ];
  const bars = [
    { key: "electricity", name: "Strom", color: "rgba(2,119,189,0.85)" },
    { key: "heat", name: "Wärme", color: "rgba(56,142,60,0.85)" },
  ];

  const trust = [t("landingTrustFree"), t("landingTrustOpenSource"), t("landingTrustData")];
  const values = [
    { icon: <GridViewIcon />, title: t("landingValue1Title"), body: t("landingValue1Body") },
    { icon: <InsightsIcon />, title: t("landingValue2Title"), body: t("landingValue2Body") },
    { icon: <VerifiedUserIcon />, title: t("landingValue3Title"), body: t("landingValue3Body") },
  ];
  const cases = [
    {
      title: t("landingUc1Title"),
      desc: t("landingUc1Desc"),
      name: "Alice Ahlmann",
      role: t("landingUc1Role"),
      quote: t("landingUc1Quote"),
      mono: "A",
      color: "#0277bd",
    },
    {
      title: t("landingUc2Title"),
      desc: t("landingUc2Desc"),
      name: "Bob Bauer",
      role: t("landingUc2Role"),
      quote: t("landingUc2Quote"),
      mono: "B",
      color: "#ed6c02",
    },
    {
      title: t("landingUc3Title"),
      desc: t("landingUc3Desc"),
      name: "Charlie Conrad",
      role: t("landingUc3Role"),
      quote: t("landingUc3Quote"),
      mono: "C",
      color: "#2e7d32",
    },
  ];
  const sov = [
    { icon: <LockOutlinedIcon />, title: t("landingSov1Title"), body: t("landingSov1Body") },
    { icon: <PublicIcon />, title: t("landingSov2Title"), body: t("landingSov2Body") },
    { icon: <CodeIcon />, title: t("landingSov3Title"), body: t("landingSov3Body") },
  ];

  const sectionPy = { py: { xs: 8, md: 13 } };

  return (
    <Box
      sx={{
        bgcolor: "#fff",
        color: BODY,
        // #root is a fixed-height (100%) flex column (App.css). Without flexShrink:0
        // a taller-than-viewport page is squeezed and clipped; this lets it keep its
        // natural height and overflow downward into the document scrollbar.
        flexShrink: 0,
        minHeight: "100vh",
        "& section": { scrollMarginTop: "84px" },
      }}
    >
      {/* ── Header ── */}
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: "rgba(255,255,255,.82)",
          backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${LINE}`,
          color: INK,
        }}
      >
        <Wrap>
          <Toolbar disableGutters sx={{ minHeight: 68, gap: 2 }}>
            <Box component="a" href="#top" sx={{ display: "flex", alignItems: "center", gap: 1, textDecoration: "none", color: INK }}>
              <Box component="img" src={LOGO} alt="" sx={{ width: 32, height: 32 }} />
              <Typography sx={{ fontWeight: 700, fontSize: 18 }}>Granergize</Typography>
            </Box>
            <Stack direction="row" sx={{ ml: 3, gap: 0.5, display: { xs: "none", md: "flex" } }}>
              {NAV.map((n) => (
                <Button key={n.id} href={`#${n.id}`} color="inherit" sx={{ fontSize: 14.5, fontWeight: 500, textTransform: "none" }}>
                  {t(n.key)}
                </Button>
              ))}
            </Stack>
            <Box sx={{ flexGrow: 1 }} />
            <Button onClick={openLogin} variant="outlined" sx={{ display: { xs: "none", sm: "inline-flex" }, textTransform: "none" }}>
              {t("landingNavLogin")}
            </Button>
            <Button href="#loslegen" variant="contained" sx={{ textTransform: "none" }}>
              {t("landingNavCreate")}
            </Button>
          </Toolbar>
        </Wrap>
      </AppBar>

      <Box component="main" id="top">
        {/* ── Hero ── */}
        <Box
          component="section"
          sx={{
            ...sectionPy,
            background:
              "radial-gradient(900px 500px at 85% -10%, rgba(2,119,189,.10), transparent 60%), linear-gradient(#fff,#f5f7fa)",
          }}
        >
          <Wrap>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.05fr .95fr" }, gap: { xs: 5, md: 7 }, alignItems: "center" }}>
              <Box>
                <Typography sx={{ textTransform: "uppercase", letterSpacing: ".08em", fontSize: 12.5, fontWeight: 600, color: "primary.main" }}>
                  {t("landingHeroEyebrow")}
                </Typography>
                <Typography component="h1" sx={{ mt: 2, fontSize: "clamp(34px,5vw,56px)", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.12, color: INK }}>
                  {t("landingHeroTitle")}
                </Typography>
                <Typography sx={{ mt: 2.5, fontSize: "clamp(17px,2.1vw,20px)", lineHeight: 1.6, color: BODY, maxWidth: "42ch" }}>
                  {t("landingHeroLead")}
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} sx={{ mt: 4, gap: 1.5 }}>
                  <Button href="#loslegen" variant="contained" size="large" endIcon={<ArrowForwardIcon />} sx={{ textTransform: "none" }}>
                    {t("landingHeroCtaPrimary")}
                  </Button>
                </Stack>
                <Stack direction="row" sx={{ mt: 3.5, gap: 3, flexWrap: "wrap", color: MUTED, fontSize: 13.5 }}>
                  {trust.map((tx) => (
                    <Stack key={tx} direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
                      <CheckIcon sx={{ fontSize: 18, color: "secondary.main" }} />
                      <span>{tx}</span>
                    </Stack>
                  ))}
                </Stack>
              </Box>

              {/* App-preview card */}
              <PreviewCard>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1.4fr 1fr" }, gap: 0 }}>
                  <Box sx={{ position: "relative", minHeight: 260, bgcolor: "#eef3f7", borderRight: { sm: `1px solid ${LINE}` }, display: "flex", alignItems: "flex-end" }}>
                    <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontSize: 13 }}>
                      <BoltIcon sx={{ fontSize: 48, opacity: 0.25 }} />
                    </Box>
                    <Box sx={{ m: 1.5, p: 1.5, bgcolor: "rgba(255,255,255,.92)", borderRadius: 2, border: `1px solid ${LINE}`, fontSize: 12, position: "relative" }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 12, mb: 0.5 }}>{t("landingLegendTitle")}</Typography>
                      {[["#2e7d32", t("landingLegendEfficient")], ["#f9a825", t("landingLegendTypical")], ["#c62828", t("landingLegendLess")]].map(([c, l]) => (
                        <Stack key={l} direction="row" sx={{ gap: 0.75, alignItems: "center", mt: 0.25 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: c }} />
                          <span>{l}</span>
                        </Stack>
                      ))}
                    </Box>
                  </Box>
                  <Box sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 15, color: INK }}>Nordostpark 84</Typography>
                    <Typography sx={{ fontSize: 12, color: MUTED, mb: 1 }}>{t("landingPreviewSub")}</Typography>
                    <Box sx={{ width: "100%", height: 200 }}>
                      <MetricBarChart data={barData} bars={bars} yUnit="kWh" height={200} />
                    </Box>
                  </Box>
                </Box>
              </PreviewCard>
            </Box>
          </Wrap>
        </Box>

        {/* ── What is Granergize? ── */}
        <Box component="section" id="was" sx={sectionPy}>
          <Wrap>
            <SectionHead eyebrow={t("landingNavWhat")} title={t("landingWhatTitle")} lead={t("landingWhatLead")} />
            <Box sx={{ mt: 5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" }, gap: 3 }}>
              {values.map((v) => (
                <LiftCard key={v.title}>
                  <IconTile>{v.icon}</IconTile>
                  <Typography component="h3" sx={{ mt: 2, fontSize: 19, fontWeight: 700, color: INK }}>{v.title}</Typography>
                  <Typography sx={{ mt: 1, fontSize: 15, lineHeight: 1.6, color: BODY }}>{v.body}</Typography>
                </LiftCard>
              ))}
            </Box>
          </Wrap>
        </Box>

        {/* ── Use cases ── */}
        <Box component="section" id="use-cases" sx={{ ...sectionPy, bgcolor: "#f5f7fa" }}>
          <Wrap>
            <SectionHead eyebrow={t("landingUcEyebrow")} title={t("landingUcTitle")} lead={t("landingUcLead")} />
            <Box sx={{ mt: 5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" }, gap: 3 }}>
              {cases.map((c, i) => (
                <LiftCard key={c.name}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: "primary.main" }}>
                    {t("landingUcStep", { n: i + 1 })}
                  </Typography>
                  <Typography component="h3" sx={{ mt: 0.5, fontSize: 20, fontWeight: 700, color: INK }}>{c.title}</Typography>
                  <Typography sx={{ mt: 1, fontSize: 14.5, lineHeight: 1.6, color: BODY }}>{c.desc}</Typography>
                  <Box sx={{ mt: 2.5, pt: 2.5, borderTop: `1px dashed ${LINE}` }}>
                    <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
                      <Avatar sx={{ bgcolor: c.color, width: 40, height: 40, fontWeight: 700 }}>{c.mono}</Avatar>
                      <Box>
                        <Typography sx={{ fontWeight: 700, fontSize: 14.5, color: INK }}>{c.name}</Typography>
                        <Typography sx={{ fontSize: 12.5, color: MUTED }}>{c.role}</Typography>
                      </Box>
                    </Stack>
                    <Typography sx={{ mt: 1.5, fontStyle: "italic", fontSize: 14.5, color: BODY }}>
                      <Box component="span" sx={{ color: "primary.main", fontWeight: 700 }}>„</Box>
                      {c.quote}
                      <Box component="span" sx={{ color: "primary.main", fontWeight: 700 }}>“</Box>
                    </Typography>
                  </Box>
                </LiftCard>
              ))}
            </Box>
          </Wrap>
        </Box>

        {/* ── Data sovereignty (dark) ── */}
        <Box component="section" id="sicher" sx={{ ...sectionPy, background: "linear-gradient(135deg,#0f1b29,#15293d)", color: "#cdd8e4" }}>
          <Wrap>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: { xs: 5, md: 7 }, alignItems: "center" }}>
              <Box>
                <SectionHead eyebrow={t("landingSovEyebrow")} title={t("landingSovTitle")} lead={t("landingSovLead")} light />
                <Stack sx={{ mt: 4, gap: 2.5 }}>
                  {sov.map((s) => (
                    <Stack key={s.title} direction="row" sx={{ gap: 1.5 }}>
                      <Box sx={{ color: "#7fc4ec", mt: 0.25 }}>{s.icon}</Box>
                      <Box>
                        <Typography sx={{ fontWeight: 700, color: "#fff" }}>{s.title}</Typography>
                        <Typography sx={{ fontSize: 14.5, color: "#aebccd", lineHeight: 1.55 }}>{s.body}</Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Box>
              {/* Flow diagram */}
              <Stack sx={{ gap: 1 }}>
                <FlowNode icon={<BoltIcon sx={{ color: "#fff" }} />} iconBg="linear-gradient(135deg,#0277bd,#388e3c)" title={t("landingFlowApp")} sub={t("landingFlowAppSub")} />
                <Box sx={{ display: "flex", justifyContent: "center", color: "#7fc4ec" }}><SouthIcon /></Box>
                <FlowNode icon={<StorageIcon sx={{ color: "#7fc4ec" }} />} iconBg="rgba(2,119,189,.22)" title={t("landingFlowPod")} sub={t("landingFlowPodSub")} />
                <Box sx={{ display: "flex", justifyContent: "center", color: "#8fd59a" }}><SyncAltIcon /></Box>
                <FlowNode icon={<GroupIcon sx={{ color: "#8fd59a" }} />} iconBg="rgba(56,142,60,.22)" title={t("landingFlowPartner")} sub={t("landingFlowPartnerSub")} />
              </Stack>
            </Box>
          </Wrap>
        </Box>

        {/* ── Preview ── */}
        <Box component="section" id="vorschau" sx={sectionPy}>
          <Wrap>
            <SectionHead center eyebrow={t("landingPreviewEyebrow")} title={t("landingPreviewTitle")} lead={t("landingPreviewLead")} />
            <Box sx={{ mt: 6 }}>
              <PreviewCard>
                <Box sx={{ height: { xs: 260, md: 440 }, bgcolor: "#eef3f7", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED }}>
                  <Stack sx={{ alignItems: "center", gap: 1 }}>
                    <BoltIcon sx={{ fontSize: 56, opacity: 0.25 }} />
                    <Typography sx={{ fontSize: 13 }}>Explore · Karte · Gebäudedetails</Typography>
                  </Stack>
                </Box>
              </PreviewCard>
            </Box>
          </Wrap>
        </Box>

        {/* ── Get started ── */}
        <Box component="section" id="loslegen" sx={{ ...sectionPy, bgcolor: "#f5f7fa" }}>
          <Wrap>
            <SectionHead center eyebrow={t("landingStartEyebrow")} title={t("landingStartTitle")} lead={t("landingStartLead")} />
            <Box sx={{ mt: 5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3,1fr)" }, gap: 3 }}>
              <Step n={1} title={t("landingStep1Title")}>
                <Typography sx={{ fontSize: 14.5, color: BODY }}>
                  <Link href="https://solidcommunity.net/" target="_blank" rel="noopener" sx={{ fontWeight: 600 }}>solidcommunity.net</Link>
                </Typography>
              </Step>
              <Step n={2} title={t("landingStep2Title")}>
                <Typography sx={{ fontSize: 14.5, color: BODY }}>{t("landingStep2Body")}</Typography>
                <Box component="code" sx={{ display: "block", mt: 1, fontSize: 12.5, color: INK, bgcolor: "#eef3f7", p: 1, borderRadius: 1, wordBreak: "break-all" }}>
                  https://name.solidcommunity.net/profile/card#me
                </Box>
              </Step>
              <Step n={3} title={t("landingStep3Title")}>
                <Typography sx={{ fontSize: 14.5, color: BODY }}>{t("landingStep3Body")}</Typography>
              </Step>
            </Box>
          </Wrap>
        </Box>

      </Box>

      {/* ── Footer ── */}
      <Box component="footer" sx={{ bgcolor: "#0f1b29", color: "#aebccd", pt: 8, pb: 4 }}>
        <Wrap>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.5fr 1fr 1fr" }, gap: 4 }}>
            <Box>
              <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                <Box component="img" src={LOGO} alt="" sx={{ width: 28, height: 28 }} />
                <Typography sx={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Granergize</Typography>
              </Stack>
              <Typography sx={{ mt: 1.5, fontSize: 14, lineHeight: 1.6, maxWidth: "42ch" }}>{t("landingFooterBlurb")}</Typography>
            </Box>
            <FooterCol title={t("landingFooterProduct")} links={[
              { label: t("landingNavWhat"), href: "#was" },
              { label: t("landingNavUseCases"), href: "#use-cases" },
              { label: t("landingNavSovereignty"), href: "#sicher" },
              { label: t("landingNavPreview"), href: "#vorschau" },
              { label: t("landingFooterStart"), href: "#loslegen" },
            ]} />
            <FooterCol title={t("landingFooterResources")} links={[
              { label: t("landingResCreatePod"), href: "https://solidcommunity.net/", ext: true },
              { label: t("landingResSource"), href: "https://github.com/wintechis/granergize-webapp", ext: true },
              { label: t("landingResAboutSolid"), href: "https://solidproject.org/", ext: true },
            ]} />
          </Box>

          <Box sx={{ mt: 5, pt: 3, borderTop: "1px solid rgba(255,255,255,.1)", display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", justifyContent: "space-between" }}>
            <Typography sx={{ fontSize: 13, maxWidth: "70ch" }}>
              <Box component="span" sx={{ color: "#fff", fontWeight: 700 }}>{t("landingFundingTitle")}</Box> {t("landingFundingBody")}
            </Typography>
            <Stack direction="row" sx={{ gap: 1 }}>
              <Link href="https://www.ti.rw.fau.de/granergize/" target="_blank" rel="noopener" sx={{ color: "#7fc4ec", fontSize: 13 }}>Granergize@FAU</Link>
              <Link href="https://www.scs.fraunhofer.de/de/referenzen/granergize-graphenbasierter-datenraum-logistikimmobilien.html" target="_blank" rel="noopener" sx={{ color: "#7fc4ec", fontSize: 13 }}>Granergize@IIS</Link>
            </Stack>
          </Box>
          <Box sx={{ mt: 3, fontSize: 12.5, color: "#667281" }}>
            {t("landingCopyright")}
          </Box>
        </Wrap>
      </Box>

      {/* Login dialog — opened from the header / hero / login CTAs, so signing in
          never requires scrolling to the bottom of the page. */}
      <Modal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        title={t("landingLoginModalTitle")}
        maxWidth="sm"
        dismissable
      >
        {login}
      </Modal>
    </Box>
  );
}

/** A faux-browser-chrome preview card (the design's `.preview-card`). */
function PreviewCard({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ borderRadius: CARD_RADIUS, border: `1px solid ${LINE}`, overflow: "hidden", boxShadow: "0 24px 60px rgba(16,33,53,.16)", bgcolor: "#fff" }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", px: 1.5, py: 1, borderBottom: `1px solid ${LINE}`, bgcolor: "#f8fafc" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <Box key={c} sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: c }} />
        ))}
        <Stack direction="row" sx={{ ml: 1.5, gap: 1.5, fontSize: 12.5, color: MUTED }}>
          {["Explore", "Manage", "Connect", "Share"].map((tab, i) => (
            <Box key={tab} sx={{ fontWeight: i === 0 ? 700 : 400, color: i === 0 ? "primary.main" : MUTED }}>{tab}</Box>
          ))}
        </Stack>
      </Stack>
      {children}
    </Box>
  );
}

/** Accent-soft icon tile for the value cards. */
function IconTile({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ width: 46, height: 46, borderRadius: 2, bgcolor: "#e3f1f9", color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {children}
    </Box>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", gap: 2 }}>
      <Avatar sx={{ bgcolor: "primary.main", width: 32, height: 32, fontSize: 15, fontWeight: 700 }}>{n}</Avatar>
      <Box>
        <Typography sx={{ fontWeight: 700, color: INK }}>{title}</Typography>
        <Box sx={{ mt: 0.5 }}>{children}</Box>
      </Box>
    </Box>
  );
}

function FlowNode({ icon, iconBg, title, sub }: { icon: ReactNode; iconBg: string; title: string; sub: string }) {
  return (
    <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", p: 2, borderRadius: 2, bgcolor: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)" }}>
      <Box sx={{ width: 44, height: 44, borderRadius: 2, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontWeight: 700, color: "#fff" }}>{title}</Typography>
        <Typography sx={{ fontSize: 13, color: "#aebccd" }}>{sub}</Typography>
      </Box>
    </Stack>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string; ext?: boolean }[] }) {
  return (
    <Box>
      <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 13, mb: 1.5 }}>{title}</Typography>
      <Stack sx={{ gap: 1 }}>
        {links.map((l) => (
          <Link key={l.label} href={l.href} target={l.ext ? "_blank" : undefined} rel={l.ext ? "noopener" : undefined} sx={{ color: "#aebccd", fontSize: 14, "&:hover": { color: "#fff" } }}>
            {l.label}
          </Link>
        ))}
      </Stack>
    </Box>
  );
}
