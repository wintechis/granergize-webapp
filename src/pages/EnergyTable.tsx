import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TablePagination,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';

type Order = 'asc' | 'desc';

interface Field<DataType> {
  id: keyof DataType | 'name';
  label: string;
  numeric: boolean;
  isPercentage?: boolean;
}

interface EnergyTableProps<DataType> {
  title: string;
  data: Array<{ key: string; name: string; values: DataType }>;
  fields: Field<DataType>[];
  orderBy: keyof DataType | 'name';
  order: Order;
  onRequestSort: (property: keyof DataType | 'name') => void;
  page: number;
  rowsPerPage: number;
  onPageChange: (event: unknown, newPage: number) => void;
  onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  totalRows: number;
  linkPrefix?: string;
}

function EnergyTable<DataType>(props: EnergyTableProps<DataType>) {
  const {
    title,
    data,
    fields,
    orderBy,
    order,
    onRequestSort,
    page,
    rowsPerPage,
    onPageChange,
    onRowsPerPageChange,
    totalRows,
    linkPrefix = 'https://www.wikidata.org/wiki/',
  } = props;

  return (
    <Box sx={{ paddingBottom: 4 }}>
      <Typography variant="h5" gutterBottom>
        {title}
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell
                key="name"
                sortDirection={orderBy === 'name' ? (order as SortDirection) : false}
              >
                <TableSortLabel
                  active={orderBy === 'name'}
                  direction={orderBy === 'name' ? order : 'asc'}
                  onClick={() => onRequestSort('name')}
                >
                  Region
                  {orderBy === 'name' ? (
                    <Box component="span" sx={visuallyHidden}>
                      {order === 'desc' ? 'sorted descending' : 'sorted ascending'}
                    </Box>
                  ) : null}
                </TableSortLabel>
              </TableCell>
              {fields.map((field) => (
                <TableCell
                  key={String(field.id)}
                  align={field.numeric ? 'right' : 'left'}
                  sortDirection={orderBy === field.id ? (order as SortDirection) : false}
                >
                  <TableSortLabel
                    active={orderBy === field.id}
                    direction={orderBy === field.id ? order : 'asc'}
                    onClick={() => onRequestSort(field.id)}
                  >
                    {field.label}
                    {orderBy === field.id ? (
                      <Box component="span" sx={visuallyHidden}>
                        {order === 'desc' ? 'sorted descending' : 'sorted ascending'}
                      </Box>
                    ) : null}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map(({ key, name, values }) => (
              <TableRow hover key={key}>
                <TableCell component="th" scope="row">
                  <a
                    href={`${linkPrefix}${key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {name}
                  </a>
                </TableCell>
                {fields.map((field) => {
                  const value = values[field.id as keyof DataType];
                  let displayValue: React.ReactNode = value;
                  if (field.isPercentage && typeof value === 'number') {
                    displayValue = `${value}%`;
                  } else if (typeof value === 'number') {
                    displayValue = value.toLocaleString();
                  }
                  return (
                    <TableCell align={field.numeric ? 'right' : 'left'} key={String(field.id)}>
                      {displayValue}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          rowsPerPageOptions={[10, 25, 50, 100]}
          component="div"
          count={totalRows}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={onPageChange}
          onRowsPerPageChange={onRowsPerPageChange}
        />
      </TableContainer>
    </Box>
  );
}

export default EnergyTable;