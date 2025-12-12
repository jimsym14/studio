'use client';

import React, { memo, useEffect, useState, type CSSProperties } from 'react';
import { RotateCcw, CornerDownLeft, Delete } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import type { GuessScore } from '@/lib/wordle';

const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const keyboardTone: Record<GuessScore, string> = {
    correct: 'bg-[hsla(var(--accent)/0.95)] text-[hsl(var(--accent-foreground))] border-[hsla(var(--accent)/0.45)] shadow-[0_10px_26px_rgba(0,0,0,0.15)]',
    present: 'bg-[hsla(var(--primary)/0.9)] text-[hsl(var(--primary-foreground))] border-[hsla(var(--primary)/0.5)] shadow-[0_10px_26px_rgba(0,0,0,0.15)]',
    absent: 'bg-muted text-muted-foreground border-transparent',
};

export interface KeyboardProps {
    hints: Record<string, GuessScore>;
    onAddLetter: (letter: string) => void;
    onDelete: () => void;
    onSubmit: () => void;
    onReset: () => void;
    isSubmitting: boolean;
    canInteract: boolean;
    isLightMode: boolean;
    keyPulse: { letter: string; id: number } | null;
    keyboardFeedback: {
        entries: Array<{ letter: string; evaluation: GuessScore; delay: number }>;
    } | null;
}

export const Keyboard = memo(function Keyboard({
    hints,
    onAddLetter,
    onDelete,
    onSubmit,
    onReset,
    isSubmitting,
    canInteract,
    isLightMode,
    keyPulse,
    keyboardFeedback,
}: KeyboardProps) {
    const isMobile = useIsMobile();

    return (
        <div className="space-y-2.5">
            {keyboardRows.map((row) => (
                <div
                    key={row}
                    className="mx-auto flex w-full max-w-[280px] items-center justify-center gap-1 sm:max-w-[360px] sm:gap-1.5 lg:max-w-[420px]"
                >
                    {row.split('').map((letter) => {
                        const hint = hints[letter];
                        const isAbsentKey = hint === 'absent';
                        const pulseActive = Boolean(keyPulse && keyPulse.letter === letter);
                        const feedbackEntry = keyboardFeedback?.entries.find((entry) => entry.letter === letter);
                        const keyStyle: CSSProperties | undefined = feedbackEntry
                            ? { ['--key-feedback-delay' as string]: `${feedbackEntry.delay}ms` }
                            : undefined;

                        return (
                            <button
                                key={letter}
                                type="button"
                                style={keyStyle}
                                className={cn(
                                    'group relative isolate flex h-9 w-7 flex-none touch-manipulation items-center justify-center rounded-[18px] border text-xs font-semibold uppercase tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_14px_32px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsla(var(--primary)/0.5)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent sm:h-11 sm:w-9 sm:text-sm lg:h-12 lg:w-10',
                                    hint
                                        ? 'border-transparent text-white dark:text-white'
                                        : 'border-gray-400 bg-white/90 text-[#2b140c] backdrop-blur shadow-md dark:border-white/10 dark:bg-white/10 dark:text-white/80',
                                    hint && keyboardTone[hint],
                                    isAbsentKey && !isLightMode && 'dark:bg-white/[0.04] dark:text-white/30 dark:border-white/10 dark:opacity-45 dark:hover:opacity-60 dark:hover:-translate-y-0 dark:hover:shadow-none',
                                    !isMobile && pulseActive && 'animate-key-pop',
                                    isMobile && 'active:scale-95 active:bg-black/5 dark:active:bg-white/10 active:transition-none',
                                    feedbackEntry && 'keyboard-feedback',
                                    feedbackEntry && `keyboard-feedback-${feedbackEntry.evaluation}`,
                                    (!canInteract) && 'opacity-60'
                                )}
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onAddLetter(letter);
                                }}
                                disabled={!canInteract}
                                aria-label={`Use letter ${letter}`}
                            >
                                <span className="relative z-[1]">{letter}</span>
                                <span className="pointer-events-none absolute inset-0 -z-[1] rounded-[18px] opacity-0 transition-opacity duration-200 group-hover:opacity-100" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.8), transparent 58%)' }} />
                            </button>
                        );
                    })}
                </div>
            ))}
            <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
                <Button
                    variant="ghost"
                    className="shrink-0 gap-2 touch-manipulation rounded-2xl border border-[hsla(var(--accent)/0.5)] bg-[hsla(var(--accent)/0.15)] px-5 py-2 text-[hsl(var(--accent))] shadow-[0_12px_28px_rgba(0,128,96,0.2)] dark:border-[hsla(var(--accent)/0.4)] dark:bg-white/5 dark:text-[hsl(var(--accent-foreground))] sm:px-6"
                    onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onReset();
                    }}
                    disabled={!canInteract}
                >
                    <RotateCcw className="h-4 w-4" /> Reset row
                </Button>
                <button
                    type="button"
                    className="flex h-10 w-20 touch-manipulation items-center justify-center rounded-2xl border border-transparent bg-[hsl(var(--primary))] text-sm font-semibold uppercase text-[hsl(var(--primary-foreground))] shadow-[0_15px_35px_rgba(255,140,0,0.35)] transition-all hover:-translate-y-0.5 sm:h-12 sm:w-24 dark:bg-[hsl(var(--primary))] dark:text-[hsl(var(--primary-foreground))]"
                    onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSubmit();
                    }}
                    disabled={!canInteract || isSubmitting}
                    aria-label="Submit guess"
                >
                    <CornerDownLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="flex h-10 w-16 touch-manipulation items-center justify-center rounded-2xl border border-transparent bg-[hsl(var(--destructive))] text-sm font-semibold uppercase text-[hsl(var(--destructive-foreground))] shadow-[0_12px_30px_rgba(255,0,72,0.3)] transition-all hover:-translate-y-0.5 sm:h-12 sm:w-18 sm:text-sm dark:bg-[hsl(var(--destructive))] dark:text-[hsl(var(--destructive-foreground))]"
                    onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete();
                    }}
                    disabled={!canInteract || isSubmitting}
                    aria-label="Delete letter"
                >
                    <Delete className="h-5 w-5" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
});
