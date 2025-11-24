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

type GameType = 'solo' | 'multiplayer' | null;

interface SettingsModalProps {
  isOpen: boolean;
  gameType: GameType;
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
            "max-w-md w-[95vw] p-0 overflow-hidden max-h-[90vh] flex flex-col backdrop-blur-xl border-white/20 shadow-2xl",
            gameType === 'solo'
              ? "bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.3)_0%,rgba(255,255,255,0.85)_40%,rgba(255,255,255,0.85)_100%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.2)_0%,rgba(0,0,0,0.85)_40%,rgba(0,0,0,0.85)_100%)]"
              : "bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.3)_0%,rgba(255,255,255,0.85)_40%,rgba(255,255,255,0.85)_100%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.2)_0%,rgba(0,0,0,0.85)_40%,rgba(0,0,0,0.85)_100%)]",
            "rounded-3xl"
          )}>
            <DialogHeader className={cn(
              "p-3 md:p-4 pb-2 md:pb-3 text-white shrink-0",
              gameType === 'solo'
                ? "bg-gradient-to-br from-amber-500 to-orange-600"
                : "bg-gradient-to-br from-emerald-500 to-teal-600"
            )}>
              <DialogTitle className="flex items-center text-xl md:text-2xl font-comic tracking-wide text-white drop-shadow-md">
                {gameType === 'solo' ? <Crown className="mr-2 h-5 w-5 md:h-6 md:w-6" /> : <Users className="mr-2 h-5 w-5 md:h-6 md:w-6" />}
                {gameType === 'solo' ? 'Singleplayer' : 'Multiplayer'}
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-3 md:px-4 py-3 md:py-4">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleStartGame)} id="settings-form" className="space-y-3 md:space-y-4">
                  <FormField
                    control={form.control}
                    name="wordLength"
                    render={({ field }) => (
                      <FormItem className="space-y-1.5 md:space-y-2">
                        <FormLabel className="flex items-center text-sm md:text-base font-bold"><Gamepad2 className="mr-1.5 h-3.5 w-3.5 md:mr-2 md:h-4 md:w-4" /> Word Length</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={(value) => field.onChange(Number(value))}
                            defaultValue={String(field.value)}
                            className="grid grid-cols-3 gap-2"
                          >
                            {[4, 5, 6].map((val) => (
                              <FormItem key={val} className="space-y-0">
                                <FormControl>
                                  <RadioGroupItem value={String(val)} id={`wl-${val}`} className="sr-only" />
                                </FormControl>
                                <FormLabel
                                  htmlFor={`wl-${val}`}
                                  className={cn(
                                    "flex flex-col items-center justify-center p-1.5 md:p-2 rounded-lg border-2 cursor-pointer transition-all duration-200 hover:scale-105",
                                    field.value === val
                                      ? cn(
                                        "font-bold shadow-sm",
                                        gameType === 'solo'
                                          ? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                                          : "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      )
                                      : "border-muted bg-background/50 hover:border-primary/50"
                                  )}
                                >
                                  <span className="text-sm md:text-base font-bold font-moms">{val}</span>
                                  <span className="text-[0.55rem] md:text-[0.6rem] uppercase tracking-wider text-muted-foreground font-moms">Letters</span>
                                </FormLabel>
                              </FormItem>
                            ))}
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="matchTime"
                    render={({ field }) => (
                      <FormItem className="space-y-1.5 md:space-y-2">
                        <FormLabel className="flex items-center text-sm md:text-base font-bold"><Hourglass className="mr-1.5 h-3.5 w-3.5 md:mr-2 md:h-4 md:w-4" /> Match Time</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="grid grid-cols-3 gap-2"
                          >
                            {[
                              { val: 'unlimited', label: '∞', sub: 'No Limit' },
                              { val: '3', label: '3:00', sub: 'Minutes' },
                              { val: '5', label: '5:00', sub: 'Minutes' }
                            ].map((opt) => (
                              <FormItem key={opt.val} className="space-y-0">
                                <FormControl>
                                  <RadioGroupItem value={opt.val} id={`m-${opt.val}`} className="sr-only" />
                                </FormControl>
                                <FormLabel
                                  htmlFor={`m-${opt.val}`}
                                  className={cn(
                                    "flex flex-col items-center justify-center p-1.5 md:p-2 rounded-lg border-2 cursor-pointer transition-all duration-200 hover:scale-105",
                                    field.value === opt.val
                                      ? cn(
                                        "font-bold shadow-sm",
                                        gameType === 'solo'
                                          ? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                                          : "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      )
                                      : "border-muted bg-background/50 hover:border-primary/50"
                                  )}
                                >
                                  <span className="text-sm md:text-base font-bold font-moms">{opt.label}</span>
                                  <span className="text-[0.55rem] md:text-[0.6rem] uppercase tracking-wider text-muted-foreground font-moms">{opt.sub}</span>
                                </FormLabel>
                              </FormItem>
                            ))}
                          </RadioGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {gameType === 'multiplayer' && (
                    <>
                      <Separator className="my-2" />

                      <FormField
                        control={form.control}
                        name="visibility"
                        render={({ field }) => (
                          <FormItem className="space-y-1.5 md:space-y-2">
                            <FormLabel className="flex items-center text-sm md:text-base font-bold">
                              <Lock className="mr-1.5 h-3.5 w-3.5 md:mr-2 md:h-4 md:w-4" /> Lobby visibility
                            </FormLabel>
                            <FormControl>
                              <RadioGroup
                                onValueChange={field.onChange}
                                value={field.value}
                                className="grid grid-cols-2 gap-2"
                              >
                                <FormItem className="space-y-0">
                                  <FormControl>
                                    <RadioGroupItem value="public" id="vis-public" className="sr-only" />
                                  </FormControl>
                                  <FormLabel
                                    htmlFor="vis-public"
                                    className={cn(
                                      'flex flex-col gap-0.5 md:gap-1 rounded-xl border-2 border-muted bg-background/40 px-2.5 py-2 md:px-3 md:py-2 text-left text-sm font-semibold transition hover:border-primary/70 h-full',
                                      field.value === 'public' && "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    )}
                                  >
                                    <span className="flex items-center gap-1.5 text-xs md:text-sm">
                                      <Unlock className="h-3 w-3" /> Public
                                    </span>
                                    <span className="text-[0.6rem] md:text-[0.65rem] font-normal text-muted-foreground leading-tight">
                                      Listed in lobby browser with instant joins.
                                    </span>
                                  </FormLabel>
                                </FormItem>
                                <FormItem className="space-y-0">
                                  <FormControl>
                                    <RadioGroupItem value="private" id="vis-private" className="sr-only" />
                                  </FormControl>
                                  <FormLabel
                                    htmlFor="vis-private"
                                    className={cn(
                                      'flex flex-col gap-0.5 md:gap-1 rounded-xl border-2 border-muted bg-background/40 px-2.5 py-2 md:px-3 md:py-2 text-left text-sm font-semibold transition hover:border-primary/70 h-full',
                                      field.value === 'private' && "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    )}
                                  >
                                    <span className="flex items-center gap-1.5 text-xs md:text-sm">
                                      <Lock className="h-3 w-3" /> Private
                                    </span>
                                    <span className="text-[0.6rem] md:text-[0.65rem] font-normal text-muted-foreground leading-tight">
                                      Hidden in browse list. Share passcode manually.
                                    </span>
                                  </FormLabel>
                                </FormItem>
                              </RadioGroup>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {visibilityValue === 'private' && (
                        <FormField
                          control={form.control}
                          name="passcode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center text-sm md:text-base font-bold">
                                <Lock className="mr-1.5 h-3.5 w-3.5 md:mr-2 md:h-4 md:w-4" /> Passcode
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="password"
                                  placeholder="Enter a secret phrase"
                                  className="rounded-xl border border-muted bg-background/40 px-3 py-1.5 md:py-2 text-xs md:text-sm h-9 md:h-10 focus-visible:ring-emerald-500"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      <FormField
                        control={form.control}
                        name="turnTime"
                        render={({ field }) => (
                          <FormItem className="space-y-1.5 md:space-y-2">
                            <FormLabel className="flex items-center text-sm md:text-base font-bold"><Hourglass className="mr-1.5 h-3.5 w-3.5 md:mr-2 md:h-4 md:w-4" /> Turn Time</FormLabel>
                            <FormControl>
                              <RadioGroup
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                className="grid grid-cols-3 gap-2"
                              >
                                {[
                                  { val: 'unlimited', label: '∞', sub: 'No Limit' },
                                  { val: '30', label: '30', sub: 'Seconds' },
                                  { val: '60', label: '60', sub: 'Seconds' }
                                ].map((opt) => (
                                  <FormItem key={opt.val} className="space-y-0">
                                    <FormControl>
                                      <RadioGroupItem value={opt.val} id={`t-${opt.val}`} className="sr-only" />
                                    </FormControl>
                                    <FormLabel
                                      htmlFor={`t-${opt.val}`}
                                      className={cn(
                                        "flex flex-col items-center justify-center p-1.5 md:p-2 rounded-lg border-2 cursor-pointer transition-all duration-200 hover:scale-105",
                                        field.value === opt.val
                                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold shadow-sm"
                                          : "border-muted bg-background/50 hover:border-primary/50"
                                      )}
                                    >
                                      <span className="text-sm md:text-base font-bold font-moms">{opt.label}</span>
                                      <span className="text-[0.55rem] md:text-[0.6rem] uppercase tracking-wider text-muted-foreground font-moms">{opt.sub}</span>
                                    </FormLabel>
                                  </FormItem>
                                ))}
                              </RadioGroup>
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <Separator className="my-2" />
                      <div className="space-y-1.5 md:space-y-2">
                        <FormLabel className="text-sm md:text-base font-bold">Multiplayer Mode</FormLabel>
                        <div className="grid grid-cols-2 gap-2 md:gap-3">
                          <button
                            type="button"
                            onClick={() => handleMultiplayerClick('pvp')}
                            className={cn(
                              "relative flex flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 md:p-3 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]",
                              multiplayerMode === 'pvp'
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm"
                                : "border-muted bg-background/50 text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-600/80"
                            )}
                          >
                            <Swords className={cn("h-5 w-5 md:h-6 md:w-6", multiplayerMode === 'pvp' ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
                            <span className="text-sm md:text-base font-bold font-moms">PvP</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleMultiplayerClick('co-op')}
                            className={cn(
                              "relative flex flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 md:p-3 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]",
                              multiplayerMode === 'co-op'
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm"
                                : "border-muted bg-background/50 text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-600/80"
                            )}
                          >
                            <Handshake className={cn("h-5 w-5 md:h-6 md:w-6", multiplayerMode === 'co-op' ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")} />
                            <span className="text-sm md:text-base font-bold font-moms">Co-op</span>
                          </button>
                        </div>
                        <FormMessage />
                      </div>
                    </>
                  )}
                </form>
              </Form>
            </div>

            <DialogFooter className="p-3 md:p-4 pt-2 shrink-0">
              <Button
                type="submit"
                form="settings-form"
                size="lg"
                className={cn(
                  "w-full h-10 md:h-12 text-base md:text-lg font-bold font-moms uppercase tracking-widest shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98]",
                  gameType === 'solo'
                    ? "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white"
                    : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
                )}
                disabled={isSubmitting || !isAuthReady}
              >
                {!isAuthReady ? 'Connecting…' : isSubmitting ? 'Starting...' : inviteFriendId ? 'Start Game and Invite' : 'Start Game'}
              </Button>
            </DialogFooter>
          </DialogContent >
        )
        }
      </AnimatePresence >
    </Dialog >
  );
}
