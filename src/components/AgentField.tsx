import { Autocomplete, Box, TextField } from "@mui/material";
import { useAgentOptions } from "../hooks/useAgentOptions.ts";
import { AgentLabel } from "./AgentLabel.tsx";

interface AgentFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
  error?: boolean;
}

/**
 * A WebID entry field: a free-solo autocomplete suggesting known agents (contacts
 * + room members, rendered via {@link AgentLabel}) while still accepting a typed
 * WebID or free-text name. Returns the chosen/typed string. Used for a building's
 * operator and (single) share recipients.
 */
export function AgentField(
  { label, value, onChange, helperText, error }: AgentFieldProps,
) {
  const options = useAgentOptions();
  return (
    <Autocomplete
      freeSolo
      options={options}
      value={value}
      inputValue={value}
      onChange={(_e, v) => onChange(typeof v === "string" ? v : v ?? "")}
      onInputChange={(_e, v) => onChange(v)}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option}>
          <AgentLabel value={option} />
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size="small"
          error={error}
          helperText={helperText}
          sx={{ mb: 1.5 }}
        />
      )}
    />
  );
}
