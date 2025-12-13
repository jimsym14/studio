import React, { memo } from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GuessScore } from '@/lib/wordle';

export type GridRowState = 'submitted' | 'active' | 'empty';

export interface GridRow {
    letters: string[];
    evaluations: (GuessScore | null)[];
    state: GridRowState;
    isPeerInput?: boolean;
}

interface GameGridProps {
    wordLength: number;
    rows: GridRow[];
    isLightMode: boolean;
    revealedTiles: Record<string, boolean>;
    selectedIndex: number | null;
    lockedIndices: Set<number>;
    tilePulse: { index: number; id: number } | null;
    onTileClick: (colIndex: number, isActive: boolean, e: React.MouseEvent) => void;
    onTileTouchStart: (colIndex: number, isActive: boolean) => void;
    onTileTouchEnd: (colIndex: number, e: React.TouchEvent | React.MouseEvent) => void;
    onTileMouseDown: (colIndex: number, isActive: boolean, e: React.MouseEvent) => void;
    onTileMouseUp: (colIndex: number, e: React.MouseEvent) => void;
    onTileMouseLeave: (colIndex: number, e: React.MouseEvent) => void;
    variant?: 'standard' | 'newspaper';
}

const tileTone: Record<GuessScore, string> = {
    correct: 'border-transparent bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-[0_18px_45px_rgba(0,0,0,0.25)]',
    present: 'border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_18px_45px_rgba(0,0,0,0.22)]',
    absent: 'bg-muted text-muted-foreground',
};

// Global CSS moved outside component to avoid re-processing on every render
const gridStyles = `
    @keyframes newspaper-slam-light {
        0% { transform: translate(-4px, -4px); box-shadow: 8px 8px 0 0 rgba(0,0,0,1); }
        100% { transform: translate(0, 0); box-shadow: 2px 2px 0 0 rgba(0,0,0,1); }
    }
    @keyframes newspaper-slam-dark {
        0% { transform: translate(-4px, -4px); box-shadow: 8px 8px 0 0 rgba(255,255,255,1); }
        100% { transform: translate(0, 0); box-shadow: 2px 2px 0 0 rgba(255,255,255,1); }
    }
    .animate-newspaper-slam {
        animation: newspaper-slam-light 0.15s ease-out forwards;
    }
    .dark .animate-newspaper-slam {
        animation: newspaper-slam-dark 0.15s ease-out forwards;
    }
`;

function GameGridComponent({
    wordLength,
    rows,
    isLightMode,
    revealedTiles,
    selectedIndex,
    lockedIndices,
    tilePulse,
    onTileClick,
    onTileTouchStart,
    onTileTouchEnd,
    onTileMouseDown,
    onTileMouseUp,
    onTileMouseLeave,
    variant = 'standard'
}: GameGridProps) {
    return (
        <div className="grid gap-2">
            <style jsx global>{gridStyles}</style>
            {rows.map((row, rowIndex) => {
                return (
                    <div
                        key={rowIndex}
                        className="mx-auto grid w-full max-w-[min(92vw,420px)] gap-2 sm:gap-3"
                        style={{ gridTemplateColumns: `repeat(${wordLength}, minmax(0, 1fr))` }}
                    >
                        {row.letters.map((letter, colIndex) => {
                            const evaluation = row.evaluations[colIndex];
                            const isSubmitted = row.state === 'submitted';
                            const tileKey = `${rowIndex}-${colIndex}`;

                            let content = letter;
                            const newspaperBase = cn(
                                'bg-white border-black/10 text-black',
                                !isLightMode && 'bg-zinc-900 border-white/10 text-white'
                            );

                            let className = cn(
                                'group relative flex aspect-square items-center justify-center rounded-xl border-2 text-2xl font-bold uppercase transition-all duration-300 sm:rounded-2xl sm:text-4xl',
                                variant === 'newspaper' && 'rounded-none font-serif tracking-widest sm:rounded-none border',
                                'select-none',
                                variant === 'newspaper'
                                    ? newspaperBase
                                    : isLightMode
                                        ? 'bg-white border-transparent text-[#2b1409] shadow-[inset_0_-4px_4px_rgba(0,0,0,0.05),0_4px_10px_rgba(0,0,0,0.1)]'
                                        : 'bg-[#1a1d26] border-transparent text-white shadow-[0_4px_12px_rgba(0,0,0,0.25)]'
                            );

                            if (isSubmitted) {
                                if (revealedTiles[tileKey]) {
                                    className = cn(
                                        'group relative flex aspect-square items-center justify-center rounded-xl border-2 text-2xl font-bold uppercase transition-all duration-500 sm:rounded-2xl sm:text-4xl',
                                        variant === 'newspaper' && 'rounded-none sm:rounded-none font-serif border-black/20 shadow-none',
                                        evaluation ? tileTone[evaluation as GuessScore] : '',
                                        // Newspaper overrides for submitted state
                                        variant === 'newspaper' && evaluation === 'correct' && 'bg-green-600 text-white border-green-700 shadow-[3px_3px_0_0_rgba(0,0,0,0.2)]',
                                        variant === 'newspaper' && evaluation === 'present' && 'bg-orange-500 text-white border-orange-600 shadow-[3px_3px_0_0_rgba(0,0,0,0.2)]',
                                        variant === 'newspaper' && evaluation === 'absent' && cn(
                                            'bg-white text-zinc-400 border-zinc-300 shadow-[2px_2px_0_0_rgba(0,0,0,0.05)]',
                                            !isLightMode && 'bg-zinc-800 text-zinc-500 border-zinc-700 shadow-none'
                                        )
                                    );
                                }
                            } else if (row.state === 'active') {
                                const isActive = letter !== ' ';
                                const isSelected = selectedIndex === colIndex;
                                const isLocked = lockedIndices.has(colIndex);
                                const isPulse = tilePulse?.index === colIndex && tilePulse.id > 0;
                                const isPeerInput = Boolean(row.isPeerInput);

                                // Prepare colors for Active Row Newspaper Variant
                                const newspaperEmpty = cn(
                                    'bg-white border-black/20 text-black',
                                    !isLightMode && 'bg-zinc-900 border-white/20 text-white'
                                );

                                const newspaperFilled = cn(
                                    'border-[2px] border-black bg-white text-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]',
                                    !isLightMode && 'bg-zinc-900 text-white border-white shadow-[2px_2px_0_0_rgba(255,255,255,1)]'
                                );

                                className = cn(
                                    'group relative flex aspect-square items-center justify-center rounded-xl border-2 text-2xl font-bold uppercase transition-all duration-100 sm:rounded-2xl sm:text-4xl',
                                    variant === 'newspaper' && 'rounded-none font-serif tracking-widest sm:rounded-none border transition-all duration-100',

                                    // NEWSPAPER VARIANT STYLES
                                    // ALL tiles in active row get the "Filled" style with shadow
                                    variant === 'newspaper' && newspaperFilled,

                                    // Selected tile gets thicker border
                                    variant === 'newspaper' && isSelected && 'border-[4px]',

                                    // Animation only for Filled (Input)
                                    variant === 'newspaper' && isActive && 'animate-newspaper-slam',

                                    // STANDARD STYLES
                                    // Base Active Row Style (slightly distinct from inactive)
                                    variant !== 'newspaper' && 'border-[hsla(var(--primary)/0.25)] bg-white/5',
                                    variant !== 'newspaper' && isPulse && 'scale-105 border-[hsl(var(--primary))] shadow-[0_0_20px_hsla(var(--primary)/0.4)]',
                                    variant !== 'newspaper' && isLocked && 'border-[hsl(var(--accent))] shadow-[0_0_15px_hsla(var(--accent)/0.3)] bg-white/20 dark:bg-white/5 opacity-90',
                                    variant !== 'newspaper' && isPeerInput && !isLocked && 'border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]',
                                    variant !== 'newspaper' && isActive && !isPeerInput && !isLocked && 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-foreground shadow-[inset_4px_4px_10px_rgba(0,0,0,0.22),inset_-4px_-4px_12px_rgba(255,255,255,0.2)]',

                                    // Empty Selected styling for Standard
                                    isSelected && !isActive && !isPeerInput && variant !== 'newspaper' && 'bg-[hsl(var(--primary)/0.05)]'
                                );
                            }

                            return (
                                <div
                                    key={variant === 'newspaper' ? `${tileKey}-${content}` : tileKey}
                                    className={className}
                                    onClick={(e) => onTileClick(colIndex, row.state === 'active', e)}
                                    onTouchStart={() => onTileTouchStart(colIndex, row.state === 'active')}
                                    onTouchEnd={(e) => onTileTouchEnd(colIndex, e)}
                                    onMouseDown={(e) => onTileMouseDown(colIndex, row.state === 'active', e)}
                                    onMouseUp={(e) => onTileMouseUp(colIndex, e)}
                                    onMouseLeave={(e) => onTileMouseLeave(colIndex, e)}
                                >
                                    {row.state === 'active' && lockedIndices.has(colIndex) && (
                                        <div className="absolute -right-1 -top-1 rounded-full bg-[hsl(var(--accent))] p-0.5 text-[hsl(var(--accent-foreground))] shadow-sm sm:-right-2 sm:-top-2 sm:p-1">
                                            <Lock className="h-2 w-2 sm:h-3 sm:w-3" />
                                        </div>
                                    )}
                                    {content}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

// Helper to compare rows arrays
function areRowsEqual(prevRows: GridRow[], nextRows: GridRow[]): boolean {
    if (prevRows.length !== nextRows.length) return false;
    for (let i = 0; i < prevRows.length; i++) {
        const prev = prevRows[i];
        const next = nextRows[i];
        if (prev.state !== next.state) return false;
        if (prev.isPeerInput !== next.isPeerInput) return false;
        if (prev.letters.join('') !== next.letters.join('')) return false;
        if (prev.evaluations.join(',') !== next.evaluations.join(',')) return false;
    }
    return true;
}

// Helper to compare Sets
function areSetsEqual(a: Set<number>, b: Set<number>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

// Helper to compare revealedTiles records
function areRecordsEqual(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

// Custom comparison for memo - handles special types
function arePropsEqual(prevProps: GameGridProps, nextProps: GameGridProps): boolean {
    // Simple primitive comparisons
    if (prevProps.wordLength !== nextProps.wordLength) return false;
    if (prevProps.isLightMode !== nextProps.isLightMode) return false;
    if (prevProps.selectedIndex !== nextProps.selectedIndex) return false;
    if (prevProps.variant !== nextProps.variant) return false;

    // tilePulse comparison (object or null)
    if (prevProps.tilePulse?.index !== nextProps.tilePulse?.index) return false;
    if (prevProps.tilePulse?.id !== nextProps.tilePulse?.id) return false;

    // Special types
    if (!areSetsEqual(prevProps.lockedIndices, nextProps.lockedIndices)) return false;
    if (!areRecordsEqual(prevProps.revealedTiles, nextProps.revealedTiles)) return false;
    if (!areRowsEqual(prevProps.rows, nextProps.rows)) return false;

    // Callbacks - compare by reference (they should be memoized by parent)
    if (prevProps.onTileClick !== nextProps.onTileClick) return false;
    if (prevProps.onTileTouchStart !== nextProps.onTileTouchStart) return false;
    if (prevProps.onTileTouchEnd !== nextProps.onTileTouchEnd) return false;
    if (prevProps.onTileMouseDown !== nextProps.onTileMouseDown) return false;
    if (prevProps.onTileMouseUp !== nextProps.onTileMouseUp) return false;
    if (prevProps.onTileMouseLeave !== nextProps.onTileMouseLeave) return false;

    return true;
}

export const GameGrid = memo(GameGridComponent, arePropsEqual);
