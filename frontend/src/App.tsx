import { useState, useMemo, useEffect } from 'react';
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
            fontFamily: '"Google Sans", "Outfit", "Inter", "Roboto", "Helvetica", "Arial", sans-serif',
            h3: {
                fontFamily: '"Google Sans", "Outfit", sans-serif',
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

    const [items, setItems] = useState<MediaItem[]>(() => {
        const saved = localStorage.getItem('atlas_media_items');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse saved items from localStorage');
            }
        }
        return [];
    });

    useEffect(() => {
        localStorage.setItem('atlas_media_items', JSON.stringify(items));
    }, [items]);

    const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);

    const [isScanning, setIsScanning] = useState<boolean>(false);
    const [isReanalyzing, setIsReanalyzing] = useState<boolean>(false);
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

            // Step 2: Analyze concurrently for maximum speed, while visually updating the table progressively
            const updatedItems = [...foundItems];

            const analyzePromises = foundItems.map(async (item) => {
                try {
                    const analyzed = await analyzeItem(item, bypassCache, langStr);
                    setItems(prev => {
                        const next = [...prev];
                        const idx = next.findIndex(x => x.id === item.id);
                        if (idx !== -1) next[idx] = analyzed;
                        return next;
                    });
                    const idx = updatedItems.findIndex(x => x.id === item.id);
                    if (idx !== -1) updatedItems[idx] = analyzed;
                } catch (e: any) {
                    setItems(prev => {
                        const next = [...prev];
                        const idx = next.findIndex(x => x.id === item.id);
                        if (idx !== -1) {
                            next[idx].status = 'error';
                            next[idx].message = 'Analysis failed';
                        }
                        return next;
                    });
                    const idx = updatedItems.findIndex(x => x.id === item.id);
                    if (idx !== -1) {
                        updatedItems[idx].status = 'error';
                        updatedItems[idx].message = 'Analysis failed';
                    }
                }
            });

            await Promise.all(analyzePromises);

            const finalSortedItems = sortMediaItems(updatedItems);
            setItems(finalSortedItems);
            showMessage('Analysis complete', 'success');
            // Auto-select successes for rename
            setSelectionModel(finalSortedItems.filter(i => i.status === 'matched').map(i => i.id));
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

        setIsReanalyzing(true);
        showMessage(`Re-analyzing ${selectedItems.length} items with overrides...`, 'info');

        let errorCount = 0;

        const langStr = langPins.filter(p => p.code).map(p => p.code).join(',');

        // Set selected items to pending immediately for visual feedback
        setItems(prev => prev.map(item =>
            selectionModel.includes(item.id)
                ? { ...item, status: 'pending', message: undefined }
                : item
        ));

        const analyzePromises = selectedItems.map(async (selectedItem) => {
            try {
                const analyzed = await analyzeItem(selectedItem, bypassCache, langStr);
                setItems(prev => {
                    const next = [...prev];
                    const idx = next.findIndex(x => x.id === selectedItem.id);
                    if (idx !== -1) next[idx] = analyzed;
                    return next;
                });
            } catch (e: any) {
                errorCount++;
                setItems(prev => {
                    const next = [...prev];
                    const idx = next.findIndex(x => x.id === selectedItem.id);
                    if (idx !== -1) {
                        next[idx].status = 'error';
                        next[idx].message = 'Re-analysis failed';
                    }
                    return next;
                });
            }
        });

        await Promise.all(analyzePromises);

        setIsReanalyzing(false);
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
                    <Box sx={{ position: 'absolute', left: 0, display: 'flex', alignItems: 'center', pl: 2 }}>
                        <Typography variant="body2" color="text.secondary" fontWeight="bold" sx={{ opacity: 0.7 }}>
                            v1.6.0
                        </Typography>
                    </Box>
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
                    onRestoreSort={handleRestoreSort}
                    onClear={() => setItems([])}
                    hasItems={items.length > 0}
                    isScanning={isScanning}
                    isReanalyzing={isReanalyzing}
                    isRenaming={isRenaming}
                    selectedCount={selectionModel.length}
                />

                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                    <MediaTable
                        items={items}
                        selectionModel={selectionModel}
                        onSelectionModelChange={setSelectionModel}
                        processRowUpdate={processRowUpdate}
                        showMessage={showMessage}
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
