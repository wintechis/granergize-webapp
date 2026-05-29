import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AgentType } from "../../types/types.ts";
import PersonIcon from "@mui/icons-material/Person";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useSolidData } from "../context/SolidDataContext.tsx";
import {
  DetailCard,
  DetailRow,
  RefLink,
  UriLink,
} from "../components/detail/DetailView.tsx";

interface AgentProps {
  /** Render inline in a pane; when set, this id is used instead of the route param. */
  agentId?: string;
  embedded?: boolean;
}

export default function Agent({ agentId, embedded = false }: AgentProps = {}) {
  const { selectedAgent: routeAgent } = useParams();
  const selectedAgent = agentId ?? routeAgent;
  const { agents, isLoading, error } = useSolidData();
  const [agent, setAgent] = useState<AgentType | undefined>(undefined);

  // Find the agent in the data from SolidDataContext
  useEffect(() => {
    if (agents && agents.length > 0) {
      const foundAgent = agents.find((a) => a.id.toString() === selectedAgent);
      setAgent(foundAgent);
    }
  }, [agents, selectedAgent]);

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        height="100vh"
      >
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
    return <UriLink href={uriString}>{hash}</UriLink>;
  }

  return (
    <DetailCard icon={<PersonIcon />} title={`Agent ${agent.id}`}>
      <DetailRow label="Name" value={agent.name} />
      <DetailRow label="Type" value={createTypeLink(agent.type)} />
      {!embedded && <RefLink to="/">🠠 Back to map overview</RefLink>}
    </DetailCard>
  );
}
