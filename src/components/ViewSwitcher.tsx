import { useState } from "react";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import SwitchAccountIcon from "@mui/icons-material/SwitchAccount";
import EngineeringIcon from "@mui/icons-material/Engineering";
import BusinessIcon from "@mui/icons-material/Business";
import PersonIcon from "@mui/icons-material/Person";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import { useSolidData } from "../context/SolidDataContext.tsx";
import type { UserRole } from "../../types/types.ts";

interface ViewOption {
  role: UserRole;
  label: string;
  icon: React.ReactNode;
}

const VIEW_OPTIONS: ViewOption[] = [
  { role: "dummy", label: "Dummy", icon: <EngineeringIcon /> },
  { role: "investor", label: "Investor", icon: <BusinessIcon /> },
  { role: "user", label: "User", icon: <PersonIcon /> },
  {
    role: "benchmark_service_provider",
    label: "Benchmark Service Provider",
    icon: <AnalyticsIcon />,
  },
];

export default function ViewSwitcher() {
  const { role, setRole } = useSolidData();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const current = VIEW_OPTIONS.find((v) => v.role === role);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (selected: UserRole) => {
    handleClose();
    if (selected !== role) {
      setRole(selected);
    }
  };

  return (
    <>
      <Tooltip title={current ? `View: ${current.label}` : "Select view"}>
        <IconButton
          onClick={handleOpen}
          color="primary"
          size="large"
          sx={{ border: "none", background: "transparent" }}
        >
          {current ? current.icon : <SwitchAccountIcon />}
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        slotProps={{
          paper: {
            elevation: 0,
            sx: {
              overflow: "visible",
              filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
              mt: 1.5,
              minWidth: 220,
            },
          },
        }}
      >
        {VIEW_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.role}
            selected={opt.role === role}
            onClick={() => handleSelect(opt.role)}
          >
            <ListItemIcon>{opt.icon}</ListItemIcon>
            <ListItemText>{opt.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
