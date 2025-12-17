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
    const { isSolved, hasPlayedToday, dailyWord, streak, dailyDate, history } = useDailyStats(profile);
    const [isOpen, setIsOpen] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);
    const router = useRouter();
    const { theme } = useTheme();
    const [timeLeft, setTimeLeft] = useState("");
    const [hasCopied, setHasCopied] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [dailySolverCount, setDailySolverCount] = useState<number | null>(null);
    const [debugStreak, setDebugStreak] = useState<number | null>(null);
    const [debugHasPlayed, setDebugHasPlayed] = useState<boolean | null>(null);
    const [debugIsSolved, setDebugIsSolved] = useState<boolean | null>(null);
    const [initialAnimDone, setInitialAnimDone] = useState(false);
    const isMobile = useIsMobile();
    const isLight = theme === 'light';

    // Get the user's solve rank from today's history entry
    const solveRank = history?.[dailyDate]?.solveRank ?? null;

    // Use debug values if set, otherwise real values
    const displayStreak = debugStreak ?? streak;
    const displayHasPlayed = debugHasPlayed ?? hasPlayedToday;
    const displayIsSolved = debugIsSolved ?? isSolved;

    // Check if any debug mode is active - skip animations entirely in debug mode
    const isDebugMode = debugStreak !== null || debugHasPlayed !== null || debugIsSolved !== null;

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

    // Memoize particle config for streak visualization
    // 0-15 particles based on streak, with color progression
    const particleConfig = useMemo(() => {
        // Calculate number of particles: min(streak, 15)
        const particleCount = Math.min(displayStreak, 15);
        if (particleCount <= 0) return { particles: [], gradientColors: { from: '#f97316', to: '#fbbf24' } };

        // Determine current and next color based on streak tier
        // Tier gradient colors: 15=orange→yellow, 30=yellow→green, 180=blue→purple, 365=purple→bordeaux
        type ParticleColor = 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'bordeaux';
        let currentColor: ParticleColor = 'orange';
        let nextColor: ParticleColor = 'yellow';
        let progress = 0;

        if (displayStreak >= 365) {
            currentColor = 'purple';
            nextColor = 'bordeaux';
            progress = 1;
        } else if (displayStreak >= 180) {
            currentColor = 'blue';
            nextColor = 'purple';
            progress = (displayStreak - 180) / (365 - 180);
        } else if (displayStreak >= 30) {
            currentColor = 'yellow';
            nextColor = 'green';
            progress = (displayStreak - 30) / (180 - 30);
        } else if (displayStreak >= 15) {
            currentColor = 'orange';
            nextColor = 'yellow';
            progress = (displayStreak - 15) / (30 - 15);
        } else {
            currentColor = 'orange';
            nextColor = 'orange';
            progress = 0;
        }

        const colorHex: Record<string, string> = {
            orange: '#ea580c',
            yellow: '#ca8a04',
            green: '#16a34a',
            blue: '#0891b2',
            purple: '#7c3aed',
            bordeaux: '#9f1239',
        };

        // Gradient colors for background
        const gradientColors = {
            from: colorHex[currentColor],
            to: colorHex[nextColor],
        };

        // Generate particles positioned AROUND the newspaper (not on it)
        // Newspaper is roughly 35-65% of screen, so place particles in ring around it
        const particles: { x: number; y: number; color: string; size: number; delay: number }[] = [];
        for (let i = 0; i < particleCount; i++) {
            const seed = (i * 7919) % 100;

            // Place particles in a ring around center: 15-30% or 70-85% range
            // Alternate between inner and outer ring positions
            const isLeftSide = i % 2 === 0;
            const isTopHalf = (seed % 4) < 2;

            let x, y;
            if (isLeftSide) {
                // Left/Right sides: x in 15-30% or 70-85%
                x = i % 4 < 2 ? 15 + (seed % 15) : 70 + (seed % 15);
                y = 20 + (seed % 60); // Full height range
            } else {
                // Top/Bottom: y in 15-30% or 70-85%  
                x = 20 + (seed % 60); // Full width range
                y = isTopHalf ? 15 + (seed % 15) : 70 + (seed % 15);
            }

            // Color based on progress through tier
            const colorThreshold = Math.floor(progress * particleCount);
            const particleColor = i < colorThreshold ? colorHex[nextColor] : colorHex[currentColor];

            // Bigger sizes (8-14px) with more variation
            const size = 8 + (i % 4) * 2; // 8, 10, 12, 14px
            const delay = (i % 5) * 0.4; // Staggered animation delays

            particles.push({ x, y, color: particleColor, size, delay });
        }

        return { particles, gradientColors };
    }, [displayStreak]);

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
            // Generate Image - skip fonts to avoid CORS issues with external stylesheets
            const blob = await toBlob(newspaperRef.current, {
                cacheBust: true,
                skipFonts: true,
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

    // Mark initial animation as done after the newspaper animation completes
    useEffect(() => {
        if (isOpen && !initialAnimDone) {
            const timer = setTimeout(() => setInitialAnimDone(true), isMobile ? 800 : 1500);
            return () => clearTimeout(timer);
        }
    }, [isOpen, initialAnimDone, isMobile]);

    // Calculate delays - 0 if initial animation is done (for instant debug changes)
    const getDelay = (desktopDelay: number, mobileDelay?: number) => {
        if (initialAnimDone) return 0;
        return isMobile ? (mobileDelay ?? desktopDelay) : desktopDelay;
    };


    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <DialogContent className={cn(
                "w-[90%] max-w-[360px] sm:max-w-[400px] overflow-visible border-none bg-transparent shadow-none sm:rounded-none [&>button]:hidden",
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

                {/* 1. Blurred Darkening Background - Full screen via portal, fades in after newspaper animation */}
                {displayHasPlayed && displayIsSolved && typeof document !== 'undefined' && createPortal(
                    isDebugMode ? (
                        // Static version for debug mode
                        <div
                            className="fixed inset-0 pointer-events-none"
                            style={{
                                backgroundColor: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.5)',
                                backdropFilter: isMobile ? 'blur(4px)' : 'blur(8px)',
                                WebkitBackdropFilter: isMobile ? 'blur(4px)' : 'blur(8px)',
                                zIndex: 49,
                            }}
                        />
                    ) : (
                        // Animated version for normal mode
                        <motion.div
                            key="blurred-bg"
                            className="fixed inset-0 pointer-events-none"
                            style={{
                                backgroundColor: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.5)',
                                backdropFilter: isMobile ? 'blur(4px)' : 'blur(8px)',
                                WebkitBackdropFilter: isMobile ? 'blur(4px)' : 'blur(8px)',
                                zIndex: 49,
                            }}
                            initial={initialAnimDone ? { opacity: 1 } : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{
                                duration: initialAnimDone ? 0 : 0.5,
                                delay: initialAnimDone ? 0 : getDelay(1.2, 0.3),
                                ease: "easeOut",
                            }}
                        />
                    ),
                    document.body
                )}

                {/* 2. Animated Starburst Background - Zooms in after newspaper, then breathes (Desktop Only) */}
                {!isMobile && (
                    <div className="absolute inset-0 flex items-center justify-center -z-10 pointer-events-none">
                        {/* Spawn animation (runs once) */}
                        <motion.div
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1.5, opacity: 1 }}
                            transition={{
                                duration: initialAnimDone ? 0.2 : 0.6,
                                delay: getDelay(1.2),
                                ease: [0.34, 1.56, 0.64, 1], // spring-like
                            }}
                            className="w-[400%] h-[400%] text-black"
                        >
                            {/* Breathing animation (runs infinitely) */}
                            <motion.div
                                animate={{ scale: [1, 1.07, 1] }}
                                transition={{
                                    duration: 2,
                                    repeat: Infinity,
                                    ease: "easeInOut",
                                }}
                                className="w-full h-full"
                            >
                                <svg viewBox="-50 -50 300 300" className="w-full h-full opacity-90 drop-shadow-xl overflow-visible">
                                    {/* 22-point Starburst (22 spikes, 44 vertices) */}
                                    <polygon
                                        fill="currentColor"
                                        points={Array.from({ length: 44 }).map((_, i) => {
                                            const angle = (i * 360) / 44;
                                            const isOuter = i % 2 === 0;
                                            const radius = isOuter ? 150 : 120;
                                            const rad = (angle * Math.PI) / 180;
                                            return `${100 + radius * Math.cos(rad)},${100 + radius * Math.sin(rad)}`;
                                        }).join(' ')}
                                    />
                                </svg>
                            </motion.div>
                        </motion.div>
                    </div>
                )}

                {/* Floating Emoji - Different per tier */}
                {streakTier !== 'none' && displayHasPlayed && displayIsSolved && (
                    isDebugMode ? (
                        // Static version for debug mode - no animations
                        <div
                            className="absolute top-[-45px] left-1/2 -translate-x-1/2 z-[60] text-4xl sm:text-5xl"
                            style={{
                                filter: isMobile
                                    ? `drop-shadow(0 0 8px ${streakTier === 'legendary' ? '#fbbf24' : streakTier === 'master' ? '#a855f7' : '#f97316'})`
                                    : `drop-shadow(0 0 12px ${streakTier === 'legendary' ? '#fbbf24' : streakTier === 'master' ? '#a855f7' : '#f97316'})`
                            }}
                        >
                            {streakTier === 'legendary' ? '👑' :
                                streakTier === 'master' ? '⚡' : '🔥'}
                        </div>
                    ) : (
                        // Animated version for normal mode
                        <motion.div
                            key="floating-emoji"
                            className="absolute top-[-45px] left-1/2 z-[60] text-4xl sm:text-5xl"
                            initial={initialAnimDone ? false : { y: -80, x: '-50%', opacity: 0 }}
                            animate={{
                                y: 0,
                                x: '-50%',
                                opacity: 1,
                            }}
                            transition={{
                                duration: initialAnimDone ? 0 : 1,
                                ease: "easeOut",
                                delay: getDelay(0.5),
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
                                    delay: initialAnimDone ? 0 : getDelay(1.5),
                                }}
                                style={{
                                    // Simpler shadow on mobile for performance
                                    filter: isMobile
                                        ? `drop-shadow(0 0 8px ${streakTier === 'legendary' ? '#fbbf24' : streakTier === 'master' ? '#a855f7' : '#f97316'})`
                                        : `drop-shadow(0 0 12px ${streakTier === 'legendary' ? '#fbbf24' :
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
                    )
                )}

                {/* Background Glow - Only for 180+ (master) and 365 (legendary) - DESKTOP ONLY due to blur performance */}
                {!isMobile && (streakTier === 'legendary' || streakTier === 'master') && displayHasPlayed && displayIsSolved && (
                    <motion.div
                        key="master-legendary-glow"
                        className={cn(
                            "absolute inset-[-30%] rounded-full blur-3xl -z-10",
                            streakTier === 'legendary' ? "bg-gradient-radial from-violet-500/50 via-fuchsia-500/25 to-transparent" :
                                "bg-gradient-radial from-cyan-500/50 via-blue-500/25 to-transparent"
                        )}
                        initial={initialAnimDone ? false : { opacity: 0 }}
                        animate={{
                            scale: [1, 1.2, 1],
                            opacity: [0.5, 0.8, 0.5]
                        }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                )}

                {/* 7-Day Streak Roadmap - for streaks less than 7, with left-to-right popup animation */}
                {displayStreak < 7 && displayHasPlayed && displayIsSolved && (
                    <div className="absolute top-[-50px] left-1/2 -translate-x-1/2 flex items-center gap-0.5 z-20">
                        {Array.from({ length: 7 }).map((_, i) => (
                            isDebugMode ? (
                                // Static version for debug mode
                                <div key={`roadmap-${i}`} className="flex items-center">
                                    {i < displayStreak ? (
                                        <div
                                            className="text-2xl sm:text-3xl"
                                            style={{ filter: 'drop-shadow(0 0 6px rgba(249,115,22,0.9))' }}
                                        >
                                            🔥
                                        </div>
                                    ) : (
                                        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 border-gray-400 bg-transparent" />
                                    )}
                                    {i < 6 && (
                                        <div
                                            className={cn(
                                                "w-2 sm:w-3 h-0.5",
                                                i < displayStreak - 1 ? "bg-orange-500" : "bg-gray-400"
                                            )}
                                        />
                                    )}
                                </div>
                            ) : (
                                // Animated version for normal mode
                                <motion.div
                                    key={`roadmap-${i}`}
                                    className="flex items-center"
                                    initial={initialAnimDone ? false : { opacity: 0, scale: 0, x: -20 }}
                                    animate={{ opacity: 1, scale: 1, x: 0 }}
                                    transition={{
                                        duration: initialAnimDone ? 0 : 0.3,
                                        delay: initialAnimDone ? 0 : (getDelay(1.4, 0.5) + i * 0.1),
                                        ease: [0.34, 1.56, 0.64, 1], // Spring-like
                                    }}
                                >
                                    {/* Flame emoji for completed, empty circle for remaining */}
                                    {i < displayStreak ? (
                                        <motion.div
                                            className="text-2xl sm:text-3xl"
                                            animate={{ scale: [1, 1.1, 1] }}
                                            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                                            style={{ filter: 'drop-shadow(0 0 6px rgba(249,115,22,0.9))' }}
                                        >
                                            🔥
                                        </motion.div>
                                    ) : (
                                        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 border-gray-400 bg-transparent" />
                                    )}
                                    {/* Connecting line (except after last) */}
                                    {i < 6 && (
                                        <div
                                            className={cn(
                                                "w-2 sm:w-3 h-0.5",
                                                i < displayStreak - 1 ? "bg-orange-500" : "bg-gray-400"
                                            )}
                                        />
                                    )}
                                </motion.div>
                            )
                        ))}
                    </div>
                )}

                {/* 3. Background Glow - Fades in after newspaper animation */}
                {displayStreak > 0 && displayHasPlayed && displayIsSolved && (
                    isDebugMode ? (
                        // Static version for debug mode
                        <div
                            className="absolute inset-[-50%] pointer-events-none -z-20"
                            style={{
                                background: isLight
                                    ? `radial-gradient(ellipse 60% 60% at 50% 50%, ${particleConfig.gradientColors.from} 0%, ${particleConfig.gradientColors.from}80 20%, ${particleConfig.gradientColors.from}40 40%, transparent 70%)`
                                    : `radial-gradient(ellipse 60% 60% at 50% 50%, ${particleConfig.gradientColors.from} 0%, ${particleConfig.gradientColors.from}90 20%, ${particleConfig.gradientColors.from}50 40%, transparent 70%)`,
                                opacity: 0.7,
                            }}
                        />
                    ) : (
                        // Animated version for normal mode
                        <motion.div
                            key="streak-glow"
                            className="absolute inset-[-50%] pointer-events-none -z-20"
                            style={{
                                background: isLight
                                    ? `radial-gradient(ellipse 60% 60% at 50% 50%, ${particleConfig.gradientColors.from} 0%, ${particleConfig.gradientColors.from}80 20%, ${particleConfig.gradientColors.from}40 40%, transparent 70%)`
                                    : `radial-gradient(ellipse 60% 60% at 50% 50%, ${particleConfig.gradientColors.from} 0%, ${particleConfig.gradientColors.from}90 20%, ${particleConfig.gradientColors.from}50 40%, transparent 70%)`,
                            }}
                            initial={initialAnimDone ? { opacity: 0.7 } : { opacity: 0 }}
                            animate={{ opacity: [0.5, 0.9, 0.5] }}
                            transition={{
                                duration: 3,
                                repeat: Infinity,
                                ease: "easeInOut",
                                delay: initialAnimDone ? 0 : getDelay(1.4, 0.5),
                            }}
                        />
                    )
                )}

                {/* Bright Colored Particles - DESKTOP ONLY, fades in after newspaper */}
                {!isMobile && displayStreak > 0 && displayHasPlayed && displayIsSolved && typeof document !== 'undefined' && createPortal(
                    <motion.div
                        className="fixed inset-0 pointer-events-none z-[60] overflow-hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: initialAnimDone ? 0.2 : 0.5, delay: getDelay(1.4) }}
                    >
                        {/* Grain Overlay */}
                        <div
                            className="absolute inset-0 opacity-[0.06]"
                            style={{
                                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                            }}
                        />

                        {/* Bright colored floating particles */}
                        {particleConfig.particles.map((particle, i) => (
                            <motion.div
                                key={`particle-${i}`}
                                className="absolute rounded-full"
                                style={{
                                    left: `${particle.x}%`,
                                    top: `${particle.y}%`,
                                    width: particle.size,
                                    height: particle.size,
                                    backgroundColor: particle.color,
                                    boxShadow: `
                                        0 0 ${particle.size * 2}px ${particle.color},
                                        0 0 ${particle.size * 4}px ${particle.color},
                                        0 0 ${particle.size * 8}px ${particle.color},
                                        0 0 ${particle.size * 12}px ${particle.color}50
                                    `,
                                }}
                                animate={{
                                    x: [-30 + (i % 4) * 15, 30 - (i % 4) * 15, -30 + (i % 4) * 15],
                                    y: [-25 + (i % 3) * 12, 25 - (i % 3) * 12, -25 + (i % 3) * 12],
                                    opacity: [0.7, 1, 0.7],
                                    scale: [0.9, 1.4, 0.9],
                                }}
                                transition={{
                                    duration: 4 + (i % 5) * 1,
                                    repeat: Infinity,
                                    ease: "easeInOut",
                                    delay: particle.delay,
                                }}
                            />
                        ))}
                    </motion.div>,
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
                        "relative overflow-hidden border-4 will-change-transform z-[53]",
                        // Less intense shadow on mobile for performance
                        isMobile ? "shadow-lg animate-in zoom-in-50 fade-in-0 duration-500 ease-out" : "shadow-2xl",
                        isLight ? "bg-[#f4ebd0] border-[#2b1409] text-[#2b1409]" : "bg-[#e0d6b9] border-black text-black"
                    )}
                >
                    {/* Newspaper Header */}
                    <div className="border-b-4 border-black p-2 sm:p-3 text-center relative z-10">
                        <div className="flex items-center justify-center border-b-2 border-black pb-1.5">
                            <span className="border-2 border-black bg-black px-2 py-0.5 sm:px-3 font-serif text-xs sm:text-sm font-bold uppercase tracking-widest text-[#f4ebd0] shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]">
                                {dailyDate}
                            </span>
                        </div>
                        <h2 className="mt-1.5 font-serif text-xl sm:text-2xl font-black uppercase tracking-tight whitespace-nowrap">THE WORDLY POST</h2>
                        <div className="mt-1 flex items-center justify-center gap-4 text-[8px] sm:text-[9px] font-bold uppercase tracking-widest">
                            <span>Vol. {dailyDate.replace(/-/g, '')}</span>
                        </div>
                    </div>

                    {/* Content Body */}
                    <div className="p-3 sm:p-4">
                        {displayHasPlayed ? (
                            <div className="flex flex-col items-center gap-2 sm:gap-3 text-center">
                                <h3 className="font-serif text-sm sm:text-base font-bold uppercase">
                                    {displayIsSolved ? 'EXTRA! EXTRA! YOU DID IT!' : 'SCANDAL! WORD MISSED!'}
                                </h3>

                                {/* Word with inline icon */}
                                <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider opacity-60">The word was</p>
                                <div className="flex items-center justify-center gap-2">
                                    <div className="flex gap-0.5">
                                        {dailyWord.toUpperCase().split('').map((letter, idx) => (
                                            <div
                                                key={idx}
                                                className={cn(
                                                    "w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-sm sm:text-base font-black border-2 border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]",
                                                    displayIsSolved ? "bg-[#6aaa64] text-white" : "bg-[#787c7e] text-white"
                                                )}
                                            >
                                                {letter}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <p className="font-serif text-[10px] sm:text-xs leading-tight opacity-70">
                                    {displayIsSolved
                                        ? "Statistics confirm: You are a genius."
                                        : "Better luck next time, champion."
                                    }
                                </p>

                                {/* Newspaper-style Stats Section */}
                                <div className="grid w-full grid-cols-2 border-t border-b border-dashed border-black/50 py-2 sm:py-3 mt-2">
                                    {/* Streak Column */}
                                    <div className="flex flex-col items-center justify-center border-r border-dashed border-black/50 px-2">
                                        <span className="text-[8px] sm:text-[9px] font-serif uppercase tracking-[0.15em] opacity-70">Current Streak</span>

                                        {/* Streak Number - Black for 0-6, Ink-colored gradient for 7+ */}
                                        {displayStreak < 7 ? (
                                            <span className="text-3xl sm:text-4xl font-serif font-black leading-tight">{displayStreak}</span>
                                        ) : (
                                            <span
                                                className="text-3xl sm:text-4xl font-serif font-black leading-tight"
                                                style={{
                                                    backgroundImage: `linear-gradient(135deg, ${particleConfig.gradientColors.from} 0%, ${particleConfig.gradientColors.from} 60%, ${particleConfig.gradientColors.to} 100%)`,
                                                    backgroundSize: '100% 100%',
                                                    WebkitBackgroundClip: 'text',
                                                    WebkitTextFillColor: 'transparent',
                                                }}
                                            >
                                                {displayStreak}
                                            </span>
                                        )}

                                        {/* Newspaper-style Progress Indicators - Like ink dots */}
                                        {displayStreak >= 7 && (
                                            <div className="flex items-center gap-[2px] mt-1">
                                                {Array.from({ length: 15 }).map((_, i) => {
                                                    const isFilled = i < Math.min(displayStreak, 15);
                                                    const barColor = particleConfig.particles[i]?.color || '#ea580c';
                                                    return (
                                                        <div
                                                            key={`bar-${i}`}
                                                            className="w-[2px] h-[5px] rounded-[1px]"
                                                            style={{
                                                                backgroundColor: isFilled ? barColor : 'rgba(0,0,0,0.12)',
                                                                opacity: isFilled ? 0.9 : 0.4,
                                                            }}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <span className="text-[7px] sm:text-[8px] font-serif italic opacity-60 mt-0.5">consecutive days</span>
                                    </div>

                                    {/* Solver Rank Column */}
                                    <div className="flex flex-col items-center justify-center px-2">
                                        <span className="text-[8px] sm:text-[9px] font-serif uppercase tracking-[0.15em] opacity-70">Solved Rank</span>
                                        {solveRank !== null ? (
                                            <>
                                                <span className="text-3xl sm:text-4xl font-serif font-black leading-tight">
                                                    {solveRank.toLocaleString()}{(() => {
                                                        const n = solveRank;
                                                        const s = ['th', 'st', 'nd', 'rd'];
                                                        const v = n % 100;
                                                        return <sup className="text-xs font-normal">{s[(v - 20) % 10] || s[v] || s[0]}</sup>;
                                                    })()}
                                                </span>
                                                <span className="text-[7px] sm:text-[8px] font-serif italic opacity-60 mt-0.5">to solve today</span>
                                            </>
                                        ) : (
                                            <span className="text-xl sm:text-2xl font-serif font-black">—</span>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-2 sm:mt-3 flex w-full flex-col gap-2">
                                    <Button
                                        onClick={handleShare}
                                        disabled={isSharing}
                                        className={cn(
                                            "w-full rounded-none border-2 border-black bg-black text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] transition-all hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,0.5)] active:translate-y-0 active:shadow-none text-xs sm:text-sm uppercase font-bold tracking-widest gap-1.5 py-2 sm:py-2.5",
                                            hasCopied ? "bg-green-600 border-green-800" : ""
                                        )}
                                    >
                                        {isSharing ? (
                                            <span>@{profile?.username || user?.displayName || 'WORDMATES'}</span>
                                        ) : (
                                            <>
                                                {hasCopied ? <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                                                {hasCopied ? "SENT!" : "SHARE NEWSPAPER"}
                                            </>
                                        )}
                                    </Button>

                                    <div className="flex items-center justify-center gap-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest opacity-70">
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
                            onClick={() => {
                                // Cycle through ranges: 0-6, 7-14, 15-29, 30-179, 180-364, 365+
                                const ranges = [
                                    { min: 0, max: 6, label: '0-6' },
                                    { min: 7, max: 14, label: '7-14' },
                                    { min: 15, max: 29, label: '15-29' },
                                    { min: 30, max: 179, label: '30-179' },
                                    { min: 180, max: 364, label: '180-364' },
                                    { min: 365, max: 400, label: '365+' },
                                ];
                                // Find current range index based on displayStreak
                                let currentIdx = ranges.findIndex(r => displayStreak >= r.min && displayStreak <= r.max);
                                if (currentIdx === -1) currentIdx = 0;
                                // Go to next range
                                const nextIdx = (currentIdx + 1) % ranges.length;
                                const nextRange = ranges[nextIdx];
                                // Pick middle value of range
                                const nextVal = Math.floor((nextRange.min + nextRange.max) / 2);
                                setDebugStreak(nextVal === 0 ? null : nextVal);
                            }}
                            className="px-2 py-0.5 text-[10px] font-bold rounded border bg-gradient-to-r from-orange-500 via-purple-500 to-cyan-500 text-white border-white/50 hover:opacity-80"
                        >
                            🔄 Cycle
                        </button>
                        <span className="text-white text-[10px] mx-1">|</span>
                        <button
                            onClick={() => setDebugHasPlayed(v => v === null ? true : v ? false : null)}
                            className={cn(
                                "px-2 py-0.5 text-[10px] font-bold rounded border",
                                debugHasPlayed !== null
                                    ? "bg-white text-black border-white"
                                    : "bg-transparent text-white border-white/50 hover:bg-white/20"
                            )}
                        >
                            Played: {debugHasPlayed === null ? 'Real' : debugHasPlayed ? '✓' : '✗'}
                        </button>
                        <button
                            onClick={() => setDebugIsSolved(v => v === null ? true : v ? false : null)}
                            className={cn(
                                "px-2 py-0.5 text-[10px] font-bold rounded border",
                                debugIsSolved !== null
                                    ? "bg-white text-black border-white"
                                    : "bg-transparent text-white border-white/50 hover:bg-white/20"
                            )}
                        >
                            Solved: {debugIsSolved === null ? 'Real' : debugIsSolved ? '✓' : '✗'}
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog >
    );
}
