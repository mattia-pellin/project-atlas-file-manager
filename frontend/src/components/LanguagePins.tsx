import React, { useState } from 'react';
import { Box, Chip, TextField, Typography, useTheme } from '@mui/material';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Comprehensive map of input to [full_name, iso_code]
const LANGUAGE_MAP: Record<string, { name: string, code: string }> = {
    'english': { name: 'English', code: 'en' },
    'en': { name: 'English', code: 'en' },
    'italian': { name: 'Italian', code: 'it' },
    'it': { name: 'Italian', code: 'it' },
    'ita': { name: 'Italian', code: 'it' },
    'spanish': { name: 'Spanish', code: 'es' },
    'es': { name: 'Spanish', code: 'es' },
    'french': { name: 'French', code: 'fr' },
    'fr': { name: 'French', code: 'fr' },
    'german': { name: 'German', code: 'de' },
    'de': { name: 'German', code: 'de' },
    'japanese': { name: 'Japanese', code: 'ja' },
    'ja': { name: 'Japanese', code: 'ja' },
    'korean': { name: 'Korean', code: 'ko' },
    'ko': { name: 'Korean', code: 'ko' },
    'chinese': { name: 'Chinese', code: 'zh' },
    'zh': { name: 'Chinese', code: 'zh' },
    'portuguese': { name: 'Portuguese', code: 'pt' },
    'pt': { name: 'Portuguese', code: 'pt' },
    'russian': { name: 'Russian', code: 'ru' },
    'ru': { name: 'Russian', code: 'ru' },
    'dutch': { name: 'Dutch', code: 'nl' },
    'nl': { name: 'Dutch', code: 'nl' },
};

interface SortablePinProps {
    id: string;
    label: string;
    isValid: boolean;
    onDelete: (id: string) => void;
}

const SortablePin = ({ id, label, isValid, onDelete }: SortablePinProps) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : 1,
        opacity: isDragging ? 0.8 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <Chip
                label={label}
                onDelete={() => onDelete(id)}
                color={isValid ? 'primary' : 'error'}
                variant={isValid ? 'filled' : 'outlined'}
                sx={{ cursor: 'grab', '&:active': { cursor: 'grabbing' } }}
            />
        </div>
    );
};

export interface LanguagePin {
    id: string; // unique string like 'it-123'
    input: string; // what the user typed 'italian'
    name: string | null; // formatted full name 'Italian'
    code: string | null; // mapped code 'it' or null if invalid
}

interface LanguagePinsProps {
    pins: LanguagePin[];
    setPins: React.Dispatch<React.SetStateAction<LanguagePin[]>>;
}

export const LanguagePins: React.FC<LanguagePinsProps> = ({ pins, setPins }) => {
    const [inputValue, setInputValue] = useState('');
    const muiTheme = useTheme();

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = inputValue.trim().toLowerCase();
            if (!val) return;
            const match = LANGUAGE_MAP[val];
            const newPin: LanguagePin = {
                id: `${val}-${Date.now()}`,
                input: inputValue.trim(),
                name: match ? match.name : null,
                code: match ? match.code : null
            };

            setPins((prev) => [...prev, newPin]);
            setInputValue('');
        }
    };

    const handleDelete = (idToRemove: string) => {
        setPins((prev) => prev.filter(p => p.id !== idToRemove));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            setPins((items) => {
                const oldIndex = items.findIndex((i) => i.id === active.id);
                const newIndex = items.findIndex((i) => i.id === over?.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 300, flexGrow: 1 }}>
            <Typography variant="caption" color="text.secondary">Language Fallback Priority (Drag to reorder)</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minHeight: 40, p: 1, border: `1px solid ${muiTheme.palette.divider}`, borderRadius: 1 }}>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={pins.map(p => p.id)} strategy={horizontalListSortingStrategy}>
                        {pins.map((pin) => (
                            <SortablePin
                                key={pin.id}
                                id={pin.id}
                                label={pin.code && pin.name ? `${pin.name} (${pin.code})` : `${pin.input} (Invalid)`}
                                isValid={pin.code !== null}
                                onDelete={handleDelete}
                            />
                        ))}
                    </SortableContext>
                </DndContext>

                <TextField
                    variant="standard"
                    placeholder={pins.length === 0 ? "Type language (e.g. italian) & Enter" : "Add language..."}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    InputProps={{ disableUnderline: true }}
                    sx={{ minWidth: 150, flexGrow: 1 }}
                />
            </Box>
        </Box>
    );
};
