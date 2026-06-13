import { Autocomplete, Box, TextField } from "@mui/material";
import { AgentChip, AgentLabel } from "./AgentLabel.tsx";
import { useAgentOptions } from "../hooks/useAgentOptions.ts";

const DEFAULT_HELP = "Pick a contact/member, or type a WebID and press Enter";

interface RecipientAutocompleteProps {
  /** Selected WebIDs (free-solo / typed entries included). */
  value: string[];
  /** New selection; the caller owns any side effects (clearing a validation
   *  error, resetting a mutation). */
  onChange: (recipients: string[]) => void;
  /** Validation message shown under the field; falsy → the default hint. */
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}

/**
 * The shared recipient picker for both share dialogs (building + view): a
 * multi/free-solo Autocomplete over the user's contacts and data-room members
 * ({@link useAgentOptions}), rendering each option/tag through {@link AgentLabel}/
 * {@link AgentChip} and accepting a typed WebID on Enter.
 */
export default function RecipientAutocomplete({
  value,
  onChange,
  error,
  disabled,
  autoFocus,
  label = "Recipient WebID(s)",
}: RecipientAutocompleteProps) {
  const agentOptions = useAgentOptions();
  return (
    <Autocomplete
      multiple
      freeSolo
      options={agentOptions}
      value={value}
      onChange={(_e, next) => onChange(next as string[])}
      disabled={disabled}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option}>
          <AgentLabel value={option} />
        </Box>
      )}
      renderTags={(tags, getTagProps) =>
        tags.map((option, index) => (
          <AgentChip
            {...getTagProps({ index })}
            key={option}
            value={option}
            size="small"
          />
        ))}
      renderInput={(params) => (
        <TextField
          {...params}
          autoFocus={autoFocus}
          label={label}
          error={!!error}
          helperText={error || DEFAULT_HELP}
          sx={{ mb: 2 }}
        />
      )}
    />
  );
}
