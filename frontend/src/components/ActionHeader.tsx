import React from 'react';
import { Box, Button, TextField, FormControlLabel, Switch, Typography, Paper } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
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
    isScanning: boolean;
    selectedCount: number;
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
    isScanning,
    selectedCount
}) => {
    return (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: 0.1 }}>
            <Paper sx={{ p: 4, mb: 4, display: 'flex', flexDirection: 'column', gap: 3, borderRadius: 4 }}>
                <Typography variant="h5" sx={{ fontFamily: '"Outfit", sans-serif', fontWeight: 600, color: 'primary.light' }}>Configuration & Actions</Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TextField
                        label="Target Directory"
                        variant="outlined"
                        fullWidth
                        value={directory}
                        onChange={(e) => setDirectory(e.target.value)}
                        placeholder="/media/shows"
                        size="small"
                        sx={{ minWidth: 250 }}
                    />
                    <LanguagePins pins={langPins} setPins={setLangPins} />
                    <Box sx={{ display: 'flex', alignItems: 'center', height: 40, mt: { xs: 0, sm: 'auto' }, mb: { xs: 0, sm: 1 } }}>
                        <FormControlLabel
                            control={<Switch checked={bypassCache} onChange={(e) => setBypassCache(e.target.checked)} />}
                            label="Bypass API Cache"
                            sx={{ m: 0 }}
                        />
                    </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-start' }}>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<FolderIcon />}
                        onClick={onScan}
                        disabled={!directory || isScanning}
                    >
                        {isScanning ? 'Scanning & Analyzing...' : 'Scan Directory'}
                    </Button>
                    <Button
                        variant="contained"
                        color="secondary"
                        startIcon={<RefreshIcon />}
                        onClick={onReAnalyze}
                        disabled={selectedCount === 0 || isScanning}
                        sx={{ ml: 'auto' }}
                    >
                        Re-Analyze Selected ({selectedCount})
                    </Button>
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<SaveIcon />}
                        onClick={onRename}
                        disabled={selectedCount === 0 || isScanning}
                    >
                        Execute Rename ({selectedCount})
                    </Button>
                </Box>
            </Paper>
        </motion.div>
    );
};
