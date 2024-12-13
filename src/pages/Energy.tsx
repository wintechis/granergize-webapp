import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EnergyType } from "../../types/types.ts";
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import Item from '@mui/material/ListItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  ChartData,
  ChartOptions,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
} from 'chart.js';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';

// Register the necessary components
ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title
);

const colorPalette = [
  'rgba(166, 206, 227, 1)',
  'rgba(31, 120, 180, 1)',
  'rgba(178, 223, 138, 1)',
  'rgba(51, 160, 44, 1)',
  'rgba(251, 154, 153, 1)',
  'rgba(227, 26, 28, 1)',
  'rgba(253, 191, 111, 1)',
  'rgba(255, 127, 0, 1)',
  'rgba(202, 178, 214, 1)',
  'rgba(106, 61, 154, 1)',
  'rgba(255, 255, 153, 1)',
  'rgba(177, 89, 40, 1)',
];

type EnergyProps = {
  selectedBuilding: string;
  operatedBy: string;
};

export default function Energy({ selectedBuilding, operatedBy }: EnergyProps) {
  const [energy, setEnergy] = useState<EnergyType | undefined>(undefined);
  const [averages, setAverages] = useState<Record<string, number> | undefined>(undefined);
  const [agentAverages, setAgentAverages] = useState<Record<string, Record<string, number>> | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const resp = await fetch(`/api/energy/${selectedBuilding}`);
      const energy = await resp.json() as EnergyType;
      setEnergy(energy);
    })();
  }, [selectedBuilding]);

  useEffect(() => {
    (async () => {
      const resp = await fetch(`/api/energy-averages`);
      const { averages, agentAverages } = await resp.json() as { averages: Record<string, number>, agentAverages: Record<string, Record<string, number>> };
      setAverages(averages);
      setAgentAverages(agentAverages);
    })();
  }, []);

  if (!energy || !averages || !agentAverages) {
    return <div>Loading...</div>;
  }

  function formatNumber(value: number): string {
    return new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function sumUpPropValues(obj: Record<string, unknown>): number {
    if (typeof obj === 'object' && obj !== null) {
      return Object.values(obj)
        .filter((value): value is number => typeof value === 'number')
        .reduce((sum, value) => sum + value, 0);
    }
    return 0;
  }

  function toTitleCase(str: string) {
    return str.replace(
      /\w\S*/g,
      text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
    );
  }

  const chartData = function(string: keyof EnergyType): ChartData<"bar", number[], unknown> {
    if (energy === undefined) {
      return {
        labels: [],
        datasets: [],
      };
    }
    return {
      labels: Object.keys(energy[string]),
      datasets: [
        {
          label: 'Energy Need',
          data: Object.values(energy[string]),
          backgroundColor: colorPalette,
          borderColor: colorPalette,
          borderWidth: 1,
        },
      ],
    };
  }

  const options: ChartOptions<"bar"> = {
    elements: {
      bar: {
        inflateAmount: 0,
      }
    },
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Energy Type'
        },
      },
      y: {
        title: {
          display: true,
          text: 'kWh'
        },
        afterFit: (scale) => {
          scale.width = 100;
        },
        beginAtZero: true,
        max: Math.max(
          ...Object.values(energy["energyNeed"] || []),
          ...Object.values(energy["energyGeneration"] || []),
          ...Object.values(energy["energyStorage"] || []),
          ...Object.values(energy["energyDistribution"] || []),
          ...Object.values(energy["energyTransfer"] || []),
          ...Object.values(energy["energyUsage"] || []),
          ...Object.values(energy["environmentalFactor"] || [])
        ),
      },
    },
    layout: {
      autoPadding: false,
    }
  };

  function getBackgroundColor(value: number, average: number): string {
    const deviation = value - average;
    const percentageDeviation = Math.abs(deviation / average) * 100;
    const saturation = Math.min(percentageDeviation, 100); // Cap saturation at 100%

    if (deviation < 0) {
      // Below average, green
      return `rgba(0, 255, 0, ${saturation / 100})`;
    } else {
      // Above average, red
      return `rgba(255, 0, 0, ${saturation / 100})`;
    }
  }

  function createEnergyGrid(title: keyof EnergyType) {
    if (!energy) {
      return null;
    }
    if (!energy[title]) {
      return <></>;
    }
    const agent = operatedBy; // Assuming energy object has operatedBy property
    return (
      <>
        <Typography variant="h5">{toTitleCase(title)}</Typography>
        <Item component="div">
          <Container>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Energy Type</TableCell>
                    <TableCell align="right">kWh</TableCell>
                    <TableCell align="right">Industry Average kWh</TableCell>
                    <TableCell align="right">Agent Average kWh</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(energy[title]).map(([key, value]) => {
                    const industryAverage = averages[key] || 0;
                    const agentAverage = agentAverages[agent]?.[key] || 0;
                    const comparisonValue = industryAverage;
                    return (
                      <TableRow hover key={key}>
                        <TableCell component="th" scope="row">
                          {key}
                        </TableCell>
                        <TableCell align="right" style={{ backgroundColor: getBackgroundColor(value, comparisonValue) }}>
                          {formatNumber(value)}
                        </TableCell>
                        <TableCell align="right" style={{ backgroundColor: getBackgroundColor(industryAverage, comparisonValue) }}>
                          {formatNumber(industryAverage)}
                        </TableCell>
                        <TableCell align="right" style={{ backgroundColor: getBackgroundColor(agentAverage, comparisonValue) }}>
                          {formatNumber(agentAverage)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableHead>
                  <TableRow hover>
                    <TableCell><strong>Total</strong></TableCell>
                    <TableCell align="right">
                      <strong>
                        {typeof energy[title] === 'object' && energy[title] !== null 
                          ? formatNumber(sumUpPropValues(energy[title] as Record<string, unknown>))
                          : 0}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        {formatNumber(Object.keys(energy[title]).reduce((sum, key) => sum + (averages[key] || 0), 0))}
                      </strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>
                        {formatNumber(Object.keys(energy[title]).reduce((sum, key) => sum + (agentAverages[agent]?.[key] || 0), 0))}
                      </strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
              </Table>
            </TableContainer>
            <Item>
            </Item>
            <Bar data={chartData(title)} options={options} />
            <Divider />
          </Container>
        </Item>
      </>
  )
  }

  return (
    <Card>
      <CardHeader
        avatar={<ElectricBoltIcon />}
        title={<Typography variant="h4">Energy need for building {energy.id} in 2023</Typography>}
      />
      <CardContent>
        <Typography variant="body1"><strong>id: <Link to={`https://solid.ti.rw.fau.de/private/granergize/buildings.ttl#${energy.id}`}>https://solid.ti.rw.fau.de/private/granergize/buildings.ttl#{energy.id}</Link></strong></Typography>
        <Divider />
        <Stack spacing={2}>
          {createEnergyGrid("energyNeed")}
          {createEnergyGrid("energyGeneration")}
          {createEnergyGrid("energyStorage")}
          {createEnergyGrid("energyDistribution")}
          {createEnergyGrid("energyTransfer")}
          {createEnergyGrid("energyUsage")}
          {createEnergyGrid("environmentalFactor")}
        </Stack>
        <Link to="/">🠠 Back to map overview</Link>
      </CardContent>
    </Card>
  );
}