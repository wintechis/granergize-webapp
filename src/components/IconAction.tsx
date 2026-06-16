import { type ReactNode } from "react";
import { IconButton, Tooltip } from "@mui/material";

export interface IconActionProps {
  /** Accessible label — both the tooltip text and the `aria-label`. */
  label: string;
  /** The action icon (e.g. `<DeleteIcon fontSize="small" />`). */
  icon: ReactNode;
  onClick: () => void;
  /** MUI IconButton colour (e.g. `"error"` for a destructive action). */
  color?: "inherit" | "primary" | "secondary" | "error" | "info" | "success" | "warning" | "default";
  disabled?: boolean;
}

/**
 * The shared icon-action primitive (UI convention: `IconButton size="small"`
 * carrying BOTH a `Tooltip` and an `aria-label`). The wrapping `<span>` keeps the
 * tooltip working while the button is `disabled` (a disabled element fires no
 * pointer events MUI's Tooltip needs). Lists, section headers, and the
 * {@link ObjectActions} menu reuse this rather than re-spelling the IconButton +
 * Tooltip pair.
 */
export default function IconAction({
  label,
  icon,
  onClick,
  color,
  disabled = false,
}: IconActionProps) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          color={color}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}
