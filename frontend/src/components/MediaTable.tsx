import React from 'react';
import { DataGrid, GridColDef, GridRowSelectionModel, GridRenderCellParams, useGridApiRef } from '@mui/x-data-grid';
import { Chip, Box, Tooltip } from '@mui/material';
import { MediaItem } from '../api';
import { motion } from 'framer-motion';

interface MediaTableProps {
    items: MediaItem[];
    selectionModel: GridRowSelectionModel;
    onSelectionModelChange: (model: GridRowSelectionModel) => void;
    processRowUpdate: (newRow: MediaItem, oldRow: MediaItem) => MediaItem;
    showMessage: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void;
}

export const MediaTable: React.FC<MediaTableProps> = ({
    items,
    selectionModel,
    onSelectionModelChange,
    processRowUpdate,
    showMessage
}) => {
    const apiRef = useGridApiRef();

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
        >
            <DataGrid
                apiRef={apiRef}
                rows={items}
                columns={columns}
                checkboxSelection
                disableRowSelectionOnClick
                onRowSelectionModelChange={onSelectionModelChange}
                rowSelectionModel={selectionModel}
                processRowUpdate={processRowUpdate}
                onCellKeyDown={(params, event) => {
                    if (event.code === 'Space') {
                        // Prevent the page from scrolling
                        event.preventDefault();
                        event.defaultMuiPrevented = true; // Prevent internal DataGrid navigation
                        // Toggle row selection
                        const isSelected = selectionModel.includes(params.id);
                        if (isSelected) {
                            onSelectionModelChange(selectionModel.filter(id => id !== params.id));
                        } else {
                            onSelectionModelChange([...selectionModel, params.id]);
                        }
                    } else if (event.code === 'F2') {
                        // If it's an editable cell, explicitly start editing using apiRef
                        if (params.isEditable) {
                            event.defaultMuiPrevented = true; // Stop default to prevent conflicts
                            apiRef.current.startCellEditMode({ id: params.id, field: params.field });
                        }
                    } else if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
                        // Copy value to clipboard
                        event.defaultMuiPrevented = true;
                        if (params.value !== undefined && params.value !== null && String(params.value).trim() !== '') {
                            navigator.clipboard.writeText(String(params.value)).then(() => {
                                showMessage('Copiato!', 'info');
                            });
                        }
                    } else if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
                        // Paste value from clipboard
                        event.defaultMuiPrevented = true;
                        if (params.isEditable) {
                            navigator.clipboard.readText().then(text => {
                                const oldRow = items.find(i => i.id === params.id);
                                if (oldRow) {
                                    let parsedValue: any = text;
                                    // Handle number columns
                                    if (params.field === 'year' || params.field === 'season' || params.field === 'episode') {
                                        parsedValue = parseInt(text, 10);
                                        if (isNaN(parsedValue)) return; // Ignore invalid number pastes
                                    }
                                    const newRow = { ...oldRow, [params.field]: parsedValue };
                                    processRowUpdate(newRow, oldRow);
                                    showMessage('Incollato!', 'success');
                                }
                            });
                        }
                    }
                }}
                sx={{
                    flexGrow: 1,
                    boxShadow: 2,
                    border: 2,
                    borderColor: 'primary.light',
                    '& .MuiDataGrid-cell:hover': {
                        color: 'primary.main',
                    },
                    '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': {
                        outline: '2px solid',
                        outlineColor: 'primary.main',
                        outlineOffset: '-2px',
                    },
                }}
            />
        </motion.div>
    );
};
