import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import { getDefaultSession } from "@inrupt/solid-client-authn-browser";
import {
  type ActiveRequest,
  getActivitySnapshot,
  subscribeActivity,
} from "../services/utils/networkActivity.ts";
import { getStorageRoot } from "../services/utils/solidUtils.ts";

/** Subscribe to the in-flight request list (re-renders on change). */
function useNetworkActivity(): ActiveRequest[] {
  return useSyncExternalStore(
    subscribeActivity,
    getActivitySnapshot,
    getActivitySnapshot,
  );
}

/** The resolved Pod storage root, or "" if not available yet. */
function currentStorageRoot(): string {
  try {
    const webId = getDefaultSession().info.webId;
    return webId ? getStorageRoot(webId) : "";
  } catch {
    return "";
  }
}

/**
 * Display text for one request: requests under the Pod show as a relative path
 * (`METHOD granergize/…`); anything else (external URLs, or label-only entries
 * like "map tiles") shows in full.
 */
function displayLabel(r: ActiveRequest, root: string): string {
  if (!r.url) return r.label;
  const method = r.label.split(" ")[0];
  const noQuery = r.url.split("#")[0].split("?")[0];
  const where = root && noQuery.startsWith(root)
    ? noQuery.slice(root.length)
    : noQuery;
  return `${method} ${where}`;
}

/**
 * Header spinner reflecting ALL in-flight network requests (Pod fetches, map
 * tiles, geocoding, weather). A count badge shows how many are active; clicking
 * lists what they are. Hiding is debounced so quick bursts (e.g. map tiles)
 * don't make it flicker. Renders an empty fixed-width slot when idle to avoid
 * shifting the surrounding header.
 */
export default function NetworkActivityIndicator() {
  const active = useNetworkActivity();
  const count = active.length;
  const [visible, setVisible] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (count > 0) {
      clearTimeout(hideTimer.current);
      setVisible(true);
    } else {
      hideTimer.current = setTimeout(() => setVisible(false), 350);
    }
    return () => clearTimeout(hideTimer.current);
  }, [count]);

  // Idle: keep a fixed-width slot so the avatar next to it doesn't jump.
  if (!visible && count === 0) {
    return <Box sx={{ width: 40, height: 40, flexShrink: 0 }} />;
  }

  const open = Boolean(anchorEl);
  const root = open ? currentStorageRoot() : "";
  return (
    <>
      <Tooltip title={count > 0 ? `${count} request(s) loading` : "Idle"}>
        <IconButton
          aria-label={`Network activity: ${count} request(s) loading`}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ width: 40, height: 40, flexShrink: 0 }}
        >
          <Badge badgeContent={count} color="primary" max={99}>
            <CircularProgress size={20} thickness={5} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        // Always drop below the icon, right-aligned, so it never flips left over
        // the VIEW/SHARE content.
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        slotProps={{ paper: { sx: { maxWidth: "min(90vw, 640px)" } } }}
      >
        {active.length === 0
          ? <MenuItem disabled>No active requests</MenuItem>
          : active.map((r) => (
            <MenuItem key={r.id} dense disableRipple>
              <ListItemText
                primary={displayLabel(r, root)}
                slotProps={{
                  primary: {
                    variant: "caption",
                    sx: { fontFamily: "monospace", wordBreak: "break-all" },
                  },
                }}
              />
            </MenuItem>
          ))}
      </Menu>
    </>
  );
}
