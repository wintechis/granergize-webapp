import { Link } from "react-router-dom";
import { BuildingType } from "../../types/types.ts";
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import CheckIcon from '@mui/icons-material/Check';
import ClearIcon from '@mui/icons-material/Clear';
import CorporateFareIcon from '@mui/icons-material/CorporateFare';
import Typography from '@mui/material/Typography';

interface BuildingProps {
  building: BuildingType;
  onHide: () => void;
}

export default function Building({ building, onHide }: BuildingProps) {
  function createAgentLink(uriString: string) {
    const hash = new URL(uriString).hash.replace("#", "");
    return (<Link to={`agent/${hash}`}>{hash}</Link>);
  }

  function createTypeLink(uriString: string) {
    const hash = new URL(uriString).hash.replace("#", "");
    return (<Link to={uriString}>{hash}</Link>);
  }

  function createCoordinatesLink(lat: number, long: number) {
    return (<Link to={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${long}`}>{lat}, {long}</Link>);
  }

  function createNaceLink(naceCode: number) {
    return (<Link to={`https://nacecode.de/${naceCode}`}>{naceCode}</Link>);
  }

  return (
    <Card style={{ position: 'absolute', top: 16, right: 16, width: 300, zIndex: 1000 }}>
      <CardHeader
        avatar={<CorporateFareIcon />}
        title={
          <>
            {"Building "}
            {building.id}
          </>
        }
        subheader={
          <>
            {building["street address"]}
            <br />
            {`${building["postal code"]} ${building.locality}, ${building.region}`}
          </>
        }
      />
      <CardContent>
        <Typography variant="body1"><strong>Customer:</strong> {createAgentLink(building.customer)}</Typography>
        <Typography variant="body1"><strong>Operated By:</strong> {createAgentLink(building["operated by"])}</Typography>
        <Typography variant="body1"><strong>Type:</strong> {createTypeLink(building.type)}</Typography>
        <Typography variant="body1"><strong>Coordinates:</strong> {createCoordinatesLink(building.lat, building.long)} </Typography>
        <Typography variant="body1"><strong>Building Area:</strong> {building["building area"]} m²</Typography>
        <Typography variant="body1"><strong>Land Area:</strong> {building["land area"]} m²</Typography>
        <Typography variant="body1"><strong>Office Area:</strong> {building["office area"]} m²</Typography>
        <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1"><strong>Has PV System:</strong> {building["has pv system"] == true ? <CheckIcon /> : <ClearIcon />}</Typography>
        <Typography variant="body1"><strong>Investor:</strong> {createAgentLink(building.investor)}</Typography>
        <Typography variant="body1"><strong>Year of Construction:</strong> {building["year of construction"]}</Typography>
        <Typography variant="body1"><strong>NACE Code:</strong> {createNaceLink(building["nace code"])}</Typography>
        <Link to="#" onClick={onHide}>hide</Link>
      </CardContent>
    </Card>
  );
}