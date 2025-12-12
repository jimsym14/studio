'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Crown, Users, Gamepad2, Hourglass, Swords, Handshake, Lock, Unlock } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsSegmentedControl } from '@/components/settings-segmented-control';
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
import { rememberLobbyPasscode } from '@/lib/lobby-passcode';
import { sendGameInviteAction } from '@/lib/actions/notifications';
import { socialPost } from '@/lib/social-client';
import { useToast } from '@/hooks/use-toast';
import { useFirebase } from '@/components/firebase-provider';
import { cn } from '@/lib/utils';
import type { GameType } from '@/types/game';

interface SettingsModalProps {
  isOpen: boolean;
  gameType: GameType | null;
  onClose: () => void;
  inviteFriendId?: string;
  inviteFriendUsername?: string;
  prefilledPasscode?: string;
}

const passcodeField = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? '');

const formSchema = z
  .object({
    wordLength: z.number().min(4).max(6),
    matchTime: z.enum(['unlimited', '3', '5']),
    roundsSetting: z.number().optional(),
    turnTime: z.enum(['unlimited', '30', '60']),
    visibility: z.enum(['public', 'private']),
    passcode: passcodeField,
  })
  .superRefine((data, ctx) => {
    if (data.visibility === 'private' && !data.passcode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passcode'],
        message: 'Private lobbies need a passcode.',
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const FORM_DEFAULTS: FormValues = {
  wordLength: 5,
  matchTime: 'unlimited',
  roundsSetting: 1,
  turnTime: 'unlimited',
  visibility: 'public',
  passcode: '',
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};


export function SettingsModal({ isOpen, gameType, onClose, inviteFriendId, inviteFriendUsername, prefilledPasscode }: SettingsModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { theme } = useTheme();
  const { userId, user, profile } = useFirebase();
  const [multiplayerMode, setMultiplayerMode] = useState<'pvp' | 'co-op'>('pvp');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAuthReady = Boolean(userId);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: inviteFriendId && prefilledPasscode
      ? { ...FORM_DEFAULTS, visibility: 'private', passcode: prefilledPasscode }
      : FORM_DEFAULTS,
  });

  useEffect(() => {
    if (isOpen) {
      const defaults = inviteFriendId && prefilledPasscode
        ? { ...FORM_DEFAULTS, visibility: 'private' as const, passcode: prefilledPasscode }
        : FORM_DEFAULTS;
      form.reset(defaults);
      setMultiplayerMode('pvp');
    }
  }, [isOpen, form, inviteFriendId, prefilledPasscode]);

  const visibilityValue = form.watch('visibility');

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
      const cleanedPasscode = values.visibility === 'private' ? values.passcode : '';
      const gameSettings = {
        ...values,
        passcode: cleanedPasscode ?? '',
        gameType,
        multiplayerMode: gameType === 'multiplayer' ? multiplayerMode : null,
        creatorId: userId,
        creatorDisplayName: profile?.username ?? user?.displayName ?? 'Player',
      };
      const authToken = await user?.getIdToken?.();
      if (!authToken) {
        throw new Error('Unable to fetch auth token.');
      }

      const gameId = await createGame(gameSettings, firebaseConfig, authToken);

      if (gameId) {
        if (values.visibility === 'private' && cleanedPasscode) {
          rememberLobbyPasscode(gameId, cleanedPasscode);
        }

        // If inviting a friend, send the invite via chat
        if (inviteFriendId) {
          try {
            const lobbyUrl = typeof window === 'undefined' ? `/lobby/${gameId}` : `${window.location.origin}/lobby/${gameId}`;
            const lobbyUrlWithPasscode = cleanedPasscode ? `${lobbyUrl}?passcode=${cleanedPasscode}` : lobbyUrl;

            // Send game invite notification
            await sendGameInviteAction(inviteFriendId, gameId, cleanedPasscode || null, authToken);

            // Open chat room and send message with the link
            try {
              const chatResponse = await socialPost<{ chat?: { chatId?: string } }>('/api/chats/open', {
                context: 'friend',
                userId: inviteFriendId,
              });
              const chatId = chatResponse.chat?.chatId;

              if (chatId) {
                const inviteMessage = cleanedPasscode
                  ? `Join me: ${lobbyUrlWithPasscode} (code: ${cleanedPasscode})`
                  : `Join me: ${lobbyUrlWithPasscode}`;

                await socialPost('/api/chats/message', {
                  chatId,
                  text: inviteMessage,
                });
              }
            } catch (chatError) {
              console.warn('Failed to send chat message:', chatError);
            }

            // Copy to clipboard
            if (typeof window !== 'undefined' && navigator?.clipboard?.writeText) {
              const clipboardText = cleanedPasscode
                ? `${lobbyUrlWithPasscode} (code: ${cleanedPasscode})`
                : lobbyUrlWithPasscode;
              navigator.clipboard
                .writeText(clipboardText)
                .catch(() => undefined);
            }

            toast({
              title: values.visibility === 'private' ? 'Private lobby ready' : 'Lobby ready',
              description: inviteFriendUsername
                ? `Invitation sent to @${inviteFriendUsername}.`
                : 'Invitation sent to your friend.',
            });
          } catch (inviteError) {
            console.warn('Failed to send invite:', inviteError);
            toast({
              variant: 'destructive',
              title: 'Lobby created but invite failed',
              description: 'We copied the lobby link to your clipboard—send it manually.',
            });
          }
        }

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
    setMultiplayerMode(mode);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <AnimatePresence>
        {isOpen && (
          <DialogContent className={cn(
            "max-w-md w-[95vw] p-0 overflow-hidden max-h-[90vh] flex flex-col backdrop-blur-3xl border-white/20 shadow-2xl",
            gameType === 'solo'
              ? "bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.25)_0%,rgba(255,255,255,0.9)_40%,rgba(255,255,255,0.9)_100%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.15)_0%,rgba(20,20,20,0.9)_40%,rgba(20,20,20,0.95)_100%)]"
              : "bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.25)_0%,rgba(255,255,255,0.9)_40%,rgba(255,255,255,0.9)_100%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.15)_0%,rgba(20,20,20,0.9)_40%,rgba(20,20,20,0.95)_100%)]",
            "rounded-3xl"
          )}>
            <DialogHeader className={cn(
              "px-4 py-3 text-white shrink-0",
              gameType === 'solo'
                ? "bg-gradient-to-br from-amber-500 to-orange-600"
                : "bg-gradient-to-br from-emerald-500 to-teal-600"
            )}>
              <DialogTitle className="flex items-center text-lg md:text-xl font-comic tracking-wide text-white drop-shadow-md">
                {gameType === 'solo' ? <Crown className="mr-2 h-5 w-5" /> : <Users className="mr-2 h-5 w-5" />}
                {gameType === 'solo' ? 'Singleplayer' : 'Multiplayer'}
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleStartGame)} id="settings-form" className="space-y-5">

                  {/* Multiplayer Mode Toggle - Top Level */}
                  {gameType === 'multiplayer' && (
                    <SettingsSegmentedControl
                      gameType={gameType}
                      value={multiplayerMode}
                      onChange={(val) => handleMultiplayerClick(val)}
                      options={[
                        { value: 'pvp', label: <div className="flex items-center gap-2"><Swords className="h-4 w-4" /> PvP</div> },
                        { value: 'co-op', label: <div className="flex items-center gap-2"><Handshake className="h-4 w-4" /> Co-op</div> },
                      ]}
                    />
                  )}

                  {/* Game Rules Section */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 ml-1">Game Rules</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                      {/* Word Length */}
                      <FormField
                        control={form.control}
                        name="wordLength"
                        render={({ field }) => (
                          <FormItem className="space-y-1.5">
                            <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
                              <Gamepad2 className="h-3.5 w-3.5" /> Word Length
                            </FormLabel>
                            <FormControl>
                              <SettingsSegmentedControl
                                gameType={gameType}
                                value={field.value}
                                onChange={field.onChange}
                                options={[
                                  { value: 4, label: '4' },
                                  { value: 5, label: '5' },
                                  { value: 6, label: '6' },
                                ]}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {/* Rounds - Multiplayer PvP Only */}
                      {gameType === 'multiplayer' && multiplayerMode === 'pvp' && (
                        <FormField
                          control={form.control}
                          name="roundsSetting"
                          render={({ field }) => (
                            <FormItem className="space-y-1.5">
                              <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
                                <Swords className="h-3.5 w-3.5" /> Rounds
                              </FormLabel>
                              <FormControl>
                                <SettingsSegmentedControl
                                  gameType={gameType}
                                  value={Number(field.value)}
                                  onChange={field.onChange}
                                  options={[
                                    { value: 1, label: '1' },
                                    { value: 3, label: '3' },
                                    { value: 5, label: '5' },
                                  ]}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}

                      {/* Match Time */}
                      <FormField
                        control={form.control}
                        name="matchTime"
                        render={({ field }) => (
                          <FormItem className="space-y-1.5">
                            <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
                              <Hourglass className="h-3.5 w-3.5" /> Round Time
                            </FormLabel>
                            <FormControl>
                              <SettingsSegmentedControl
                                gameType={gameType}
                                value={field.value}
                                onChange={field.onChange}
                                options={[
                                  { value: 'unlimited', label: '∞' },
                                  { value: '3', label: '3m' },
                                  { value: '5', label: '5m' }
                                ]}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {/* Turn Time - Multiplayer Only */}
                      {gameType === 'multiplayer' && (
                        <FormField
                          control={form.control}
                          name="turnTime"
                          render={({ field }) => (
                            <FormItem className="space-y-1.5">
                              <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
                                <Hourglass className="h-3.5 w-3.5" /> Turn Limit
                              </FormLabel>
                              <FormControl>
                                <SettingsSegmentedControl
                                  gameType={gameType}
                                  value={field.value}
                                  onChange={field.onChange}
                                  options={[
                                    { value: 'unlimited', label: '∞' },
                                    { value: '30', label: '30s' },
                                    { value: '60', label: '60s' }
                                  ]}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                  </div>

                  {/* Lobby Settings - Multiplayer Only */}
                  {gameType === 'multiplayer' && (
                    <div className="space-y-3">
                      <Separator className="bg-black/5 dark:bg-white/10" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/80 ml-1">Lobby Settings</h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name="visibility"
                          render={({ field }) => (
                            <FormItem className="space-y-1.5">
                              <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
                                <Lock className="h-3.5 w-3.5" /> Visibility
                              </FormLabel>
                              <FormControl>
                                <SettingsSegmentedControl
                                  gameType={gameType}
                                  value={field.value}
                                  onChange={field.onChange}
                                  options={[
                                    { value: 'public', label: 'PUBLIC' },
                                    { value: 'private', label: 'PRIVATE' },
                                  ]}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        {/* Passcode - conditional */}
                        {visibilityValue === 'private' && (
                          <FormField
                            control={form.control}
                            name="passcode"
                            render={({ field }) => (
                              <FormItem className="space-y-1.5">
                                <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
                                  <Lock className="h-3.5 w-3.5" /> Passcode
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="password"
                                    placeholder="Secret phrase..."
                                    className="h-[38px] rounded-xl bg-neutral-100/50 dark:bg-neutral-900/30 border-black/5 dark:border-white/5 focus-visible:ring-emerald-500 font-moms text-sm"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        )}
                      </div>
                    </div>
                  )}

                </form>
              </Form>
            </div>

            <DialogFooter className="p-4 pt-2 shrink-0">
              <Button
                type="submit"
                form="settings-form"
                size="lg"
                className={cn(
                  "w-full h-11 text-base font-bold font-moms uppercase tracking-widest shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] rounded-xl",
                  gameType === 'solo'
                    ? "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-orange-500/20"
                    : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-emerald-500/20"
                )}
                disabled={isSubmitting || !isAuthReady}
              >
                {!isAuthReady ? 'Connecting…' : isSubmitting ? 'Starting...' : inviteFriendId ? 'Start & Invite' : 'Start Game'}
              </Button>
            </DialogFooter>
          </DialogContent >
        )
        }
      </AnimatePresence >
    </Dialog >
  );
}
