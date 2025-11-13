'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Crown, Users, Gamepad2, Hourglass, Swords, Handshake } from 'lucide-react';

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
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { createGame } from '@/lib/actions/game';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from './auth-provider';

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
  const { user } = useAuth();
  const [multiplayerMode, setMultiplayerMode] = useState<'pvp' | 'co-op' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setMultiplayerMode(null);
    }
  }, [isOpen, form]);

  const handleStartGame = async (values: FormValues) => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "You must be signed in to create a game.",
      });
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (gameType === 'multiplayer' && !multiplayerMode) {
        toast({
          variant: "destructive",
          title: "Mode Required",
          description: "Please select PvP or Co-op mode.",
        });
        setIsSubmitting(false);
        return;
      }
      
      const gameSettings = {
        ...values,
        gameType,
        multiplayerMode: gameType === 'multiplayer' ? multiplayerMode : null,
        creatorId: user.uid,
      };
      
      // Use a server action to create the game
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
                <form onSubmit={form.handleSubmit(handleStartGame)} className="space-y-6 px-6">
                  <FormField
                    control={form.control}
                    name="wordLength"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex justify-between items-center">
                          <FormLabel className="flex items-center"><Gamepad2 className="mr-2 h-4 w-4" /> Word Length</FormLabel>
                          <span className="text-lg font-bold">{field.value}</span>
                        </div>
                        <FormControl>
                          <Slider
                            min={4}
                            max={6}
                            step={1}
                            value={[field.value]}
                            onValueChange={(value) => field.onChange(value[0])}
                          />
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
                            <FormItem><FormControl><RadioGroupItem value="unlimited" id="m-unlimited" className="sr-only" /></FormControl><FormLabel htmlFor="m-unlimited" className="flex items-center justify-center p-2 rounded-md border-2 border-muted hover:border-primary cursor-pointer [&[data-state=checked]]:border-primary">Unlimited</FormLabel></FormItem>
                            <FormItem><FormControl><RadioGroupItem value="3" id="m-3" className="sr-only" /></FormControl><FormLabel htmlFor="m-3" className="flex items-center justify-center p-2 rounded-md border-2 border-muted hover:border-primary cursor-pointer [&[data-state=checked]]:border-primary">3:00</FormLabel></FormItem>
                            <FormItem><FormControl><RadioGroupItem value="5" id="m-5" className="sr-only" /></FormControl><FormLabel htmlFor="m-5" className="flex items-center justify-center p-2 rounded-md border-2 border-muted hover:border-primary cursor-pointer [&[data-state=checked]]:border-primary">5:00</FormLabel></FormItem>
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
                                <FormItem><FormControl><RadioGroupItem value="unlimited" id="t-unlimited" className="sr-only" /></FormControl><FormLabel htmlFor="t-unlimited" className="flex items-center justify-center p-2 rounded-md border-2 border-muted hover:border-primary cursor-pointer [&[data-state=checked]]:border-primary">Unlimited</FormLabel></FormItem>
                                <FormItem><FormControl><RadioGroupItem value="30" id="t-30" className="sr-only" /></FormControl><FormLabel htmlFor="t-30" className="flex items-center justify-center p-2 rounded-md border-2 border-muted hover:border-primary cursor-pointer [&[data-state=checked]]:border-primary">30s</FormLabel></FormItem>
                                <FormItem><FormControl><RadioGroupItem value="60" id="t-60" className="sr-only" /></FormControl><FormLabel htmlFor="t-60" className="flex items-center justify-center p-2 rounded-md border-2 border-muted hover:border-primary cursor-pointer [&[data-state=checked]]:border-primary">60s</FormLabel></FormItem>
                              </RadioGroup>
                             </FormControl>
                          </FormItem>
                        )}
                      />
                      <Separator />
                      <div className="space-y-2">
                        <FormLabel>Multiplayer Mode</FormLabel>
                        <div className="grid grid-cols-2 gap-4">
                            <Button type="button" variant={multiplayerMode === 'pvp' ? 'default' : 'outline'} className="h-20 text-lg" onClick={() => setMultiplayerMode('pvp')}><Swords className="mr-2" />PvP</Button>
                            <Button type="button" variant={multiplayerMode === 'co-op' ? 'default' : 'outline'} className="h-20 text-lg" onClick={() => setMultiplayerMode('co-op')}><Handshake className="mr-2" />Co-op</Button>
                        </div>
                         <FormMessage />
                      </div>
                    </>
                  )}
                </form>
              </Form>
              <DialogFooter className="p-6 pt-4">
                <Button type="submit" size="lg" className="w-full h-14 text-xl" onClick={form.handleSubmit(handleStartGame)} disabled={isSubmitting}>
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
