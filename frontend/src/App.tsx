import { useState, useMemo } from 'react';
import { useMediaQuery, ThemeProvider, createTheme, CssBaseline, Box, Typography, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Slider, Stack } from '@mui/material';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { MediaItem, scanDirectory, analyzeItem, renameItems } from './api';
import { ActionHeader } from './components/ActionHeader';
import { MediaTable } from './components/MediaTable';
import { LanguagePin } from './components/LanguagePins';
import { GridRowSelectionModel } from '@mui/x-data-grid';
import { motion } from 'framer-motion';

function App() {
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');

    // Material 3 Expressive Theme setup
    const isDark = themeMode === 'system' ? prefersDarkMode : themeMode === 'dark';
    const theme = useMemo(() => createTheme({
        palette: {
            mode: isDark ? 'dark' : 'light',
            primary: {
                main: '#e5a00d', // Plex Orange
                light: '#ffc107',
                dark: '#f57c00',
            },
            secondary: {
                main: '#00e5ff', // Vibrant cyan for high contrast
            },
            background: {
                default: isDark ? '#121212' : '#f8f9fa',
                paper: isDark ? '#1e1e1e' : '#ffffff',
            },
        },
        shape: {
            borderRadius: 16,
        },
        typography: {
            fontFamily: '"Inter", "Helvetica", "Arial", sans-serif',
            h3: {
                fontFamily: '"Outfit", sans-serif',
                fontWeight: 800,
                color: '#e5a00d',
                letterSpacing: '-1.5px',
            },
        },
        components: {
            MuiButton: {
                styleOverrides: {
                    root: {
                        textTransform: 'none',
                        fontWeight: 600,
                        borderRadius: 24,
                        padding: '8px 24px',
                    },
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root: {
                        backgroundImage: 'none',
                        boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.4)' : '0 8px 32px rgba(145,158,171,0.2)',
                    },
                },
            },
        },
    }), [isDark]);
    const [directory, setDirectory] = useState<string>('/media');
    const [bypassCache, setBypassCache] = useState<boolean>(false);

    // Initial language pins configuration
    const [langPins, setLangPins] = useState<LanguagePin[]>([
        { id: 'it-init', input: 'it', name: 'Italian', code: 'it' },
        { id: 'en-init', input: 'en', name: 'English', code: 'en' }
    ]);

    const [items, setItems] = useState<MediaItem[]>([]);
    const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);

    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [isRenaming, setIsRenaming] = useState<boolean>(false);

    const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '', severity: 'info' });
    const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

    const showMessage = (message: string, severity: 'success' | 'error' | 'info' | 'warning') => {
        setSnackbar({ open: true, message, severity });
    };

    const sortMediaItems = (mediaList: MediaItem[]) => {
        return [...mediaList].sort((a, b) => {
            if (a.media_type === 'movie' && b.media_type !== 'movie') return -1;
            if (b.media_type === 'movie' && a.media_type !== 'movie') return 1;

            if (a.media_type === 'episode' && b.media_type === 'episode') {
                const titleA = (a.clean_title || '').toLowerCase();
                const titleB = (b.clean_title || '').toLowerCase();

                if (titleA < titleB) return -1;
                if (titleA > titleB) return 1;

                if ((a.season || 0) !== (b.season || 0)) {
                    return (a.season || 0) - (b.season || 0);
                }

                return (a.episode || 0) - (b.episode || 0);
            }

            return 0; // fallback
        });
    };

    const handleRestoreSort = () => {
        setItems(prev => sortMediaItems(prev));
        showMessage('Restored default sorting order', 'info');
    };

    const handleScan = async () => {
        if (!directory) {
            showMessage('Please provide a directory', 'error');
            return;
        }
        setIsScanning(true);
        setItems([]);
        setSelectionModel([]);
        try {
            // Build valid codes only, preserve order
            const langStr = langPins.filter(p => p.code).map(p => p.code).join(',');

            // Step 1: Scan
            const foundItems = await scanDirectory(directory, bypassCache, langStr);
            setItems(sortMediaItems(foundItems));
            showMessage(`Found ${foundItems.length} media files. Analyzing...`, 'info');

            // Step 2: Analyze sequentially to avoid hammering API too aggressively
            // We could batch this, but for UX, seeing them pop up is nice
            const updatedItems = [...foundItems];
            for (let i = 0; i < updatedItems.length; i++) {
                try {
                    const analyzed = await analyzeItem(updatedItems[i], bypassCache, langStr);
                    updatedItems[i] = analyzed;
                    setItems([...updatedItems]);
                } catch (e: any) {
                    updatedItems[i].status = 'error';
                    updatedItems[i].message = 'Analysis failed';
                    setItems([...updatedItems]);
                }
            }
            showMessage('Analysis complete', 'success');
            // Auto-select successes for rename
            setSelectionModel(updatedItems.filter(i => i.status === 'pending').map(i => i.id));
        } catch (e: any) {
            showMessage(`Scan failed: ${e.message}`, 'error');
        } finally {
            setIsScanning(false);
        }
    };

    const handleRenameConfirm = async () => {
        setConfirmOpen(false);
        setIsRenaming(true);
        const selectedItems = items.filter(i => selectionModel.includes(i.id));
        try {
            const results = await renameItems(selectedItems);
            // Update UI with results
            const resultsMap = new Map(results.map(i => [i.id, i]));
            setItems(prev => sortMediaItems(prev.map(item => resultsMap.get(item.id) || item)));

            const successCount = results.filter(i => i.status === 'success').length;
            if (successCount === selectedItems.length) {
                showMessage(`Successfully renamed ${successCount} files`, 'success');
                setSelectionModel([]); // clear selection
            } else {
                showMessage(`Renamed ${successCount}/${selectedItems.length} files. Check table for errors.`, 'error');
                // Keep failed ones selected
                setSelectionModel(results.filter(i => i.status !== 'success').map(i => i.id));
            }
        } catch (e: any) {
            showMessage(`Rename failed: ${e.message}`, 'error');
        } finally {
            setIsRenaming(false);
        }
    };

    const handleReAnalyze = async () => {
        const selectedItems = items.filter(i => selectionModel.includes(i.id));
        if (selectedItems.length === 0) return;

        setIsScanning(true);
        showMessage(`Re-analyzing ${selectedItems.length} items with overrides...`, 'info');

        const updatedItems = [...items];
        let errorCount = 0;

        const langStr = langPins.filter(p => p.code).map(p => p.code).join(',');

        for (let selectedItem of selectedItems) {
            const index = updatedItems.findIndex(i => i.id === selectedItem.id);
            if (index !== -1) {
                try {
                    const analyzed = await analyzeItem(updatedItems[index], bypassCache, langStr);
                    updatedItems[index] = analyzed;
                } catch (e: any) {
                    updatedItems[index].status = 'error';
                    updatedItems[index].message = 'Re-analysis failed';
                    errorCount++;
                }
                setItems([...updatedItems]);
            }
        }

        setIsScanning(false);
        if (errorCount === 0) {
            showMessage(`Successfully re-analyzed ${selectedItems.length} items.`, 'success');
        } else {
            showMessage(`Re-analyzed ${selectedItems.length} items. ${errorCount} errors occurred.`, 'warning');
        }
    };

    const processRowUpdate = (newRow: MediaItem, oldRow: MediaItem) => {
        // Find what changed
        const updated = { ...oldRow, ...newRow };
        // We only mark status = pending if something actually changed that requires re-analysis
        // We removed the hardcoded "Manually modified" message behavior per request
        if (
            newRow.clean_title !== oldRow.clean_title ||
            newRow.media_type !== oldRow.media_type ||
            newRow.year !== oldRow.year ||
            newRow.season !== oldRow.season ||
            newRow.episode !== oldRow.episode
        ) {
            updated.status = 'pending';
            // We drop the explicit message so it merges cleanly with status chip logic later
            updated.message = '';
        }

        setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
        return updated;
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', p: { xs: 2, md: 4 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 2, position: 'relative' }}>
                    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: "easeOut" }}>
                        <Typography variant="h3" component="h1" align="center" sx={{ mb: 0 }}>
                            Project: Atlas - File Manager
                        </Typography>
                    </motion.div>
                    <Box sx={{ position: 'absolute', right: 0, display: 'flex', alignItems: 'center', pr: 2 }}>
                        <Stack spacing={2} direction="row" sx={{ mb: 1, alignItems: 'center', width: 100 }}>
                            <Brightness7Icon
                                fontSize="small"
                                color={!isDark ? 'primary' : 'action'}
                                onClick={() => setThemeMode('light')}
                                sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                            />
                            <Slider
                                value={isDark ? 1 : 0}
                                min={0}
                                max={1}
                                step={1}
                                track={false}
                                onChange={(_, val) => {
                                    setThemeMode(val === 0 ? 'light' : 'dark');
                                }}
                                sx={{
                                    height: 8,
                                    '& .MuiSlider-thumb': {
                                        width: 16,
                                        height: 16,
                                    },
                                    '& .MuiSlider-rail': {
                                        opacity: 0.5,
                                    }
                                }}
                            />
                            <Brightness4Icon
                                fontSize="small"
                                color={isDark ? 'primary' : 'action'}
                                onClick={() => setThemeMode('dark')}
                                sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                            />
                        </Stack>
                    </Box>
                </Box>

                <ActionHeader
                    directory={directory} setDirectory={setDirectory}
                    bypassCache={bypassCache} setBypassCache={setBypassCache}
                    langPins={langPins} setLangPins={setLangPins}
                    onScan={handleScan}
                    onRename={() => setConfirmOpen(true)}
                    onReAnalyze={handleReAnalyze}
                    isScanning={isScanning || isRenaming}
                    selectedCount={selectionModel.length}
                />

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                    <Button variant="text" size="small" onClick={handleRestoreSort} disabled={items.length === 0}>
                        Restore Default Sort
                    </Button>
                </Box>

                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                    <MediaTable
                        items={items}
                        selectionModel={selectionModel}
                        onSelectionModelChange={setSelectionModel}
                        processRowUpdate={processRowUpdate}
                    />
                </Box>

                <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
                    <DialogTitle>Confirm Mass Rename</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            Are you sure you want to rename {selectionModel.length} files? This will alter the filesystem directly.
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
                        <Button onClick={handleRenameConfirm} variant="contained" color="secondary" autoFocus>
                            Execute Rename
                        </Button>
                    </DialogActions>
                </Dialog>

                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={6000}
                    onClose={() => setSnackbar({ ...snackbar, open: false })}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                >
                    <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity} sx={{ width: '100%' }}>
                        {snackbar.message}
                    </Alert>
                </Snackbar>

            </Box>
        </ThemeProvider>
    )
}

export default App
