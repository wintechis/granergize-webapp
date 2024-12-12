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
            {building["streetAddress"]}
            <br />
            {`${building["postalCode"]} ${building.locality}, ${building.region}`}
          </>
        }
      />
      <CardContent>
        <Typography variant="body1"><strong>Customer:</strong> {building.customer && createAgentLink(building.customer)}</Typography>
        <Typography variant="body1"><strong>Operated By:</strong> {building["operatedBy"] && createAgentLink(building["operatedBy"])}</Typography>
        <Typography variant="body1"><strong>Type:</strong> {building.type && createTypeLink(building.type)}</Typography>
        <Typography variant="body1"><strong>Coordinates:</strong> {building.lat && building.long && createCoordinatesLink(building.lat, building.long)} </Typography>
        <Typography variant="body1"><strong>Building Area:</strong> {building["buildingArea"]} m²</Typography>
        <Typography variant="body1"><strong>Land Area:</strong> {building["landArea"]} m²</Typography>
        <Typography variant="body1"><strong>Office Area:</strong> {building["officeArea"]} m²</Typography>
        <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1"><strong>Has PV System:</strong> {building["hasPVSystem"] == true ? <CheckIcon /> : <ClearIcon />}</Typography>
        <Typography variant="body1"><strong>Investor:</strong> {building.investor && createAgentLink(building.investor)}</Typography>
        <Typography variant="body1"><strong>Year of Construction:</strong> {building["yearOfConstruction"]}</Typography>
        <Typography variant="body1"><strong>NACE Code:</strong> {building["naceCode"] && createNaceLink(building["naceCode"])}</Typography>
        <Link to="#" onClick={onHide}>hide</Link>
      </CardContent>
    </Card>
  );
}