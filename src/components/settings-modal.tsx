'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Crown, Users, Gamepad2, Hourglass, Swords, Handshake } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { createGame } from '@/lib/actions/game';
import { useToast } from '@/hooks/use-toast';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { cn } from '@/lib/utils';

type GameType = 'solo' | 'multiplayer' | null;

interface SettingsModalProps {
  isOpen: boolean;
  gameType: GameType;
  onClose: () => void;
}

const formSchema = z.object({
  wordLength: z.number().min(4).max(6),
  matchTime: z.enum(['unlimited', '3', '5']),
  turnTime: z.enum(['unlimited', '30', '60']),
});

type FormValues = z.infer<typeof formSchema>;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};


export function SettingsModal({ isOpen, gameType, onClose }: SettingsModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { theme } = useTheme();
  const [multiplayerMode, setMultiplayerMode] = useState<'pvp' | 'co-op'>('pvp');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userId, setUserId] = useLocalStorage('wordmates-userId', '');
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  const [clickedButton, setClickedButton] = useState<string | null>(null);


  useEffect(() => {
    if (!userId) {
      setUserId(`user_${Math.random().toString(36).substring(2, 11)}`);
    }
  }, [userId, setUserId]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      wordLength: 5,
      matchTime: 'unlimited',
      turnTime: 'unlimited',
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset();
      setMultiplayerMode('pvp');
    }
  }, [isOpen, form]);

  const handleStartGame = async (values: FormValues) => {
    if (!userId) {
      toast({
        variant: "destructive",
        title: "User Error",
        description: "Could not identify user. Please refresh and try again.",
      });
      return;
    }
    
    setIsSubmitting(true);
    try {
      const gameSettings = {
        ...values,
        gameType,
        multiplayerMode: gameType === 'multiplayer' ? multiplayerMode : null,
        creatorId: userId,
      };
      
      const gameId = await createGame(gameSettings, firebaseConfig);
      
      if (gameId) {
        router.push(gameType === 'multiplayer' ? `/lobby/${gameId}` : `/game/${gameId}`);
        onClose();
      } else {
        throw new Error('Failed to create game.');
      }
    } catch (error) {
      console.error('Failed to start game:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not create the game. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMultiplayerClick = (mode: 'pvp' | 'co-op') => {
    setClickedButton(mode);
    setTimeout(() => setClickedButton(null), 200);
    setMultiplayerMode(mode);
  };

  const getButtonStyle = (buttonId: 'pvp' | 'co-op') => {
    const isDark = theme === 'dark';
    const isActive = multiplayerMode === buttonId;
    const isHovered = hoveredButton === buttonId;
    const isClicked = clickedButton === buttonId;

    const orange = '#EE7C2B';
    const bgColor = isDark ? '#151619' : '#F3F4F6';
    const activeColor = isDark ? '#151619' : '#F3F4F6';

    const baseStyle: React.CSSProperties = {
        transition: 'all 0.05s cubic-bezier(0.25, 0.25, 0.75, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '3.5rem',
        borderRadius: '1.5rem',
        cursor: 'pointer',
        border: 'none',
        fontSize: '1rem',
        fontWeight: 'bold',
    };

    if (isActive) {
      return {
        ...baseStyle,
        backgroundColor: orange,
        color: activeColor,
        boxShadow: isDark
          ? 'inset 8px 8px 16px #b8551f, inset -8px -8px 16px #ffa337'
          : 'inset 8px 8px 16px #c96022, inset -8px -8px 16px #ff9834',
        transform: isClicked 
          ? 'scale(0.90)' 
          : isHovered 
            ? 'scale(0.96)' 
            : 'scale(0.95)',
      };
    }
    
    return {
      ...baseStyle,
      backgroundColor: bgColor,
      color: orange,
      boxShadow: isDark 
        ? isHovered
          ? '14px 14px 28px #0a0b0c, -14px -14px 28px #202226, 0 0 40px rgba(238, 124, 43, 0.3)'
          : '8px 8px 16px #0a0b0c, -8px -8px 16px #202226'
        : isHovered
          ? '14px 14px 28px #c8c9cb, -14px -14px 28px #ffffff, 0 0 40px rgba(238, 124, 43, 0.2)'
          : '8px 8px 16px #d1d2d4, -8px -8px 16px #ffffff',
      transform: isClicked
        ? 'translateY(4px) scale(0.95)'
        : isHovered 
          ? 'translateY(-6px) scale(1.08)' 
          : 'scale(1)',
    };
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <AnimatePresence>
        {isOpen && (
          <DialogContent className="max-w-md p-0 overflow-hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <DialogHeader className="p-6 pb-4">
                <DialogTitle className="flex items-center text-2xl">
                  {gameType === 'solo' ? <Crown className="mr-2" /> : <Users className="mr-2" />}
                  {gameType === 'solo' ? 'Singleplayer' : 'Multiplayer'} Settings
                </DialogTitle>
                <DialogDescription>
                  Configure your game session.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleStartGame)} id="settings-form" className="space-y-6 px-6">
                  <FormField
                    control={form.control}
                    name="wordLength"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center"><Gamepad2 className="mr-2 h-4 w-4" /> Word Length</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={(value) => field.onChange(Number(value))}
                            defaultValue={String(field.value)}
                            className="grid grid-cols-3 gap-2"
                          >
                            <FormItem><FormControl><RadioGroupItem value="4" id="wl-4" className="sr-only" /></FormControl><FormLabel htmlFor="wl-4" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === 4 && "bg-primary text-primary-foreground")}>4</FormLabel></FormItem>
                            <FormItem><FormControl><RadioGroupItem value="5" id="wl-5" className="sr-only" /></FormControl><FormLabel htmlFor="wl-5" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === 5 && "bg-primary text-primary-foreground")}>5</FormLabel></FormItem>
                            <FormItem><FormControl><RadioGroupItem value="6" id="wl-6" className="sr-only" /></FormControl><FormLabel htmlFor="wl-6" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === 6 && "bg-primary text-primary-foreground")}>6</FormLabel></FormItem>
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="matchTime"
                    render={({ field }) => (
                       <FormItem>
                         <FormLabel className="flex items-center"><Hourglass className="mr-2 h-4 w-4" /> Match Time</FormLabel>
                         <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="grid grid-cols-3 gap-2"
                          >
                            <FormItem><FormControl><RadioGroupItem value="unlimited" id="m-unlimited" className="sr-only" /></FormControl><FormLabel htmlFor="m-unlimited" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === "unlimited" && "bg-primary text-primary-foreground")}>Unlimited</FormLabel></FormItem>
                            <FormItem><FormControl><RadioGroupItem value="3" id="m-3" className="sr-only" /></FormControl><FormLabel htmlFor="m-3" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === "3" && "bg-primary text-primary-foreground")}>3:00</FormLabel></FormItem>
                            <FormItem><FormControl><RadioGroupItem value="5" id="m-5" className="sr-only" /></FormControl><FormLabel htmlFor="m-5" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === "5" && "bg-primary text-primary-foreground")}>5:00</FormLabel></FormItem>
                          </RadioGroup>
                         </FormControl>
                       </FormItem>
                    )}
                  />

                  {gameType === 'multiplayer' && (
                    <>
                      <FormField
                        control={form.control}
                        name="turnTime"
                        render={({ field }) => (
                          <FormItem>
                             <FormLabel className="flex items-center"><Hourglass className="mr-2 h-4 w-4" /> Turn Time</FormLabel>
                             <FormControl>
                              <RadioGroup
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                className="grid grid-cols-3 gap-2"
                              >
                                <FormItem><FormControl><RadioGroupItem value="unlimited" id="t-unlimited" className="sr-only" /></FormControl><FormLabel htmlFor="t-unlimited" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === "unlimited" && "bg-primary text-primary-foreground")}>Unlimited</FormLabel></FormItem>
                                <FormItem><FormControl><RadioGroupItem value="30" id="t-30" className="sr-only" /></FormControl><FormLabel htmlFor="t-30" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === "30" && "bg-primary text-primary-foreground")}>30s</FormLabel></FormItem>
                                <FormItem><FormControl><RadioGroupItem value="60" id="t-60" className="sr-only" /></FormControl><FormLabel htmlFor="t-60" className={cn("flex items-center justify-center p-2 rounded-md border-2 border-muted bg-transparent hover:border-primary cursor-pointer", field.value === "60" && "bg-primary text-primary-foreground")}>60s</FormLabel></FormItem>
                              </RadioGroup>
                             </FormControl>
                          </FormItem>
                        )}
                      />
                      <Separator />
                      <div className="space-y-2">
                        <FormLabel>Multiplayer Mode</FormLabel>
                        <div className="grid grid-cols-2 gap-4">
                        <button 
                          type="button"
                          onMouseEnter={() => setHoveredButton('pvp')}
                          onMouseLeave={() => setHoveredButton(null)}
                          onClick={() => handleMultiplayerClick('pvp')}
                          style={getButtonStyle('pvp')}
                         >
                          <Swords className="mr-2 h-5 w-5" />PvP
                        </button>
                        <button 
                          type="button"
                          onMouseEnter={() => setHoveredButton('co-op')}
                          onMouseLeave={() => setHoveredButton(null)}
                          onClick={() => handleMultiplayerClick('co-op')}
                          style={getButtonStyle('co-op')}
                        >
                          <Handshake className="mr-2 h-5 w-5" />Co-op
                        </button>
                        </div>
                         <FormMessage />
                      </div>
                    </>
                  )}
                </form>
              </Form>
              <DialogFooter className="p-6 pt-4">
                <Button type="submit" form="settings-form" size="lg" className="w-full h-14 text-xl" disabled={isSubmitting}>
                  {isSubmitting ? 'Starting...' : 'Start Game'}
                </Button>
              </DialogFooter>
            </motion.div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  );
}
