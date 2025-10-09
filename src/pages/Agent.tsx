import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { AgentType } from "../../types/types.ts";
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import PersonIcon from '@mui/icons-material/Person';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useSolidData } from '../context/SolidDataContext.tsx';

export default function Agent() {
  const { selectedAgent } = useParams();
  const { agents, isLoading, error } = useSolidData();
  const [agent, setAgent] = useState<AgentType | undefined>(undefined);
  
  // Find the agent in the data from SolidDataContext
  useEffect(() => {
    if (agents && agents.length > 0) {
      const foundAgent = agents.find(a => a.id.toString() === selectedAgent);
      setAgent(foundAgent);
    }
  }, [agents, selectedAgent]);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error">
        Error loading data: {error}
      </Typography>
    );
  }

  if (!agent) {
    return (
      <Typography>
        Agent not found or you don't have access to view this agent.
      </Typography>
    );
  }

  function createTypeLink(uriString: string) {
    const hash = new URL(uriString).hash.replace("#", "");
    return (<Link to={uriString}>{hash}</Link>);
  }

  return (
    <Card>
      <CardHeader
        avatar={<PersonIcon />}
        title={`Agent ${agent.id}`}
      />
      <CardContent>
        <Typography variant="body1"><strong>Name:</strong> {agent.name}</Typography>
        <Typography variant="body1"><strong>Type:</strong> {createTypeLink(agent.type)}</Typography>
        <Link to="/">🠠 Back to map overview</Link>
      </CardContent>
    </Card>
  );
}