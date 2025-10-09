import { useState, useEffect } from 'react';
import EnergyTable from './EnergyTable.tsx'; // Adjust the path as needed
import { Box } from '@mui/material';
import cities from '../data/cities.json' with { type: "json" };
import districts from '../data/districts.json' with { type: "json" };
import energyMixData from '../data/energyMix.json' with { type: "json" };
import type { EnergyConsumption, EnergyProduction } from '../../types/types.ts';
import { Field } from "./EnergyTable.tsx";

type Order = 'asc' | 'desc';

const citiesMap = new Map(cities.map((city) => [city.id, city.name]));
const districtsMap = new Map(districts.map((district) => [district.id, district.name]));

export default function EnergyMix() {
  // State for fetched data
  const [energyMix, setEnergyMix] = useState<{
    energyConsumption: Record<string, EnergyConsumption>;
    energyProduction: Record<string, EnergyProduction>;
  } | null>(null);

  // State and functions for Consumption Table
  const [orderConsumptionBy, setOrderConsumptionBy] = useState<'name' | keyof EnergyConsumption>('value');
  const [consumptionOrder, setConsumptionOrder] = useState<Order>('desc');
  const [consumptionPage, setConsumptionPage] = useState(0);
  const [rowsPerConsumptionPage, setRowsPerConsumptionPage] = useState(10);

  // State and functions for Production Table
  const [orderProductionBy, setOrderProductionBy] = useState<'name' | keyof EnergyProduction>('totalRenewableProduction');
  const [productionOrder, setProductionOrder] = useState<Order>('desc');
  const [productionPage, setProductionPage] = useState(0);
  const [rowsPerProductionPage, setRowsPerProductionPage] = useState(10);

  useEffect(() => {
    // Simply set the imported data instead of fetching
    setEnergyMix(energyMixData as {
      energyConsumption: Record<string, EnergyConsumption>;
      energyProduction: Record<string, EnergyProduction>;
    });
  }, []);

  function findEntityName(key: string) {
    return citiesMap.get(key) || districtsMap.get(key) || key;
  }

  // Prepare data for Consumption Table
  const consumptionData = energyMix
    ? Object.entries(energyMix.energyConsumption).map(([key, values]) => ({
        key,
        name: findEntityName(key),
        values,
      }))
    : [];

  const sortedConsumptionData = [...consumptionData].sort((a, b) => {
    if (orderConsumptionBy === 'name') {
      return (
        (a.name.localeCompare(b.name)) * (consumptionOrder === 'asc' ? 1 : -1)
      );
    } else {
      const aValue = a.values[orderConsumptionBy];
      const bValue = b.values[orderConsumptionBy];
      return (
        (consumptionOrder === 'asc' ? aValue - bValue : bValue - aValue)
      );
    }
  });

  const paginatedConsumptionData = sortedConsumptionData.slice(
    consumptionPage * rowsPerConsumptionPage,
    consumptionPage * rowsPerConsumptionPage + rowsPerConsumptionPage
  );

  // Prepare data for Production Table
  const productionData = energyMix
    ? Object.entries(energyMix.energyProduction).map(([key, values]) => ({
        key,
        name: findEntityName(key),
        values,
      }))
    : [];

  const sortedProductionData = [...productionData].sort((a, b) => {
    if (orderProductionBy === 'name') {
      return (
        (a.name.localeCompare(b.name)) * (productionOrder === 'asc' ? 1 : -1)
      );
    } else {
      const aValue = a.values[orderProductionBy];
      const bValue = b.values[orderProductionBy];
      return (
        (productionOrder === 'asc' ? aValue - bValue : bValue - aValue)
      );
    }
  });

  const paginatedProductionData = sortedProductionData.slice(
    productionPage * rowsPerProductionPage,
    productionPage * rowsPerProductionPage + rowsPerProductionPage
  );

  // Define fields for Consumption Table
  const consumptionFields: Field<EnergyConsumption>[] = [
    { id: 'value', label: 'Consumption (MWh)', numeric: true },
    { id: 'renewableEnergyShare', label: 'Renewable Share (%)', numeric: true, isPercentage: true },
  ];

  // Define fields for Production Table
  const productionFields: Field<EnergyProduction>[] = [
    { id: 'hydroShare', label: 'Hydro (%)', numeric: true, isPercentage: true },
    { id: 'windShare', label: 'Wind (%)', numeric: true, isPercentage: true },
    { id: 'solarShare', label: 'Solar (%)', numeric: true, isPercentage: true },
    { id: 'biomassShare', label: 'Biomass (%)', numeric: true, isPercentage: true },
    { id: 'geothermalShare', label: 'Geothermal (%)', numeric: true, isPercentage: true },
    { id: 'totalRenewableProduction', label: 'Total Production (MWh)', numeric: true },
  ];

  return (
    <Box sx={{ padding: 2 }}>
      {/* Energy Consumption Table */}
      <EnergyTable<EnergyConsumption>
        title="Energy Consumption"
        data={paginatedConsumptionData}
        fields={consumptionFields}
        orderBy={orderConsumptionBy}
        order={consumptionOrder}
        onRequestSort={(property) => {
          const isAsc = orderConsumptionBy === property && consumptionOrder === 'asc';
          setConsumptionOrder(isAsc ? 'desc' : 'asc');
          setOrderConsumptionBy(property);
        }}
        page={consumptionPage}
        rowsPerPage={rowsPerConsumptionPage}
        onPageChange={(_, newPage) => setConsumptionPage(newPage)}
        onRowsPerPageChange={(event) => {
          setRowsPerConsumptionPage(parseInt(event.target.value, 10));
          setConsumptionPage(0);
        }}
        totalRows={sortedConsumptionData.length}
      />

      {/* Energy Production Table */}
      <EnergyTable<EnergyProduction>
        title="Energy Production"
        data={paginatedProductionData}
        fields={productionFields}
        orderBy={orderProductionBy}
        order={productionOrder}
        onRequestSort={(property) => {
          const isAsc = orderProductionBy === property && productionOrder === 'asc';
          setProductionOrder(isAsc ? 'desc' : 'asc');
          setOrderProductionBy(property);
        }}
        page={productionPage}
        rowsPerPage={rowsPerProductionPage}
        onPageChange={(_, newPage) => setProductionPage(newPage)}
        onRowsPerPageChange={(event) => {
          setRowsPerProductionPage(parseInt(event.target.value, 10));
          setProductionPage(0);
        }}
        totalRows={sortedProductionData.length}
      />
    </Box>
  );
}