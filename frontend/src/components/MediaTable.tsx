import React from 'react';
import { DataGrid, GridColDef, GridRowSelectionModel, GridRenderCellParams, useGridApiRef } from '@mui/x-data-grid';
import { Chip, Box, Tooltip, useTheme } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { MediaItem } from '../api';
import { motion } from 'framer-motion';

interface MediaTableProps {
    items: MediaItem[];
    selectionModel: GridRowSelectionModel;
    onSelectionModelChange: (model: GridRowSelectionModel) => void;
    processRowUpdate: (newRow: MediaItem, oldRow: MediaItem) => MediaItem;
    showMessage: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void;
}

const isSeasonValid = (season: any) => {
    if (season === undefined || season === null || season === '') return true;
    const num = Number(season);
    return Number.isInteger(num) && num >= 0 && num <= 99;
};

const isEpisodeValid = (episode: any) => {
    if (episode === undefined || episode === null || episode === '') return false;
    if (typeof episode === 'number') {
        return Number.isInteger(episode) && episode >= 1 && episode <= 9999;
    }
    const str = String(episode).trim();
    if (!str) return false;

    if (/^\d+$/.test(str)) {
        const num = parseInt(str, 10);
        return num >= 1 && num <= 9999;
    }

    const match = str.match(/^(\d+)-(\d+)$/);
    if (match) {
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        return start >= 1 && start <= 9999 && end >= 1 && end <= 9999 && start < end;
    }

    return false;
};

const isYearValid = (year: any) => {
    if (year === undefined || year === null || year === '') return true;
    const num = Number(year);
    return Number.isInteger(num) && num >= 1900 && num <= 2100;
};

const isRowValid = (row: MediaItem) => {
    if (row.original_name === row.proposed_name) return false;
    if (row.media_type !== 'movie' && row.media_type !== 'episode') return false;
    if (!isYearValid(row.year)) return false;
    if (row.media_type === 'episode') {
        if (!isSeasonValid(row.season)) return false;
        if (!isEpisodeValid(row.episode)) return false;
    }
    return true;
};

export const MediaTable: React.FC<MediaTableProps> = ({
    items,
    selectionModel,
    onSelectionModelChange,
    processRowUpdate,
    showMessage
}) => {
    const apiRef = useGridApiRef();
    const theme = useTheme();

    const renderCellWithError = (params: GridRenderCellParams, isValid: boolean) => {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
                <Box sx={{ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {params.formattedValue}
                </Box>
                {!isValid && (
                    <Tooltip title="Formato Valore Invalido">
                        <ErrorOutlineIcon color="error" fontSize="small" sx={{ ml: 1, opacity: 0.8 }} />
                    </Tooltip>
                )}
            </Box>
        );
    };

    const columns: GridColDef[] = [
        {
            field: 'media_type', headerName: 'Type', width: 100, editable: true, type: 'singleSelect', valueOptions: ['movie', 'episode', 'unknown'],
            cellClassName: (params) => (params.value !== 'movie' && params.value !== 'episode') ? 'cell-error' : '',
            renderCell: (params: GridRenderCellParams) => {
                const isMovie = params.value === 'movie';
                const isEpisode = params.value === 'episode';

                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%' }}>
                        <Chip
                            size="small"
                            label={params.value}
                            color={isMovie ? 'primary' : 'default'}
                            sx={
                                isMovie ? {} :
                                    isEpisode ? { bgcolor: '#e65100', color: 'white' } :
                                        { bgcolor: theme.palette.mode === 'dark' ? 'error.dark' : 'error.light', color: 'error.contrastText' }
                            }
                        />
                    </Box>
                );
            }
        },
        { field: 'original_name', headerName: 'Original Name', flex: 1, minWidth: 200 },
        { field: 'clean_title', headerName: 'Title', width: 250, editable: true },
        {
            field: 'year', headerName: 'Year', width: 80, editable: true, type: 'number',
            cellClassName: (params) => !isYearValid(params.value) ? 'cell-error' : '',
            renderCell: (params) => renderCellWithError(params, isYearValid(params.value))
        },
        {
            field: 'season', headerName: 'Season', width: 80, editable: true, type: 'number',
            cellClassName: (params) => (params.row.media_type === 'episode' && !isSeasonValid(params.value)) ? 'cell-error' : '',
            renderCell: (params) => renderCellWithError(params, !(params.row.media_type === 'episode' && !isSeasonValid(params.value)))
        },
        {
            field: 'episode', headerName: 'Episode', width: 100, editable: true,
            cellClassName: (params) => (params.row.media_type === 'episode' && !isEpisodeValid(params.value)) ? 'cell-error' : '',
            renderCell: (params) => renderCellWithError(params, !(params.row.media_type === 'episode' && !isEpisodeValid(params.value)))
        },
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
                isRowSelectable={(params) => isRowValid(params.row)}
                onRowSelectionModelChange={onSelectionModelChange}
                rowSelectionModel={selectionModel}
                processRowUpdate={processRowUpdate}
                onCellKeyDown={(params, event) => {
                    if (event.code === 'Space') {
                        // Prevent the page from scrolling
                        event.preventDefault();
                        event.defaultMuiPrevented = true; // Prevent internal DataGrid navigation

                        // Block selection if row is invalid
                        if (!isRowValid(params.row)) return;

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
                                    if (params.field === 'year' || params.field === 'season') {
                                        parsedValue = parseInt(text, 10);
                                        if (isNaN(parsedValue)) return; // Ignore invalid number pastes
                                    } else if (params.field === 'episode') {
                                        parsedValue = text;
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
                    '& .cell-error': {
                        color: 'error.main',
                        outline: '1px solid',
                        outlineColor: 'error.main',
                        outlineOffset: '-1px',
                        backgroundColor: theme.palette.mode === 'dark' ? 'rgba(211, 47, 47, 0.15)' : 'rgba(211, 47, 47, 0.05)',
                        '&:hover': {
                            backgroundColor: theme.palette.mode === 'dark' ? 'rgba(211, 47, 47, 0.25)' : 'rgba(211, 47, 47, 0.1)',
                        }
                    }
                }}
            />
        </motion.div>
    );
};
