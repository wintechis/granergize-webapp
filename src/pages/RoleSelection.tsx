import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import EngineeringIcon from "@mui/icons-material/Engineering";
import BusinessIcon from "@mui/icons-material/Business";
import PersonIcon from "@mui/icons-material/Person";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import type { UserRole } from "../../types/types.ts";

interface RoleOption {
  role: UserRole;
  label: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
}

const ROLES: RoleOption[] = [
  {
    role: "dummy",
    label: "Dummy",
    description: "Explore the app with sample building and energy data.",
    icon: <EngineeringIcon sx={{ fontSize: 40 }} />,
    available: true,
  },
  {
    role: "investor",
    label: "Investor",
    description:
      "View aggregate energy performance and certificate data for buildings in your portfolio.",
    icon: <BusinessIcon sx={{ fontSize: 40 }} />,
    available: true,
  },
  {
    role: "user",
    label: "User",
    description:
      "Access high-resolution 15-minute energy consumption measurements for your building.",
    icon: <PersonIcon sx={{ fontSize: 40 }} />,
    available: true,
  },
  {
    role: "benchmark_service_provider",
    label: "Benchmark Service Provider",
    description:
      "Analyse anonymised energy benchmarks across multiple buildings and districts.",
    icon: <AnalyticsIcon sx={{ fontSize: 40 }} />,
    available: true,
  },
];

interface RoleSelectionProps {
  onSelect: (role: UserRole) => void;
}

export default function RoleSelection({ onSelect }: RoleSelectionProps) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
        bgcolor: "background.default",
      }}
    >
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Select your view
      </Typography>
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{ mb: 4, textAlign: "center", maxWidth: 480 }}
      >
        Choose how you want to interact with Granergize. You can switch your
        view at any time from the toolbar.
      </Typography>

      <Grid
        container
        spacing={2}
        justifyContent="center"
        sx={{ width: "100%", maxWidth: 880 }}
      >
        {ROLES.map((opt) => (
          <Grid item key={opt.role} xs={12} sm={6} sx={{ display: "flex" }}>
            <Card
              variant="outlined"
              sx={{
                width: "100%",
                height: "100%",
                opacity: opt.available ? 1 : 0.55,
                transition: "box-shadow 0.2s, border-color 0.2s",
                ...(opt.available && {
                  "&:hover": {
                    boxShadow: 4,
                    borderColor: "primary.main",
                  },
                }),
              }}
            >
              <CardActionArea
                disabled={!opt.available}
                onClick={() =>
                  onSelect(opt.role)}
                sx={{ height: "100%" }}
              >
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 1,
                    p: 3,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      width: "100%",
                    }}
                  >
                    <Box
                      color={opt.available ? "primary.main" : "text.disabled"}
                    >
                      {opt.icon}
                    </Box>
                    <Typography variant="h6" fontWeight="medium">
                      {opt.label}
                    </Typography>
                    {!opt.available && (
                      <Chip
                        label="Coming soon"
                        size="small"
                        variant="outlined"
                        sx={{ ml: "auto" }}
                      />
                    )}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {opt.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
