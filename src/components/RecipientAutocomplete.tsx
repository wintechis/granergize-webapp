import {
  Autocomplete,
  type AutocompleteRenderValue,
  type AutocompleteRenderValueGetItemProps,
  Box,
  TextField,
} from "@mui/material";
import type { HTMLAttributes } from "react";
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
      renderOption={(
        props: HTMLAttributes<HTMLLIElement> & { key?: unknown },
        option: string,
      ) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" {...rest} key={key as string}>
            <AgentLabel value={option} />
          </Box>
        );
      }}
      renderValue={(
        tags: AutocompleteRenderValue<string, true, true>,
        getItemProps: AutocompleteRenderValueGetItemProps<true>,
      ) =>
        tags.map((option, index) => (
          <AgentChip
            {...getItemProps({ index })}
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
