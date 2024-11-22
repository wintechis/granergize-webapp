import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

export default function EnergyMix() {

  return (
    <Box>
      <Typography variant="h3" gutterBottom>
        Query Service
      </Typography>
      <Typography variant="body1" paragraph>
        This page will allow you to query the data with SPARQL.
      </Typography>
    </Box>
  );
}