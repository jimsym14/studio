import { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

export interface SettingsSegmentedControlProps<T extends string | number> {
    options: { value: T; label: React.ReactNode }[];
    value: T;
    onChange: (value: T) => void;
    gameType?: 'solo' | 'multiplayer' | null;
}

export function SettingsSegmentedControl<T extends string | number>({
    options,
    value,
    onChange,
    gameType
}: SettingsSegmentedControlProps<T>) {
    const containerRef = useRef<HTMLDivElement>(null);

    const currentIndex = options.findIndex(opt => opt.value === value);
    const activeIndex = currentIndex === -1 ? 0 : currentIndex;

    const activeColorClass = gameType === 'solo'
        ? "text-orange-700 dark:text-orange-400"
        : "text-emerald-700 dark:text-emerald-400";

    return (
        <div
            className="bg-neutral-100/50 dark:bg-neutral-900/30 p-1.5 rounded-xl border border-black/5 dark:border-white/5 flex relative isolate"
            ref={containerRef}
        >
            <div
                className="absolute inset-y-1.5 rounded-lg shadow-sm transition-transform duration-300 ease-spring border border-slate-300/50 bg-slate-200/60 backdrop-blur-md dark:bg-zinc-700/60 dark:backdrop-blur-md dark:border-zinc-600/50 dark:border"
                style={{
                    left: '0.375rem',
                    width: `calc((100% - 0.75rem) / ${options.length})`,
                    transform: `translateX(calc(${activeIndex} * 100%))`
                }}
            />

            {options.map((option) => {
                const isActive = option.value === value;

                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className={cn(
                            "flex-1 relative z-10 flex items-center justify-center py-2.5 rounded-lg text-sm font-bold font-moms transition-colors",
                            isActive
                                ? activeColorClass
                                : "text-muted-foreground hover:text-foreground/70"
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
