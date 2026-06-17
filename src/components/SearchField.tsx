import { IconButton, InputAdornment, TextField } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { useT } from "../context/I18nProvider.tsx";

/**
 * The one search input for the app's list/collection finders — a small
 * `TextField` with a search adornment and a clear button, so every finder's
 * keyword box looks and behaves the same (pair with {@link useListSearch} +
 * `filterByText`). The placeholder is overridable per finder; the value is
 * controlled by the caller (the URL-backed query).
 */
export default function SearchField(
  { value, onChange, placeholder }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  },
) {
  const t = useT();
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? t("searchPlaceholder")}
      aria-label={t("searchAria")}
      sx={{ minWidth: 220 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
          endAdornment: value
            ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label={t("searchClear")}
                  onClick={() => onChange("")}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            )
            : null,
        },
      }}
    />
  );
}
