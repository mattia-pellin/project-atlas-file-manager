import React, { useState } from 'react';
import { Box, Button, TextField, FormControlLabel, Switch, Typography, Paper, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import FilterListIcon from '@mui/icons-material/FilterList';
import SettingsIcon from '@mui/icons-material/Settings';
import DeleteIcon from '@mui/icons-material/Delete';
import { motion } from 'framer-motion';
import { LanguagePins, LanguagePin } from './LanguagePins';

interface ActionHeaderProps {
    directory: string;
    setDirectory: (val: string) => void;
    bypassCache: boolean;
    setBypassCache: (val: boolean) => void;
    langPins: LanguagePin[];
    setLangPins: React.Dispatch<React.SetStateAction<LanguagePin[]>>;
    onScan: () => void;
    onRename: () => void;
    onReAnalyze: () => void;
    onRestoreSort: () => void;
    onClear: () => void;
    isScanning: boolean;
    isReanalyzing: boolean;
    isRenaming: boolean;
    selectedCount: number;
    hasItems: boolean;
}

export const ActionHeader: React.FC<ActionHeaderProps> = ({
    directory,
    setDirectory,
    bypassCache,
    setBypassCache,
    langPins,
    setLangPins,
    onScan,
    onRename,
    onReAnalyze,
    onRestoreSort,
    onClear,
    isScanning,
    isReanalyzing,
    isRenaming,
    selectedCount,
    hasItems
}) => {
    const [settingsOpen, setSettingsOpen] = useState(false);

    return (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <Paper sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 2, borderRadius: 3, flexWrap: 'wrap' }}>
                <TextField
                    label="Target Directory"
                    variant="outlined"
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                    placeholder="/media/shows"
                    size="small"
                    sx={{ flex: 1, minWidth: 200, maxWidth: 400 }}
                />
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<FolderIcon />}
                    onClick={onScan}
                    disabled={!directory || isScanning || isReanalyzing || isRenaming}
                >
                    {isScanning ? 'Scanning...' : 'Scan'}
                </Button>

                <Box sx={{ flexGrow: 1 }} />

                <Tooltip title="Restore multi-tiered custom sort (Movies first, then TV Shows ordered)">
                    <span>
                        <Button
                            variant="text"
                            color="inherit"
                            startIcon={<FilterListIcon />}
                            onClick={onRestoreSort}
                            disabled={!hasItems || isScanning || isReanalyzing || isRenaming}
                            sx={{ mr: 1, color: 'text.secondary' }}
                        >
                            Sort
                        </Button>
                    </span>
                </Tooltip>
                <Tooltip title="Clear table and remove from storage">
                    <span>
                        <Button
                            variant="text"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={onClear}
                            disabled={!hasItems || isScanning || isReanalyzing || isRenaming}
                            sx={{ mr: 2 }}
                        >
                            Clear
                        </Button>
                    </span>
                </Tooltip>

                <Button
                    variant="outlined"
                    color="primary"
                    startIcon={<RefreshIcon />}
                    onClick={onReAnalyze}
                    disabled={selectedCount === 0 || isScanning || isReanalyzing || isRenaming}
                >
                    {isReanalyzing ? 'Analyzing...' : `Re-Analyze (${selectedCount})`}
                </Button>
                <Button
                    variant="contained"
                    color="primary"
                    startIcon={<SaveIcon />}
                    onClick={onRename}
                    disabled={selectedCount === 0 || isScanning || isReanalyzing || isRenaming}
                >
                    Rename ({selectedCount})
                </Button>
                <Tooltip title="Configure API Settings">
                    <IconButton onClick={() => setSettingsOpen(true)} color="primary" sx={{ ml: 1 }}>
                        <SettingsIcon />
                    </IconButton>
                </Tooltip>
            </Paper>

            <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth disableScrollLock>
                <DialogTitle sx={{ fontFamily: '"Outfit", sans-serif', fontWeight: 600 }}>Advanced Settings</DialogTitle>
                <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Box>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 500 }}>
                            Language Fallback Priority
                        </Typography>
                        <LanguagePins pins={langPins} setPins={setLangPins} />
                    </Box>
                    <Box>
                        <FormControlLabel
                            control={<Switch checked={bypassCache} onChange={(e) => setBypassCache(e.target.checked)} color="primary" />}
                            label={<Typography sx={{ fontWeight: 500 }}>Bypass API Cache</Typography>}
                        />
                        <Typography variant="body2" color="text.secondary" sx={{ pl: 4, mt: -0.5 }}>
                            Force a fresh fetch from TMDB/TVDB instead of using cached data.
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions sx={{ p: 2 }}>
                    <Button variant="outlined" onClick={() => setSettingsOpen(false)}>Done</Button>
                </DialogActions>
            </Dialog>
        </motion.div>
    );
};
