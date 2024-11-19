import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AgentType } from "../../types/types.ts";
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import PersonIcon from '@mui/icons-material/Person';
import Typography from '@mui/material/Typography';

export default function Agent() {
  const { selectedAgent } = useParams();
  const [agent, setAgent] = useState<AgentType | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const resp = await fetch(`/api/agents/${selectedAgent}`);
      const agent = await resp.json() as AgentType;
      setAgent(agent);
    })();
  }, [selectedAgent]);

  if (!agent) {
    return <div>Loading...</div>;
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