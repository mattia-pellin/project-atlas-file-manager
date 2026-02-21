import React from 'react';
import { DataGrid, GridColDef, GridRowSelectionModel, GridRenderCellParams } from '@mui/x-data-grid';
import { Chip, Box, Tooltip } from '@mui/material';
import { MediaItem } from '../api';
import { motion } from 'framer-motion';

interface MediaTableProps {
    items: MediaItem[];
    selectionModel: GridRowSelectionModel;
    onSelectionModelChange: (model: GridRowSelectionModel) => void;
    processRowUpdate: (newRow: MediaItem, oldRow: MediaItem) => MediaItem;
}

export const MediaTable: React.FC<MediaTableProps> = ({
    items,
    selectionModel,
    onSelectionModelChange,
    processRowUpdate
}) => {
    const columns: GridColDef[] = [
        {
            field: 'media_type', headerName: 'Type', width: 100, editable: true, type: 'singleSelect', valueOptions: ['movie', 'episode', 'unknown'],
            renderCell: (params: GridRenderCellParams) => (
                <Chip size="small" label={params.value} sx={params.value === 'movie' ? {} : { bgcolor: '#e65100', color: 'white' }} color={params.value === 'movie' ? 'primary' : 'default'} />
            )
        },
        { field: 'original_name', headerName: 'Original Name', flex: 1, minWidth: 200 },
        { field: 'clean_title', headerName: 'Title', width: 250, editable: true },
        { field: 'year', headerName: 'Year', width: 80, editable: true, type: 'number' },
        { field: 'season', headerName: 'Season', width: 80, editable: true, type: 'number' },
        { field: 'episode', headerName: 'Episode', width: 80, editable: true, type: 'number' },
        { field: 'proposed_name', headerName: 'Proposed Name', width: 350, editable: true },
        {
            field: 'status', headerName: 'Status', width: 120,
            renderCell: (params: GridRenderCellParams) => {
                const colorMap: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
                    'pending': 'default',
                    'matched': 'info',
                    'success': 'success',
                    'error': 'error',
                    'renaming': 'warning'
                };
                return (
                    <Tooltip title={params.row.message || ''} placement="top" disableHoverListener={!params.row.message}>
                        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', overflow: 'hidden' }}>
                            <Chip size="small" label={params.value} color={colorMap[params.value] || 'default'} />
                        </Box>
                    </Tooltip>
                );
            }
        }
    ];

    return (
        <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}
            onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    // Small delay to let DataGrid finish shifting focus
                    setTimeout(() => {
                        const activeElement = document.activeElement;
                        const row = activeElement?.closest('.MuiDataGrid-row');
                        if (row) {
                            const rowId = row.getAttribute('data-id');
                            if (rowId) {
                                // Sync the row selection strictly to the newly focused row
                                onSelectionModelChange([rowId]);
                            }
                        }
                    }, 10);
                }
            }}
        >
            <DataGrid
                rows={items}
                columns={columns}
                checkboxSelection
                disableRowSelectionOnClick
                onRowSelectionModelChange={onSelectionModelChange}
                rowSelectionModel={selectionModel}
                processRowUpdate={processRowUpdate}
                sx={{
                    flexGrow: 1,
                    boxShadow: 2,
                    border: 2,
                    borderColor: 'primary.light',
                    '& .MuiDataGrid-cell:hover': {
                        color: 'primary.main',
                    },
                }}
            />
        </motion.div>
    );
};
