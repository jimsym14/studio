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
    const isMobile = useIsMobile();

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

    const handleShare = async () => {
        if (!process.browser || isSharing || !newspaperRef.current) return;
        setIsSharing(true);

        const title = `WordMates Daily ${dailyDate}`;
        const shareText = `Play at: ${window.location.origin}/daily`;

        try {
            // Generate Image
            // We need to ensure the font is loaded, usually fine.
            // Using toBlob is efficient.
            const blob = await toBlob(newspaperRef.current, {
                cacheBust: true,
                style: {
                    transform: 'scale(1)', // Ensure no weird transforms during capture if any
                }
            });

            if (!blob) throw new Error("Failed to generate image");

            // Check if Web Share API supports files
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'daily-result.png', { type: blob.type })] })) {
                const file = new File([blob], `wordmates-daily-${dailyDate}.png`, { type: 'image/png' });
                await navigator.share({
                    title: title,
                    text: shareText,
                    files: [file]
                });
                setHasCopied(true);
            } else {
                // Fallback to clipboard for image if supported (mostly desktop Chrome/Safari)
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            [blob.type]: blob
                        })
                    ]);
                    toast({ title: "Image copied to clipboard!", className: isLight ? "bg-black text-[#f4ebd0]" : "bg-[#e0d6b9] text-black" });
                    setHasCopied(true);
                } catch (clipboardErr) {
                    // Last Resort Fallback: Text Only
                    console.warn("Image copy failed, falling back to text", clipboardErr);
                    const fallbackText = `${title}\n${isSolved ? 'Solved' : 'Missed'}! Streak: ${streak}\n${shareText}`;
                    await navigator.clipboard.writeText(fallbackText);
                    toast({ title: "Copied text to clipboard!", className: isLight ? "bg-black text-[#f4ebd0]" : "bg-[#e0d6b9] text-black" });
                    setHasCopied(true);
                }
            }

            setTimeout(() => setHasCopied(false), 2000);
        } catch (err) {
            console.error("Failed to share", err);
            toast({ title: "Failed to share result", variant: "destructive" });
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
                            <div className="flex flex-col items-center gap-4 sm:gap-6 text-center">
                                <div className="rounded-full border-4 border-black p-3 sm:p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                    {isSolved ? <Trophy className="h-8 w-8 sm:h-12 sm:w-12" /> : <X className="h-8 w-8 sm:h-12 sm:w-12" />}
                                </div>

                                <div className="space-y-1 sm:space-y-2">
                                    <h3 className="font-serif text-xl sm:text-2xl font-bold uppercase">
                                        {isSolved ? 'EXTRA! EXTRA! YOU DID IT!' : 'SCANDAL! WORD MISSED!'}
                                    </h3>
                                    <p className="font-serif text-base sm:text-lg leading-tight sm:leading-snug">
                                        {isSolved
                                            ? `Statistics confirm: You are a genius. The word was indeed "${dailyWord.toUpperCase()}".`
                                            : `Sources say the word was "${dailyWord.toUpperCase()}". Better luck next time.`
                                        }
                                    </p>
                                </div>

                                <div className="grid w-full grid-cols-2 gap-3 sm:gap-4 border-t-2 border-black pt-3 sm:pt-4">
                                    <div className="flex flex-col items-center border-r-2 border-black">
                                        <span className="text-2xl sm:text-3xl font-black">{streak}</span>
                                        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest">Day Streak</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="text-2xl sm:text-3xl font-black">?</span>
                                        <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest">Global Solvers</span>
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
                                            <span className="animate-pulse">Generating...</span>
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
                        className="absolute right-[-8px] top-[-8px] sm:right-[-12px] sm:top-[-12px] z-50 rounded-full border-2 border-black bg-white p-1.5 sm:p-2 text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-[#ff5555] hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4 sm:h-5 sm:w-5 stroke-[3]" />
                    </motion.button>
                </motion.div>
            </DialogContent>
        </Dialog>
    );
}
