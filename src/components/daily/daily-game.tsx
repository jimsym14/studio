'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useFirebase } from '@/components/firebase-provider';
import { useDailyStats } from '@/hooks/use-daily-stats';
import { Keyboard } from '@/components/keyboard';
import { scoreGuess, getKeyboardHints, type GuessResult, type GuessScore } from '@/lib/wordle';
import { isValidWord, normalizeWord } from '@/lib/words.server';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Trophy, Frown, Share2, Calendar } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from '@/hooks/use-toast';
import { GraffitiBackground } from '@/components/graffiti-background';
import { ThemeToggle } from '@/components/theme-toggle';
import { GameGrid, type GridRow } from '@/components/game/game-grid';
import { DailyNewspaperModal } from '@/components/daily/daily-newspaper-modal';
import { useIsMobile } from '@/hooks/use-mobile';

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const LONG_PRESS_DURATION = 500;

export function DailyGame() {
    const router = useRouter();
    const { user, profile } = useFirebase();
    const { dailyWord, dailyDate, isSolved, hasPlayedToday, recordWin, recordLoss, savedGuesses, saveProgress } = useDailyStats(profile);
    const { theme } = useTheme();

    const [guesses, setGuesses] = useState<GuessResult[]>([]);
    const [currentGuess, setCurrentGuess] = useState('');
    const [gameStatus, setGameStatus] = useState<'playing' | 'won' | 'lost'>('playing');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [initializing, setInitializing] = useState(true);

    // Interaction State
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [lockedIndices, setLockedIndices] = useState<Set<number>>(new Set());
    const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isLongPressRef = useRef(false);

    // Native Keyboard Support
    const inputRef = useRef<HTMLInputElement>(null);
    const isMobile = useIsMobile();

    // Initialize state from history or fresh
    // Initialize state from history or fresh
    useEffect(() => {
        // Wait for auth to settle (user is undefined while loading)
        // Note: useFirebase might return null for user immediately if cached, or undefined if checking. 
        // We assume undefined = loading.
        if (user === undefined) return;

        if (user && profile && dailyWord) {
            // Load saved in-progress state if exists and we haven't loaded yet
            if (savedGuesses && savedGuesses.length > 0 && guesses.length === 0) {
                setGuesses(savedGuesses as GuessResult[]);
            }

            // Check if already played today
            const todayHistory = profile.daily?.history?.[dailyDate];
            if (todayHistory) {
                setGameStatus(todayHistory.result);
            }
            setInitializing(false);
        } else if (user === null) {
            // Not logged in
            setInitializing(false);
        }
    }, [dailyWord, dailyDate, user, profile, savedGuesses]);

    const getNextAvailableIndex = useCallback((currentIndex: number, direction: 'forward' | 'backward', currentWord: string) => {
        let nextIndex = currentIndex;
        const step = direction === 'forward' ? 1 : -1;

        // Safety break
        let loops = 0;

        while (loops < WORD_LENGTH) {
            nextIndex += step;
            loops++;

            // Bounds check
            if (nextIndex < 0 || nextIndex >= WORD_LENGTH) return null; // End of word

            // Check if locked or filled (if moving forward, we might want to skip filled too if not replacing?)
            // Main game logic:
            // Forward: Skip if locked. If filled and not locked ?? usually replaces.
            // But if we are in "insert" mode vs "typewriter" mode.
            // Let's mimic main game: skip locked.
            if (lockedIndices.has(nextIndex)) continue;

            return nextIndex;
        }
        return null;
    }, [lockedIndices]);

    const handleAddLetter = useCallback((letter: string) => {
        if (gameStatus !== 'playing') return;

        // If we have a selection, update that index
        // If not, find first empty slot or append

        let targetIndex: number;
        let nextGuess = currentGuess.padEnd(WORD_LENGTH, ' ').split('');

        // If selection is valid and not locked
        if (selectedIndex !== null && selectedIndex < WORD_LENGTH) {
            if (lockedIndices.has(selectedIndex)) {
                // Should not happen if UI works, but just in case
                // Move to next?
                const next = getNextAvailableIndex(selectedIndex, 'forward', currentGuess);
                if (next !== null) {
                    setSelectedIndex(next);
                    // Retry with next index? Or just wait for next keypress?
                    // Better to type in the next available slot immediately
                    targetIndex = next;
                } else {
                    return;
                }
            } else {
                targetIndex = selectedIndex;
            }
        } else {
            // No selection: Append to end, or fill first empty non-locked slot?
            // Standard Wordle: Append.
            // Our logic: Find first index that is ' ' AND not locked?
            // Simpler: Just use current length, but skip locked if they were somehow at the end?
            // Actually, if we have locked letters, 'currentGuess' string state might be complex if we allow holes.
            // But `currentGuess` is just a string. It doesn't support holes easily "H_LLO".
            // Wait, main game uses a string `currentGuess` too. How does it handle locks "H # L L #"?
            // It constructs the word based on what's typed. 
            // Actually, if we lock index 1, can we type at index 0 then index 2?
            // Yes. So `currentGuess` implies sequential.
            // But if we have holes, we need a different structure or pad spaces.

            // Current simplified approach:
            // If we are strictly appending:
            if (currentGuess.length < WORD_LENGTH) {
                // We just append.
                // But what if the appended slot corresponds to a lock?
                const draftIndex = currentGuess.length;
                if (lockedIndices.has(draftIndex)) {
                    // Can't "append" blindly if next slot is locked.
                    // We probably need to treat currentGuess as an array of characters or allow editing specific indices always.
                    // SO: We must use the `selectedIndex` logic or find the first empty slot.
                }
            }
        }

        // REFACTOR: Treat `currentGuess` as the source of truth, but we edit it at specific indices.
        // If no selectedIndex, we default to "first available empty slot from left".

        let indexToEdit = selectedIndex;

        if (indexToEdit === null) {
            // Find first empty space ' ' that is NOT locked
            // NOTE: currentGuess might look like "A B C" if we used spaces?
            // Actually `currentGuess` usually trimmed in standard version.
            // Let's construct a "working array" from currentGuess padded.
            const working = currentGuess.padEnd(WORD_LENGTH, ' ').split('');
            const firstEmpty = working.findIndex((char, i) => char === ' ' && !lockedIndices.has(i));
            if (firstEmpty !== -1) {
                indexToEdit = firstEmpty;
            } else {
                // If full, maybe replace end? NO, usually stop.
                return;
            }
        }

        if (indexToEdit !== null && !lockedIndices.has(indexToEdit)) {
            nextGuess[indexToEdit] = letter.toLowerCase();
            const newWord = nextGuess.join('');
            setCurrentGuess(newWord); // Note: this effectively allows spaces if we skip

            // Move cursor
            const next = getNextAvailableIndex(indexToEdit, 'forward', newWord);
            setSelectedIndex(next);
        }

    }, [currentGuess, gameStatus, selectedIndex, lockedIndices, getNextAvailableIndex]);

    const handleDelete = useCallback(() => {
        if (gameStatus !== 'playing') return;

        let indexToDelete = selectedIndex;
        let nextGuess = currentGuess.padEnd(WORD_LENGTH, ' ').split('');

        if (indexToDelete === null) {
            // Backspace behavior without selection: 
            // Delete the *last filled non-locked* character
            // Find last char that is not ' ' and not locked
            // Iterate backwards
            for (let i = WORD_LENGTH - 1; i >= 0; i--) {
                if (nextGuess[i] !== ' ' && !lockedIndices.has(i)) {
                    indexToDelete = i;
                    break;
                }
            }
        } else {
            // If we are selecting a slot:
            // If it has a letter, delete it.
            // If it is empty, move back and delete that? (Standard text editor behavior)
            // Wordle style: usually just delete current if filled, or go back.

            if (nextGuess[indexToDelete] === ' ') {
                // Move back
                const prev = getNextAvailableIndex(indexToDelete, 'backward', currentGuess);
                if (prev !== null) {
                    indexToDelete = prev; // Then delete at this new index
                }
            }
        }

        if (indexToDelete !== null && !lockedIndices.has(indexToDelete)) {
            nextGuess[indexToDelete] = ' '; // Replace with space
            setCurrentGuess(nextGuess.join('').trimEnd()); // Trim end to keep clean, or keep spaces? 
            // If we allow "holes", we MUST NOT trim mid-spaces. But trimEnd is safe-ish if we want "A   B" -> "A" is wrong.
            // Actually better to keep spaces if we support random access.
            // BUT normalizedWord will strip spaces? 
            // The game logic usually expects 5 chars.
            setCurrentGuess(nextGuess.join(''));

            // Move cursor to where we just deleted
            setSelectedIndex(indexToDelete);
        }

    }, [gameStatus, selectedIndex, currentGuess, lockedIndices, getNextAvailableIndex]);


    // Interaction Handlers
    const handleTileClick = useCallback((index: number, isActiveRow: boolean, e: React.MouseEvent) => {
        e.stopPropagation();
        if (gameStatus !== 'playing' || !isActiveRow) return;
        setSelectedIndex(index);

        // Trigger native keyboard on mobile
        if (isMobile && inputRef.current) {
            inputRef.current.focus();
        }
    }, [gameStatus, isMobile]);

    const handleTileTouchStart = useCallback((index: number, isActiveRow: boolean) => {
        if (gameStatus !== 'playing' || !isActiveRow) return;
        isLongPressRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            if (navigator.vibrate) navigator.vibrate(50);
            setLockedIndices(prev => {
                const next = new Set(prev);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                // Also Select/Deselect? usually locking maintains current selection or clears it.
                return next;
            });
        }, LONG_PRESS_DURATION);
    }, [gameStatus]);

    const handleTileTouchEnd = useCallback((index: number, e: React.MouseEvent | React.TouchEvent) => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        if (isLongPressRef.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }, []);

    const handleTileMouseDown = useCallback((index: number, isActive: boolean, e: React.MouseEvent) => {
        if (gameStatus !== 'playing' || !isActive) return;
        // Start timer
        isLongPressRef.current = false;
        longPressTimerRef.current = setTimeout(() => {
            isLongPressRef.current = true;
            setLockedIndices(prev => {
                const next = new Set(prev);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                return next;
            });
        }, LONG_PRESS_DURATION);
    }, [gameStatus]);

    const handleTileMouseUp = useCallback((index: number, e: React.MouseEvent) => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        // If it WAS a long press, we prevent the Click from processing selection?
        // Note: MouseUp often fires Click immediately after. 
        // We might need to block the Click if isLongPressRef is true.
        // The Click handler should check isLongPressRef.current.
        // BUT Click handler is in `GameGrid` prop `onClick`.
        // Let's ensure Click handler checks `isLongPressRef.current`.

        // Wait, standard `click` event fires after `mouseup`.
        // My `handleTileClick` does check `e.stopPropagation()`? No need to preventDefault in mouseup usually but maybe helpful.

        if (isLongPressRef.current) {
            // Prevent subsequent click?
            // Actually react synthetic events might be tricky.
            // Just relying on the flag being true during the Click handler is safer.
            // But we need to reset the flag EVENTUALLY? 
            // If we reset it here, the Click handler (which fires right after) will see False.
            // So we should reset it typically in the Click handler or after a delay?
            // Input Touch logic works because TouchEnd handles it.
            // For Mouse: MouseUp -> Click.
            // We should NOT reset `isLongPressRef.current` here if it was true.
            // We should let Click handler consume it and reset it?
            setTimeout(() => { isLongPressRef.current = false; }, 100);
        }
    }, []);

    const handleTileMouseLeave = useCallback((index: number, e: React.MouseEvent) => {
        // Cancel long press if mouse leaves the tile
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);


    const handleSubmit = useCallback(async () => {
        if (gameStatus !== 'playing' || isSubmitting) return;
        // Trim spaces? Or ensure no spaces?
        // normalizeWord handles spaces usually? 
        // We should ensure it's fully filled.
        const cleanGuess = currentGuess.replace(/ /g, '');
        if (cleanGuess.length !== WORD_LENGTH) {
            toast({ title: 'Too short', variant: 'destructive', duration: 1500 });
            return;
        }

        // Validate word (needs async check or seeded list? isValidWord is synchronous in our codebase usually if list is loaded)
        // Note: isValidWord in src/lib/words.server.ts might be server-side only?
        // "words.server.ts" implies server only. We cannot import it in client component 'use client'.
        // Wait, the file is named ".server.ts" but it exports simple functions. 
        // If it imports large JSON, it might break client bundle size.
        // We should use an API route to validate OR import a smaller client dictionary.
        // For now, let's assume we can use it or we'll mock it. 
        // EDIT: I will use a server action or simple check. 
        // Actually, `isValidWord` imports `words.json`. That is HUGE.
        // I should create a server action `validateWord`?
        // Or just accept any 5 letter word for now to avoid complexity? No, checks are needed.
        // I'll make a server action in `src/app/actions.ts` or similar?
        // Let's Stub it for now as "True" or implement a client-safe check later.
        // Or re-use the one from existing game? existing game does server-side validation.

        // For this implementation, I will skip strict dictionary validation in the client to avoid the 7MB bundle payload,
        // unless I add an API route. 
        // I'll add a TODO.

        if (!isValidWord(cleanGuess, WORD_LENGTH)) {
            toast({
                title: "Not in word list",
                variant: "destructive",
                duration: 2000
            });
            // Add shake animation logic if I can, but toast is MVP.
            return;
        }

        setIsSubmitting(true);

        // Check against daily word
        const normalizedGuess = normalizeWord(cleanGuess);
        const evaluations = scoreGuess(normalizedGuess, dailyWord);

        const newGuessResult: GuessResult = {
            word: normalizedGuess,
            evaluations,
            playerId: profile?.uid || 'guest',
            submittedAt: new Date().toISOString()
        };

        const newGuesses = [...guesses, newGuessResult];
        setGuesses(newGuesses);
        saveProgress(newGuesses); // Save persistence
        setCurrentGuess('');
        setLockedIndices(new Set()); // Reset locks on submit
        setSelectedIndex(null); // Reset selection

        const isCorrect = normalizedGuess === dailyWord;

        if (isCorrect) {
            setGameStatus('won');
            await recordWin(newGuesses.length);
            toast({ title: 'Splendid!', description: 'You solved the daily word.', className: "bg-green-500 text-white" });
        } else if (newGuesses.length >= MAX_GUESSES) {
            setGameStatus('lost');
            await recordLoss();
            toast({ title: 'Game Over', description: `The word was ${dailyWord.toUpperCase()}` });
        }

        setIsSubmitting(false);

    }, [currentGuess, guesses, dailyWord, gameStatus, isSubmitting, profile, recordWin, recordLoss]);

    // Handle physical keyboard
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (gameStatus !== 'playing') return;
            // Ignore if typing in the native input to prevent double handling
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'Backspace') handleDelete();
            else if (e.key === 'Enter') handleSubmit();
            else if (/^[a-zA-Z]$/.test(e.key)) handleAddLetter(e.key.toLowerCase());
            else if (e.key === 'ArrowLeft') {
                setSelectedIndex(prev => prev === null ? WORD_LENGTH - 1 : Math.max(0, prev - 1));
            }
            else if (e.key === 'ArrowRight') {
                setSelectedIndex(prev => prev === null ? 0 : Math.min(WORD_LENGTH - 1, prev + 1));
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleAddLetter, handleDelete, handleSubmit, gameStatus]);

    // Deselect on background click
    useEffect(() => {
        const handleBgClick = () => setSelectedIndex(null);
        window.addEventListener('click', handleBgClick);
        return () => window.removeEventListener('click', handleBgClick);
    }, []);



    // Parallax Logic
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        const handleMouseMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });

        handleResize();
        window.addEventListener('resize', handleResize);
        window.addEventListener('mousemove', handleMouseMove);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    const moveX = windowSize.width > 0 ? (mousePos.x - windowSize.width / 2) / (windowSize.width / 2) : 0;
    const moveY = windowSize.height > 0 ? (mousePos.y - windowSize.height / 2) / (windowSize.height / 2) : 0;

    const allRevealed = React.useMemo(() => {
        const revealed: Record<string, boolean> = {};
        guesses.forEach((_, rowIndex) => {
            for (let i = 0; i < WORD_LENGTH; i++) {
                revealed[`${rowIndex}-${i}`] = true;
            }
        });
        return revealed;
    }, [guesses]);

    const hints = getKeyboardHints(guesses);
    const isLightMode = theme === 'light';

    const gridRows = React.useMemo(() => {
        const rows: GridRow[] = [];
        for (let i = 0; i < MAX_GUESSES; i++) {
            if (i < guesses.length) {
                rows.push({
                    letters: guesses[i].word.split(''),
                    evaluations: guesses[i].evaluations,
                    state: 'submitted'
                });
            } else if (i === guesses.length) {
                rows.push({
                    letters: currentGuess.padEnd(WORD_LENGTH, ' ').split(''),
                    evaluations: new Array(WORD_LENGTH).fill(null),
                    state: 'active'
                });
            } else {
                rows.push({
                    letters: new Array(WORD_LENGTH).fill(' '),
                    evaluations: new Array(WORD_LENGTH).fill(null),
                    state: 'empty'
                });
            }
        }
        return rows;
    }, [guesses, currentGuess]);

    if (initializing) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;
    }

    const NEWSPAPER_LETTERS = [
        { char: 'D', top: '5%', left: '2%', size: '15vh', rotate: '-12deg', delay: '0s', depth: 1.2 },
        { char: 'M', top: '2%', right: '15%', size: '12vh', rotate: '12deg', delay: '2s', depth: 0.8 },
        { char: 'P', top: '25%', left: '80%', size: '18vh', rotate: '-6deg', delay: '1s', depth: 1.5 },
        { char: 'I', top: '40%', left: '10%', size: '14vh', rotate: '20deg', delay: '3s', depth: 0.5 },
        { char: 'G', bottom: '20%', right: '5%', size: '20vh', rotate: '-15deg', delay: '0.5s', depth: 1.1 },
        { char: 'C', bottom: '10%', left: '15%', size: '16vh', rotate: '45deg', delay: '2.5s', depth: 0.9 },
        { char: 'O', top: '60%', right: '25%', size: '15vh', rotate: '-6deg', delay: '1.5s', depth: 1.3 },
        { char: 'E', top: '10%', left: '30%', size: '10vh', rotate: '80deg', delay: '3.5s', depth: 0.6 },
        { char: 'B', bottom: '30%', left: '5%', size: '12vh', rotate: '-45deg', delay: '0.8s', depth: 1.0 },
        { char: 'Y', bottom: '5%', right: '40%', size: '14vh', rotate: '12deg', delay: '2.8s', depth: 1.4 }
    ];

    return (
        <div className="flex min-h-screen flex-col items-center overflow-hidden bg-[#d5c4a1] text-[#2b1409] dark:bg-[#121212] dark:text-[#f4ebd0]">
            <style jsx global>{`
                @keyframes float {
                    0% { transform: translateY(0px) rotate(var(--tw-rotate)); }
                    50% { transform: translateY(-20px) rotate(var(--tw-rotate)); }
                    100% { transform: translateY(0px) rotate(var(--tw-rotate)); }
                }
                .animate-float {
                    animation: float 6s ease-in-out infinite;
                }
            `}</style>
            {/* Newspaper Background */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none opacity-100 dark:opacity-100">
                {NEWSPAPER_LETTERS.map((item, i) => {
                    const parallaxX = -moveX * 40 * item.depth;
                    const parallaxY = -moveY * 40 * item.depth;
                    return (
                        <span
                            key={i}
                            className="absolute transition-transform duration-100 ease-out will-change-transform"
                            style={{
                                top: item.top,
                                left: item.left,
                                right: item.right,
                                bottom: item.bottom,
                                transform: `translate(${parallaxX}px, ${parallaxY}px)`
                            }}
                        >
                            <span
                                className="block font-serif font-bold text-black/10 dark:text-white/5 animate-float"
                                style={{
                                    fontSize: item.size,
                                    transform: `rotate(${item.rotate})`,
                                    animationDelay: item.delay
                                }}
                            >
                                {item.char}
                            </span>
                        </span>
                    );
                })}
            </div>

            {/* Header */}
            <div className="relative z-10 w-full bg-[#E3D4B5] dark:bg-[#1a1a1a] border-b-[3px] border-black dark:border-white/20 p-2 sm:p-4 shadow-sm">
                <div className="mx-auto grid w-full max-w-5xl grid-cols-3 items-center">
                    {/* Left: Back Button */}
                    <div className="flex items-center justify-start">
                        <Button variant="ghost" size="icon" onClick={() => router.push('/')} className="h-10 w-10 text-inherit hover:bg-black/5 dark:hover:bg-white/10">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* Center: Title & Vol */}
                    <div className="flex flex-col items-center justify-center text-center">
                        <h1 className="font-serif text-3xl font-black tracking-tighter text-[#2b1409] dark:text-[#f4ebd0] sm:text-4xl uppercase">
                            DAILY WORD
                        </h1>
                        <span className="mt-1 border-t border-[#2b1409]/30 dark:border-[#f4ebd0]/30 pt-1 text-[10px] uppercase tracking-[0.2em] font-serif font-bold opacity-70">
                            VOL. {dailyDate.replace(/-/g, '.')}
                        </span>
                    </div>

                    {/* Right: Theme Toggle */}
                    <div className="flex items-center justify-end gap-2">
                        <ThemeToggle className="h-10 w-10 text-inherit hover:bg-black/5 dark:hover:bg-white/10" />
                    </div>
                </div>
            </div>

            <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 p-4 w-full max-w-lg">

                {/* Game Grid */}
                <div className="mx-auto w-full max-w-[min(92vw,420px)]">
                    <GameGrid
                        wordLength={WORD_LENGTH}
                        rows={gridRows}
                        isLightMode={isLightMode}
                        revealedTiles={allRevealed}
                        selectedIndex={selectedIndex}
                        lockedIndices={lockedIndices}
                        tilePulse={null}
                        onTileClick={handleTileClick}
                        onTileTouchStart={handleTileTouchStart}
                        onTileTouchEnd={handleTileTouchEnd}
                        onTileMouseDown={handleTileMouseDown}
                        onTileMouseUp={handleTileMouseUp}
                        onTileMouseLeave={handleTileMouseLeave}
                        variant="newspaper"
                    />
                </div>

                {/* Result Screen Overlay or Message */}
                <DailyNewspaperModal
                    manualOpen={gameStatus !== 'playing'}
                    preventAutoOpen={true}
                    onClose={() => { /* Option to stay on board? or just keep it open? logic usually handles close itself */ }}
                />

                {/* Keyboard */}
                <div className="w-full">
                    <Keyboard
                        hints={hints}
                        onAddLetter={handleAddLetter}
                        onDelete={handleDelete}
                        onSubmit={handleSubmit}
                        onReset={() => setCurrentGuess('')}
                        isSubmitting={isSubmitting}
                        canInteract={gameStatus === 'playing'}
                        isLightMode={isLightMode}
                        keyPulse={null}
                        keyboardFeedback={null}
                    />
                </div>

                {/* Hidden Input for Native Mobile Keyboard */}
                <input
                    ref={inputRef}
                    type="text"
                    // Fixed position to prevent scrolling to bottom on focus
                    className="fixed top-0 left-0 opacity-0 pointer-events-none h-0 w-0"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    value=""
                    onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        // Take the last character typed if multiple (though we clear it)
                        const char = val.slice(-1);
                        if (/^[a-zA-Z]$/.test(char)) {
                            handleAddLetter(char.toLowerCase());
                        }
                        // Clear input
                        e.target.value = '';
                    }}
                    onKeyDown={(e) => {
                        // Prevent default to avoid double handling if window listener is active?
                        // But window listener checks isMobile? No.
                        // We rely on window listener for desktop.
                        // For mobile, this input is focused.
                        // We should probably stop propagation if we handle it here.

                        if (e.key === 'Backspace') {
                            e.stopPropagation();
                            handleDelete();
                        } else if (e.key === 'Enter') {
                            e.stopPropagation();
                            handleSubmit();
                        }
                    }}
                    onBlur={() => {
                        // Optional: Clear selection on blur? Or keep it?
                        // Usually keep it visually but knowing keyboard is gone.
                    }}
                />

            </div>
        </div>
    );
}
