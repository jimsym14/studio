'use client';

import React, { useEffect, useState, useRef } from 'react';
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

    // Use debug streak if set, otherwise real streak
    const displayStreak = debugStreak !== null ? debugStreak : streak;

    // Streak tier system
    const getStreakTier = (s: number) => {
        if (s >= 365) return 'godly';
        if (s >= 180) return 'legendary';
        if (s >= 30) return 'epic';
        if (s >= 15) return 'great';
        if (s >= 7) return 'good';
        return 'none';
    };

    const streakTier = getStreakTier(displayStreak);
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

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

    const isLight = theme === 'light';

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

                {/* Flame Effects based on streak tier */}
                {streakTier !== 'none' && hasPlayedToday && isSolved && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                        {/* Fire particles */}
                        {Array.from({ length: streakTier === 'godly' ? 30 : streakTier === 'legendary' ? 20 : streakTier === 'epic' ? 15 : streakTier === 'great' ? 10 : 6 }).map((_, i) => (
                            <motion.div
                                key={i}
                                className={cn(
                                    "absolute w-3 h-3 rounded-full blur-sm",
                                    streakTier === 'godly' ? "bg-gradient-to-t from-violet-500 via-fuchsia-400 to-white" :
                                        streakTier === 'legendary' ? "bg-gradient-to-t from-blue-500 via-cyan-400 to-white" :
                                            streakTier === 'epic' ? "bg-gradient-to-t from-purple-500 via-pink-400 to-white" :
                                                streakTier === 'great' ? "bg-gradient-to-t from-orange-600 via-yellow-400 to-white" :
                                                    "bg-gradient-to-t from-orange-500 via-orange-300 to-yellow-200"
                                )}
                                style={{
                                    left: `${10 + Math.random() * 80}%`,
                                    bottom: '-10px',
                                }}
                                animate={{
                                    y: [0, -150 - Math.random() * 100],
                                    x: [0, (Math.random() - 0.5) * 60],
                                    opacity: [0.8, 0],
                                    scale: [1, 0.3],
                                }}
                                transition={{
                                    duration: 1.5 + Math.random() * 1,
                                    repeat: Infinity,
                                    delay: Math.random() * 2,
                                    ease: "easeOut",
                                }}
                            />
                        ))}
                        {/* Glow effect for godly tier */}
                        {streakTier === 'godly' && (
                            <motion.div
                                className="absolute inset-0 bg-gradient-to-t from-violet-500/30 via-transparent to-transparent"
                                animate={{ opacity: [0.3, 0.6, 0.3] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            />
                        )}
                    </div>
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
                        "relative overflow-hidden border-4 will-change-transform",
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
                                    <div className="rounded-full border-2 border-black bg-white p-1.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                        {isSolved ? <Trophy className="h-4 w-4 sm:h-5 sm:w-5" /> : <X className="h-4 w-4 sm:h-5 sm:w-5" />}
                                    </div>
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
                                            {streakTier !== 'none' && (
                                                <span className={cn(
                                                    "text-base sm:text-lg",
                                                    streakTier === 'godly' ? "animate-pulse" : ""
                                                )}>
                                                    {streakTier === 'godly' ? '👑' :
                                                        streakTier === 'legendary' ? '💎' :
                                                            streakTier === 'epic' ? '⚡' :
                                                                streakTier === 'great' ? '🔥' : '✨'}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">Streak</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-xl sm:text-2xl font-black">
                                            {dailySolverCount !== null ? dailySolverCount.toLocaleString() : '—'}
                                        </span>
                                        <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">Solved Today</span>
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
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
