'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { X, Trophy, Share2, Timer, Check } from 'lucide-react';
import { useFirebase } from '@/components/firebase-provider';
import { useDailyStats } from '@/hooks/use-daily-stats';
import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import { toBlob } from 'html-to-image';
import { useIsMobile } from '@/hooks/use-mobile';

export function DailyNewspaperModal({ manualOpen, preventAutoOpen, onClose }: { manualOpen?: boolean; preventAutoOpen?: boolean; onClose?: () => void }) {
    const { user, profile } = useFirebase();
    const { isSolved, hasPlayedToday, dailyWord, streak, dailyDate } = useDailyStats(profile);
    const [isOpen, setIsOpen] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const router = useRouter();
    const { theme } = useTheme();
    const [timeLeft, setTimeLeft] = useState("");
    const [hasCopied, setHasCopied] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [dailySolverCount, setDailySolverCount] = useState<number | null>(null);
    const [debugStreak, setDebugStreak] = useState<number | null>(null);
    const isMobile = useIsMobile();
    const isLight = theme === 'light';

    // Use debug streak if set, otherwise real streak
    const displayStreak = debugStreak ?? streak;

    // Determine streak tier for effects
    const getStreakTier = (s: number): 'legendary' | 'master' | 'veteran' | 'blazing' | 'none' => {
        if (s >= 365) return 'legendary';
        if (s >= 180) return 'master';
        if (s >= 30) return 'veteran';
        if (s >= 7) return 'blazing';
        return 'none';
    };

    const streakTier = getStreakTier(displayStreak);
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '192.168.1.9');

    // Memoize perimeter flames to prevent random color recalculation on every render
    // Dependencies: displayStreak and isMobile (for count optimization)
    const perimeterFlames = useMemo(() => {
        if (displayStreak < 7) return [];

        // Determine current and next color based on streak tier
        type FlameColor = 'orange' | 'purple' | 'blue' | 'violet';
        let currentColor: FlameColor = 'orange';
        let nextColor: FlameColor = 'purple';
        let progress = 0;

        if (displayStreak >= 365) {
            currentColor = 'violet';
            nextColor = 'violet';
            progress = 1;
        } else if (displayStreak >= 180) {
            currentColor = 'blue';
            nextColor = 'violet';
            progress = (displayStreak - 180) / (365 - 180);
        } else if (displayStreak >= 30) {
            currentColor = 'purple';
            nextColor = 'blue';
            progress = (displayStreak - 30) / (180 - 30);
        } else if (displayStreak >= 15) {
            currentColor = 'orange';
            nextColor = 'purple';
            progress = (displayStreak - 15) / (30 - 15);
        } else {
            currentColor = 'orange';
            nextColor = 'orange';
            progress = 0;
        }

        // Use fewer flames on mobile for performance (8 per side vs 20)
        const flamesPerSide = isMobile ? 8 : 20;
        const flames: { color: FlameColor; edge: 'left' | 'right'; position: number }[] = [];

        const edges: ('left' | 'right')[] = ['left', 'right'];
        edges.forEach((edge, edgeIdx) => {
            for (let i = 0; i < flamesPerSide; i++) {
                // Use deterministic color assignment based on index and progress
                // This prevents random recalculation on every render
                const colorThreshold = Math.floor(progress * flamesPerSide);
                const useNextColor = i < colorThreshold;
                flames.push({
                    color: useNextColor ? nextColor : currentColor,
                    edge,
                    position: (i / flamesPerSide) * 100,
                });
            }
        });

        return flames;
    }, [displayStreak, isMobile]);

    const newspaperRef = useRef<HTMLDivElement>(null);

    // Countdown Logic
    useEffect(() => {
        const calculateTimeLeft = () => {
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setUTCHours(24, 0, 0, 0); // Next UTC Midnight
            const diff = tomorrow.getTime() - now.getTime();

            if (diff <= 0) return "00:00:00";

            const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
            const minutes = Math.floor((diff / (1000 * 60)) % 60);
            const seconds = Math.floor((diff / 1000) % 60);

            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        setTimeLeft(calculateTimeLeft());
        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    // Fetch daily solver count
    useEffect(() => {
        const fetchSolverCount = async () => {
            try {
                const res = await fetch('/api/stats/daily-solvers');
                if (res.ok) {
                    const data = await res.json();
                    setDailySolverCount(data.count ?? null);
                }
            } catch (e) {
                console.warn('Failed to fetch daily solver count', e);
            }
        };
        fetchSolverCount();
    }, []);

    const handleShare = async () => {
        if (!process.browser || isSharing || !newspaperRef.current) return;
        setIsSharing(true);

        const title = `WordMates Daily ${dailyDate}`;
        const shareText = `Play at: ${window.location.origin}/daily`;
        const playerName = profile?.username || user?.displayName || 'player';
        const safePlayerName = playerName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const filename = `wordmates-${safePlayerName}-${dailyDate}.png`;

        try {
            // Generate Image
            const blob = await toBlob(newspaperRef.current, {
                cacheBust: true,
                style: {
                    transform: 'scale(1)',
                }
            });

            if (!blob) throw new Error("Failed to generate image");

            // Check if Web Share API supports files (typically mobile iOS/Android)
            const file = new File([blob], filename, { type: 'image/png' });
            const canShareFiles = typeof navigator.share === 'function' &&
                typeof navigator.canShare === 'function' &&
                navigator.canShare({ files: [file] });

            if (canShareFiles) {
                // Use native share on iOS/Android
                await navigator.share({
                    title: title,
                    text: shareText,
                    files: [file]
                });
                setHasCopied(true);
            } else {
                // Desktop: Download the image
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                toast({ title: "Image downloaded!", className: isLight ? "bg-black text-[#f4ebd0]" : "bg-[#e0d6b9] text-black" });
                setHasCopied(true);
            }

            setTimeout(() => setHasCopied(false), 2000);
        } catch (err) {
            // User cancelled share dialog is not an error
            if (err instanceof Error && err.name === 'AbortError') {
                // User cancelled - do nothing
            } else {
                console.error("Failed to share", err);
                toast({ title: "Failed to share result", variant: "destructive" });
            }
        } finally {
            setIsSharing(false);
        }
    };


    useEffect(() => {
        if (manualOpen) {
            setIsOpen(true);
            return;
        }

        if (preventAutoOpen) return;

        // Check local storage preference
        const suppressed = localStorage.getItem('daily_newspaper_suppressed');
        if (suppressed === 'true') return;

        // If solved/played, don't auto open
        if (hasPlayedToday) return;

        // Wait a bit then open
        const timer = setTimeout(() => setIsOpen(true), 1500);
        return () => clearTimeout(timer);
    }, [manualOpen, hasPlayedToday, preventAutoOpen]);

    const handleClose = () => {
        setIsOpen(false);
        if (onClose) onClose();
        if (dontShowAgain) {
            localStorage.setItem('daily_newspaper_suppressed', 'true');
        }
    };

    const handlePlay = () => {
        router.push('/daily');
        handleClose();
    };


    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className={cn(
                "w-[95%] max-w-sm sm:max-w-md overflow-visible border-none bg-transparent shadow-none sm:rounded-none [&>button]:hidden",
                "p-0",
                // Disable default dialog animations so our custom Framer Motion one takes full control
                "data-[state=open]:animate-none data-[state=closed]:animate-none",
                "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
                "data-[state=open]:zoom-in-0 data-[state=closed]:zoom-out-0",
                "data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0"
            )}>
                <DialogTitle className="sr-only">Daily Newspaper</DialogTitle>
                <DialogDescription className="sr-only">
                    Daily game announcement and statistics.
                </DialogDescription>

                {/* Animated Starburst Background - Desktop Only */}
                {!isMobile && (
                    <div className="absolute inset-0 flex items-center justify-center -z-10 pointer-events-none">
                        <motion.div
                            animate={{
                                scale: [1.4, 1.6, 1.4]
                            }}
                            transition={{
                                duration: 1,
                                repeat: Infinity,
                                ease: "easeInOut"
                            }}
                            className="w-[400%] h-[400%] text-black"
                        >
                            <svg viewBox="-50 -50 300 300" className="w-full h-full opacity-90 drop-shadow-xl overflow-visible">
                                {/* 22-point Starburst (22 spikes, 44 vertices) */}
                                <polygon
                                    fill="currentColor"
                                    points={Array.from({ length: 44 }).map((_, i) => {
                                        const angle = (i * 360) / 44;
                                        const isOuter = i % 2 === 0;
                                        const radius = isOuter ? 150 : 120; // Increased size and less sharp spikes
                                        const rad = (angle * Math.PI) / 180;
                                        // Center at 100,100 relative to the viewBox
                                        return `${100 + radius * Math.cos(rad)},${100 + radius * Math.sin(rad)}`;
                                    }).join(' ')}
                                />
                            </svg>
                        </motion.div>
                    </div>
                )}

                {/* Floating Emoji - Different per tier */}
                {streakTier !== 'none' && hasPlayedToday && isSolved && (
                    <motion.div
                        className="absolute top-[-45px] left-1/2 z-30 text-4xl sm:text-5xl"
                        initial={{ y: -80, x: '-50%', opacity: 0 }}
                        animate={{
                            y: 0,
                            x: '-50%',
                            opacity: 1,
                        }}
                        transition={{
                            duration: 1,
                            ease: "easeOut",
                            delay: 0.5,
                        }}
                    >
                        <motion.div
                            animate={{
                                y: [-3, 3, -3],
                                rotate: [-3, 3, -3],
                            }}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeInOut",
                                delay: 1.5,
                            }}
                            style={{
                                filter: `drop-shadow(0 0 12px ${streakTier === 'legendary' ? '#fbbf24' :
                                    streakTier === 'master' ? '#a855f7' :
                                        '#f97316'
                                    }) drop-shadow(0 0 24px ${streakTier === 'legendary' ? '#f59e0b' :
                                        streakTier === 'master' ? '#7c3aed' :
                                            '#ea580c'
                                    })`
                            }}
                        >
                            {streakTier === 'legendary' ? '👑' :
                                streakTier === 'master' ? '⚡' : '🔥'}
                        </motion.div>
                    </motion.div>
                )}

                {/* Background Glow - Only for 180+ (master) and 365 (legendary) */}
                {(streakTier === 'legendary' || streakTier === 'master') && hasPlayedToday && isSolved && (
                    <motion.div
                        className={cn(
                            "absolute inset-[-30%] rounded-full blur-3xl -z-10",
                            streakTier === 'legendary' ? "bg-gradient-radial from-violet-500/50 via-fuchsia-500/25 to-transparent" :
                                "bg-gradient-radial from-cyan-500/50 via-blue-500/25 to-transparent"
                        )}
                        animate={{
                            scale: [1, 1.2, 1],
                            opacity: [0.5, 0.8, 0.5]
                        }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                )}

                {/* 7-Day Streak Roadmap - for streaks less than 7 */}
                {displayStreak < 7 && hasPlayedToday && isSolved && (
                    <div className="absolute top-[-50px] left-1/2 -translate-x-1/2 flex items-center gap-0.5 z-20">
                        {Array.from({ length: 7 }).map((_, i) => (
                            <div key={`roadmap-${i}`} className="flex items-center">
                                {/* Flame emoji for completed, empty circle for remaining */}
                                {i < displayStreak ? (
                                    <motion.div
                                        className="text-lg sm:text-xl"
                                        animate={{ scale: [1, 1.2, 1] }}
                                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
                                        style={{ filter: 'drop-shadow(0 0 4px rgba(249,115,22,0.8))' }}
                                    >
                                        🔥
                                    </motion.div>
                                ) : (
                                    <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 border-gray-400 bg-transparent" />
                                )}
                                {/* Connecting line (except after last) */}
                                {i < 6 && (
                                    <div
                                        className={cn(
                                            "w-3 sm:w-4 h-0.5",
                                            i < displayStreak - 1 ? "bg-orange-500" : "bg-gray-400"
                                        )}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Full-Screen Perimeter Flames - for streaks 7+ (rendered via portal to bypass dialog transform) */}
                {perimeterFlames.length > 0 && hasPlayedToday && isSolved && typeof document !== 'undefined' && createPortal(
                    <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
                        {perimeterFlames.map((flame, i) => {
                            const colorMap = {
                                orange: { outer: '#f97316', middle: '#fbbf24', inner: '#fff', glow: '#f97316' },
                                purple: { outer: '#a855f7', middle: '#d8b4fe', inner: '#fff', glow: '#c084fc' },
                                blue: { outer: '#06b6d4', middle: '#67e8f9', inner: '#fff', glow: '#22d3ee' },
                                violet: { outer: '#8b5cf6', middle: '#c084fc', inner: '#fef3c7', glow: '#a855f7' },
                            };
                            const colors = colorMap[flame.color];

                            // Position and rotation based on edge
                            let positionStyle: React.CSSProperties = {};
                            let rotation = 0;

                            if (flame.edge === 'left') {
                                positionStyle = { left: -40, top: `${flame.position}%` };
                                rotation = 90; // Point right (inward)
                            } else if (flame.edge === 'right') {
                                positionStyle = { right: -40, top: `${flame.position}%` };
                                rotation = 270; // Point left (inward)
                            }

                            return (
                                <div
                                    key={`perimeter-flame-${flame.edge}-${i}`}
                                    className="absolute"
                                    style={{
                                        ...positionStyle,
                                        transform: `rotate(${rotation}deg)`,
                                    }}
                                >
                                    <motion.div
                                        animate={{
                                            scaleY: [0.5, 1.2, 0.6, 1, 0.5],
                                            scaleX: [1, 0.8, 1.15, 0.85, 1],
                                        }}
                                        transition={{
                                            duration: 0.7 + (i % 5) * 0.1,
                                            repeat: Infinity,
                                            ease: "easeInOut",
                                            delay: (i % 8) * 0.12,
                                        }}
                                    >
                                        <svg
                                            viewBox="0 0 50 120"
                                            className="w-14 h-28 sm:w-24 sm:h-48 drop-shadow-lg"
                                            style={{ filter: `drop-shadow(0 0 15px ${colors.glow})` }}
                                        >
                                            <path
                                                d="M25 0 C32 30 50 45 42 75 C38 95 32 110 25 120 C18 110 12 95 8 75 C0 45 18 30 25 0"
                                                fill={colors.outer}
                                                opacity="0.9"
                                            />
                                            <path
                                                d="M25 20 C30 40 42 52 36 72 C33 85 30 95 25 105 C20 95 17 85 14 72 C8 52 20 40 25 20"
                                                fill={colors.middle}
                                                opacity="0.85"
                                            />
                                            <path
                                                d="M25 45 C27 55 34 62 30 75 C28 82 27 88 25 92 C23 88 22 82 20 75 C16 62 23 55 25 45"
                                                fill={colors.inner}
                                                opacity="0.95"
                                            />
                                        </svg>
                                    </motion.div>
                                </div>
                            );
                        })}
                    </div>,
                    document.body
                )}

                <motion.div
                    ref={newspaperRef}
                    initial={isMobile ? undefined : { scale: 0, rotate: -720, opacity: 0 }}
                    animate={isMobile ? undefined : { scale: 1, rotate: 0, opacity: 1 }}
                    transition={isMobile ? undefined : {
                        duration: 1.2,
                        ease: [0.5, 0, 1, 1], // Custom bezier for slow start, fast end (accelerating)
                    }}
                    className={cn(
                        "relative overflow-hidden border-4 will-change-transform z-10",
                        // Less intense shadow on mobile for performance
                        isMobile ? "shadow-lg animate-in zoom-in-50 fade-in-0 duration-500 ease-out" : "shadow-2xl",
                        isLight ? "bg-[#f4ebd0] border-[#2b1409] text-[#2b1409]" : "bg-[#e0d6b9] border-black text-black"
                    )}
                >
                    {/* Newspaper Header */}
                    <div className="border-b-4 border-black p-3 sm:p-4 text-center relative z-10">
                        <div className="flex items-center justify-center border-b-2 border-black pb-2">
                            <span className="border-2 border-black bg-black px-3 py-0.5 sm:px-4 sm:py-1 font-serif text-sm sm:text-lg font-bold uppercase tracking-widest text-[#f4ebd0] shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
                                {dailyDate}
                            </span>
                        </div>
                        <h2 className="mt-2 font-serif text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight">THE WORDLY POST</h2>
                        <div className="mt-2 flex items-center justify-center gap-4 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">
                            <span>Vol. {dailyDate.replace(/-/g, '')}</span>
                        </div>
                    </div>

                    {/* Content Body */}
                    <div className="p-4 sm:p-6">
                        {hasPlayedToday ? (
                            <div className="flex flex-col items-center gap-3 sm:gap-4 text-center">
                                <h3 className="font-serif text-lg sm:text-xl font-bold uppercase">
                                    {isSolved ? 'EXTRA! EXTRA! YOU DID IT!' : 'SCANDAL! WORD MISSED!'}
                                </h3>

                                {/* Word with inline icon */}
                                <p className="text-xs sm:text-sm font-bold uppercase tracking-wider opacity-60">The word was</p>
                                <div className="flex items-center justify-center gap-2">
                                    <div className="flex gap-0.5 sm:gap-1">
                                        {dailyWord.toUpperCase().split('').map((letter, idx) => (
                                            <div
                                                key={idx}
                                                className={cn(
                                                    "w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center text-base sm:text-lg font-black border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]",
                                                    isSolved ? "bg-[#6aaa64] text-white" : "bg-[#787c7e] text-white"
                                                )}
                                            >
                                                {letter}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <p className="font-serif text-xs sm:text-sm leading-tight opacity-70">
                                    {isSolved
                                        ? "Statistics confirm: You are a genius."
                                        : "Better luck next time, champion."
                                    }
                                </p>

                                <div className="grid w-full grid-cols-2 gap-2 sm:gap-3 border-t-2 border-black pt-2 sm:pt-3">
                                    <div className="flex flex-col items-center border-r-2 border-black">
                                        <div className="flex items-center gap-1">
                                            <span className="text-xl sm:text-2xl font-black">{displayStreak}</span>
                                        </div>
                                        <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">Streak</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        {dailySolverCount !== null ? (
                                            <>
                                                <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">You were the</span>
                                                <span className="text-xl sm:text-2xl font-black">
                                                    {(dailySolverCount + 1).toLocaleString()}{(() => {
                                                        const n = dailySolverCount + 1;
                                                        const s = ['th', 'st', 'nd', 'rd'];
                                                        const v = n % 100;
                                                        return s[(v - 20) % 10] || s[v] || s[0];
                                                    })()}
                                                </span>
                                                <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">to solve!</span>
                                            </>
                                        ) : (
                                            <span className="text-lg sm:text-xl font-black">—</span>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-2 sm:mt-4 flex w-full flex-col gap-3">
                                    <Button
                                        onClick={handleShare}
                                        disabled={isSharing}
                                        className={cn(
                                            "w-full rounded-none border-2 border-black bg-black text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,0.5)] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] transition-all hover:-translate-y-1 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-none text-sm sm:text-lg uppercase font-bold tracking-widest gap-2",
                                            hasCopied ? "bg-green-600 border-green-800" : ""
                                        )}
                                    >
                                        {isSharing ? (
                                            <span>@{profile?.username || user?.displayName || 'WORDMATES'}</span>
                                        ) : (
                                            <>
                                                {hasCopied ? <Check className="h-4 w-4 sm:h-5 sm:w-5" /> : <Share2 className="h-4 w-4 sm:h-5 sm:w-5" />}
                                                {hasCopied ? "SENT!" : "SHARE NEWSPAPER"}
                                            </>
                                        )}
                                    </Button>

                                    <div className="flex items-center justify-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-widest opacity-70">
                                        <Timer className="h-3 w-3 sm:h-4 sm:w-4" />
                                        <span>Next Word In: {timeLeft}</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-4 sm:gap-6 text-center">

                                <div className="space-y-1 sm:space-y-2">
                                    <h3 className="font-serif text-xl sm:text-2xl font-bold uppercase">BREAKING NEWS</h3>
                                    <p className="font-serif text-base sm:text-lg leading-tight sm:leading-snug">
                                        Millions puzzle over today's mystery. Can you solve it before the deadline?
                                    </p>
                                </div>

                                <Button
                                    onClick={handlePlay}
                                    className="w-full rounded-none border-2 border-black bg-black text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,0.5)] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-1 hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-none text-sm sm:text-lg"
                                >
                                    PLAY
                                </Button>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="suppress"
                                        checked={dontShowAgain}
                                        onChange={(e) => setDontShowAgain(e.target.checked)}
                                        className="border-black accent-black"
                                    />
                                    <label htmlFor="suppress" className="text-[10px] sm:text-xs font-bold uppercase tracking-wide cursor-pointer">
                                        Don't show this automatically
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="bg-black p-1.5 sm:p-2 text-center text-[9px] sm:text-[10px] font-bold uppercase text-[#f4ebd0]">
                        WordMates Publishing Co. Est 2024
                    </div>

                    <motion.button
                        onClick={handleClose}
                        whileHover={{ scale: 1.1, rotate: 90 }}
                        whileTap={{ scale: 0.9, rotate: 90 }}
                        className="absolute right-2 top-2 sm:right-3 sm:top-3 z-50 rounded-full border-2 border-black bg-white p-1 sm:p-1.5 text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#ff5555] hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <X className="h-3.5 w-3.5 sm:h-4 sm:w-4 stroke-[3]" />
                    </motion.button>
                </motion.div>

                {/* Debug buttons - localhost only */}
                {isLocalhost && (
                    <div className="absolute bottom-[-60px] left-0 right-0 flex flex-wrap justify-center gap-1 z-50">
                        <span className="text-white text-[10px] font-bold mr-2">DEBUG:</span>
                        {[0, 7, 15, 30, 180, 365].map((val) => (
                            <button
                                key={val}
                                onClick={() => setDebugStreak(val === 0 ? null : val)}
                                className={cn(
                                    "px-2 py-0.5 text-[10px] font-bold rounded border",
                                    (debugStreak === val || (val === 0 && debugStreak === null))
                                        ? "bg-white text-black border-white"
                                        : "bg-transparent text-white border-white/50 hover:bg-white/20"
                                )}
                            >
                                {val === 0 ? 'Reset' : val}
                            </button>
                        ))}
                        <button
                            onClick={() => setDebugStreak(Math.floor(Math.random() * 365) + 1)}
                            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-gradient-to-r from-orange-500 via-purple-500 to-cyan-500 text-white border-white/50 hover:opacity-80"
                        >
                            🎲 Rand
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog >
    );
}
