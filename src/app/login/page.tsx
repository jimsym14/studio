'use client';

import { useCallback, useEffect, useState, type SVGProps } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCcw } from 'lucide-react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';

import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import {
  findEmailByUsername,
  fetchProfile,
  isUsernameAvailable,
  isUsernameValid,
  sanitizeUsername,
  upsertProfile,
} from '@/lib/profiles';
import { generateGuestHandle } from '@/lib/username-generator';
import { DEFAULT_PREFERENCES, type AuthProviderType } from '@/types/user';
import { cn } from '@/lib/utils';

type TabKey = 'signin' | 'signup' | 'guest';

const COPY = {
  tabs: {
    signin: 'Log in',
    signup: 'Register',
    guest: 'Guest',
  },
  labels: {
    identifier: 'Username or email',
    password: 'Password',
    username: 'Username (optional)',
    email: 'Email address (optional)',
    confirmPassword: 'Confirm password',
    guestHandle: 'Guest handle',
  },
  helper: {
    username: '',
    guest: '',
  },
  buttons: {
    signIn: 'Log in',
    signUp: 'Create account',
    guest: 'Play as guest',
    random: 'Shuffle handle',
    google: 'Continue with Google',
  },
  toasts: {
    guestReady: { title: 'Guest ready', description: 'Enjoy the next puzzle!' },
    guestFailed: { title: 'Something went wrong', description: 'We could not create a guest session.' },
    signIn: { title: 'Back in the grid', description: 'Good luck!' },
    signUp: { title: 'Account created', description: 'Handle locked in, time to play!' },
    welcomeBack: (username: string) => ({ title: 'Welcome back', description: `Good to see you, ${username}!` }),
    usernameSaved: (username: string) => ({ title: 'Username saved', description: `Welcome ${username}!` }),
  },
  errors: {
    usernameTaken: 'That handle is already taken.',
    usernameInvalid: 'Use letters, numbers, dots, dashes, or underscores.',
    userNotFound: 'No account found with that username.',
    guestTaken: 'Handle already in use. Try another vibe!',
    credentialsRequired: 'Provide a username or an email to continue.',
    usernameSaveFailed: "We couldn't save that username. Try again.",
  },
  dialog: {
    title: 'Pick your permanent username',
    description: 'It shows up in leaderboards and shared lobbies.',
    cancel: 'Cancel',
    confirm: 'Save handle',
    shuffle: 'Need inspo',
  },
} as const;

const usernameSchema = z.object({
  username: z
    .string()
    .min(3, 'Pick something at least 3 characters long')
    .max(20, 'Keep it under 20 characters')
    .refine((value) => isUsernameValid(value), {
      message: 'Use letters, numbers, dots, dashes, or underscores',
    }),
});

const optionalUsernameSchema = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? '')
  .refine((value) => value.length === 0 || value.length >= 3, {
    message: 'Pick something at least 3 characters long',
  })
  .refine((value) => value.length === 0 || value.length <= 20, {
    message: 'Keep it under 20 characters',
  })
  .refine((value) => value.length === 0 || isUsernameValid(value), {
    message: 'Use letters, numbers, dots, dashes, or underscores',
  });

const optionalEmailSchema = z
  .string()
  .optional()
  .transform((value) => (value ? value.trim().toLowerCase() : ''))
  .refine((value) => value.length === 0 || /\S+@\S+\.\S+/.test(value), {
    message: 'Enter a valid email',
  });

const signInSchema = z.object({
  identifier: z.string().min(3, 'Enter your username or email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signUpSchema = z
  .object({
    username: optionalUsernameSchema,
    email: optionalEmailSchema,
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(6, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .superRefine((data, ctx) => {
    if (data.username.length === 0 && data.email.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: COPY.errors.credentialsRequired,
        path: ['username'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: COPY.errors.credentialsRequired,
        path: ['email'],
      });
    }
  });

type UsernameValues = z.infer<typeof usernameSchema>;
type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { auth, db, user, profile, signOut } = useFirebase();
  const { toast } = useToast();
  const [guestName, setGuestName] = useState(generateGuestHandle);
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);
  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<AuthProviderType>('google');
  const [pendingMeta, setPendingMeta] = useState<{ email?: string | null; photoURL?: string | null }>({});
  const [activeTab, setActiveTab] = useState<TabKey>('signin');

  const copy = COPY;
  const tabOrder: TabKey[] = ['signin', 'signup', 'guest'];
  const activeIndex = tabOrder.indexOf(activeTab);
  const safeActiveIndex = Math.max(activeIndex, 0);
  const tabSlotWidth = 100 / tabOrder.length;
  const indicatorWidth = `calc(${tabSlotWidth}% - 0.5rem)`;
  const indicatorOffset = `calc(${safeActiveIndex * tabSlotWidth}% + 0.25rem)`;

  const usernameForm = useForm<UsernameValues>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: '' },
  });

  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { identifier: '', password: '' },
  });

  const signUpForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { username: '', email: '', password: '', confirmPassword: '' },
  });

  const resetUsernameDialog = useCallback(() => {
    setUsernameDialogOpen(false);
    setPendingMeta({});
    usernameForm.reset({ username: '' });
  }, [usernameForm]);

  useEffect(() => {
    if (usernameDialogOpen) {
      usernameForm.setValue('username', generateGuestHandle());
    }
  }, [usernameDialogOpen, usernameForm]);

  useEffect(() => {
    if (!user || !profile?.username || usernameDialogOpen) return;
    const timeout = window.setTimeout(() => {
      router.replace('/');
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [profile?.username, router, user, usernameDialogOpen]);

  useEffect(() => {
    if (user) return;
    setActiveTab('signin');
    setAuthFeedback(null);
    signInForm.reset({ identifier: '', password: '' });
    signUpForm.reset({ username: '', email: '', password: '', confirmPassword: '' });
  }, [signInForm, signUpForm, user]);

  const handleGuestEnter = async () => {
    if (!auth || !db) return;
    const validation = usernameSchema.safeParse({ username: guestName });
    if (!validation.success) {
      setGuestError(validation.error.format().username?._errors?.[0] ?? copy.errors.guestTaken);
      return;
    }

    setGuestLoading(true);
    setGuestError(null);
    let cleanupGuest = false;

    try {
      if (auth.currentUser) {
        await signOut();
      }
      const credential = await signInAnonymously(auth);
      cleanupGuest = true;
      const available = await isUsernameAvailable(db, guestName, credential.user.uid);
      if (!available) {
        setGuestError(copy.errors.guestTaken);
        await signOut();
        cleanupGuest = false;
        return;
      }
      await upsertProfile(db, credential.user.uid, {
        username: guestName,
        authProvider: 'guest',
        photoURL: `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(guestName)}`,
        avatarSeed: guestName,
        preferences: DEFAULT_PREFERENCES,
      });
      cleanupGuest = false;
      toast(copy.toasts.guestReady);
      setActiveTab('signin');
    } catch (error) {
      console.error('Guest login failed', error);
      toast({ variant: 'destructive', ...copy.toasts.guestFailed });
      if (cleanupGuest) {
        await signOut();
      }
    } finally {
      setGuestLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!auth || !db) return;
    setGoogleLoading(true);
    setAuthFeedback(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      const doc = await fetchProfile(db, credential.user.uid);
      if (!doc?.username) {
        setPendingProvider('google');
        setPendingMeta({ email: credential.user.email, photoURL: credential.user.photoURL });
        setUsernameDialogOpen(true);
      } else {
        toast(copy.toasts.welcomeBack(doc.username));
      }
    } catch (error) {
      console.error('Google auth failed', error);
      const message =
        error instanceof FirebaseError
          ? authMessage(error)
          : 'We could not sign you in with Google.';
      setAuthFeedback(message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSignIn = async (values: SignInValues) => {
    if (!auth || !db) return;
    setAuthFeedback(null);
    try {
      let email = values.identifier.trim();
      if (!email.includes('@')) {
        const lookup = await findEmailByUsername(db, email);
        if (!lookup) {
          throw new Error(copy.errors.userNotFound);
        }
        email = lookup;
      }
      await signInWithEmailAndPassword(auth, email, values.password);
      toast(copy.toasts.signIn);
    } catch (error) {
      console.error('Sign in failed', error);
      const message = error instanceof FirebaseError ? authMessage(error) : (error as Error).message;
      setAuthFeedback(message);
    }
  };

  const handleSignUp = async (values: SignUpValues) => {
    if (!auth || !db) return;
    setAuthFeedback(null);
    try {
      const providedUsername = values.username?.trim() ?? '';
      const providedEmail = values.email?.trim().toLowerCase() ?? '';

      if (!providedUsername && !providedEmail) {
        signUpForm.setError('username', { message: copy.errors.credentialsRequired });
        signUpForm.setError('email', { message: copy.errors.credentialsRequired });
        return;
      }

      let username = providedUsername ? sanitizeUsername(providedUsername) : '';
      if (!username && providedEmail) {
        username = sanitizeUsername(providedEmail.split('@')[0]);
      }

      if (!username || !isUsernameValid(username)) {
        signUpForm.setError('username', { message: copy.errors.usernameInvalid });
        return;
      }

      const available = await isUsernameAvailable(db, username);
      if (!available) {
        signUpForm.setError(providedUsername ? 'username' : 'email', { message: copy.errors.usernameTaken });
        return;
      }

      const emailForFirebase = providedEmail || `${username.toLowerCase()}@wordmates.app`;

      const credential = await createUserWithEmailAndPassword(auth, emailForFirebase, values.password);
      await upsertProfile(db, credential.user.uid, {
        username,
        authProvider: 'password',
        email: emailForFirebase,
        photoURL: credential.user.photoURL ?? null,
        preferences: DEFAULT_PREFERENCES,
      });
      toast(copy.toasts.signUp);
      setActiveTab('signin');
    } catch (error) {
      console.error('Sign up failed', error);
      const message = error instanceof FirebaseError ? authMessage(error) : copy.errors.credentialsRequired;
      setAuthFeedback(message);
    }
  };

  const handleUsernameComplete = async (values: UsernameValues) => {
    if (!auth || !db || !auth.currentUser) return;
    try {
      const username = sanitizeUsername(values.username);
      const available = await isUsernameAvailable(db, username, auth.currentUser.uid);
      if (!available) {
        usernameForm.setError('username', { message: copy.errors.usernameTaken });
        return;
      }
      await upsertProfile(db, auth.currentUser.uid, {
        username,
        authProvider: pendingProvider,
        email: pendingMeta?.email ?? auth.currentUser.email,
        photoURL: pendingMeta?.photoURL ?? auth.currentUser.photoURL ?? null,
        preferences: DEFAULT_PREFERENCES,
      });
      toast(copy.toasts.usernameSaved(username));
      resetUsernameDialog();
    } catch (error) {
      console.error('Failed to save username', error);
      usernameForm.setError('username', { message: copy.errors.usernameSaveFailed });
    }
  };

  const cycleGuestName = () => {
    setGuestName(generateGuestHandle());
    setGuestError(null);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-[#1a0800] via-[#050301] to-[#120400] text-white font-moms">
      <OrangePulseBackdrop />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-start gap-12 px-4 pb-12 pt-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex w-full flex-col items-center gap-6 text-center"
        >
          <div className="relative h-24 w-72 sm:h-28 sm:w-80">
            <Image
              src="/logo.png"
              alt="WordMates"
              fill
              priority
              sizes="(max-width: 640px) 70vw, 320px"
              className="object-contain"
            />
          </div>
        </motion.div>

        <div className="w-full max-w-3xl rounded-[36px] border border-white/20 bg-white/10 p-1 shadow-[0_35px_120px_rgba(0,0,0,0.45)] backdrop-blur-3xl">
          <div className="rounded-[32px] border border-white/25 bg-white/5 p-6 text-white shadow-inner shadow-black/30 sm:p-10">
            {user && profile?.username && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
              >
                <p>{`Already signed in as ${profile.username}. Redirecting to home…`}</p>
              </motion.div>
            )}

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
              <TabsList className="relative grid w-full grid-cols-3 gap-0 rounded-full border border-[#ff945a]/40 bg-gradient-to-r from-[#3b1c0f] via-[#1c0d06] to-[#3b1c0f] p-1 text-sm font-semibold uppercase tracking-wide shadow-[inset_0_6px_18px_rgba(0,0,0,0.45)]">
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-1 rounded-full border border-white/15 bg-gradient-to-r from-[#ff7a1a] via-[#ff5300] to-[#1b0902] shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
                  style={{ width: indicatorWidth }}
                  animate={{ left: indicatorOffset }}
                  initial={false}
                  transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                />
                {tabOrder.map((tab) => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className={cn(
                      'relative z-10 rounded-full px-3 py-2 text-[0.7rem] font-black tracking-[0.35em] transition-colors',
                      'bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=inactive]:bg-transparent data-[state=inactive]:text-white/60'
                    )}
                  >
                    <span className="relative block">{copy.tabs[tab]}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <motion.div
                layout
                transition={{ type: 'spring', stiffness: 240, damping: 34 }}
                className="mt-6 space-y-0"
              >
                <TabsContent value="signin" className="mt-0 focus-visible:outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <Form {...signInForm}>
                      <form className="space-y-4" onSubmit={signInForm.handleSubmit(handleSignIn)}>
                        <FormField
                          control={signInForm.control}
                          name="identifier"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{copy.labels.identifier}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  autoComplete="username"
                                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-5 text-base text-white placeholder:text-white/40"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signInForm.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{copy.labels.password}</FormLabel>
                              <FormControl>
                                <Input
                                  type="password"
                                  autoComplete="current-password"
                                  {...field}
                                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-5 text-base text-white placeholder:text-white/40"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" className="w-full rounded-2xl bg-white/90 py-5 text-base font-semibold text-slate-900 hover:bg-white">
                          {copy.buttons.signIn}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full rounded-2xl border-white/30 bg-transparent py-5 text-base font-semibold text-white hover:bg-white/10"
                          onClick={handleGoogleLogin}
                          disabled={googleLoading}
                        >
                          {googleLoading ? (
                            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                          ) : (
                            <GoogleIcon className="mr-3 h-5 w-5" />
                          )}
                          {copy.buttons.google}
                        </Button>
                      </form>
                    </Form>
                  </motion.div>
                </TabsContent>

                <TabsContent value="signup" className="mt-0 focus-visible:outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <Form {...signUpForm}>
                      <form className="space-y-4" onSubmit={signUpForm.handleSubmit(handleSignUp)}>
                        <FormField
                          control={signUpForm.control}
                          name="username"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{copy.labels.username}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  autoComplete="username"
                                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-5 text-base text-white placeholder:text-white/40"
                                />
                              </FormControl>
                              {copy.helper.username && <p className="text-xs text-white/60">{copy.helper.username}</p>}
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signUpForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{copy.labels.email}</FormLabel>
                              <FormControl>
                                <Input
                                  type="email"
                                  autoComplete="email"
                                  {...field}
                                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-5 text-base text-white placeholder:text-white/40"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signUpForm.control}
                          name="password"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{copy.labels.password}</FormLabel>
                              <FormControl>
                                <Input
                                  type="password"
                                  autoComplete="new-password"
                                  {...field}
                                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-5 text-base text-white placeholder:text-white/40"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={signUpForm.control}
                          name="confirmPassword"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{copy.labels.confirmPassword}</FormLabel>
                              <FormControl>
                                <Input
                                  type="password"
                                  autoComplete="new-password"
                                  {...field}
                                  className="rounded-2xl border border-white/20 bg-white/10 px-4 py-5 text-base text-white placeholder:text-white/40"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" className="w-full rounded-2xl bg-white/90 py-5 text-base font-semibold text-slate-900 hover:bg-white">
                          {copy.buttons.signUp}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full rounded-2xl border-white/30 bg-transparent py-5 text-base font-semibold text-white hover:bg-white/10"
                          onClick={handleGoogleLogin}
                          disabled={googleLoading}
                        >
                          {googleLoading ? (
                            <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                          ) : (
                            <GoogleIcon className="mr-3 h-5 w-5" />
                          )}
                          {copy.buttons.google}
                        </Button>
                      </form>
                    </Form>
                  </motion.div>
                </TabsContent>

                <TabsContent value="guest" className="mt-0 focus-visible:outline-none">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <div className="space-y-4">
                      <Label htmlFor="guest-handle" className="text-sm text-white/70">
                        {copy.labels.guestHandle}
                      </Label>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Input
                          id="guest-handle"
                          value={guestName}
                          onChange={(event) => {
                            setGuestName(event.target.value);
                            setGuestError(null);
                          }}
                          className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-5 text-base text-white"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-2xl border-white/30 bg-transparent px-4 py-5 text-white hover:bg-white/10"
                          onClick={cycleGuestName}
                        >
                          <RefreshCcw className="mr-2 h-4 w-4" />
                          {copy.buttons.random}
                        </Button>
                      </div>
                      {copy.helper.guest && <p className="text-xs text-white/50">{copy.helper.guest}</p>}
                      {guestError && <p className="text-sm text-rose-300">{guestError}</p>}
                      <Button
                        type="button"
                        className="w-full rounded-2xl bg-white/90 py-5 text-base font-semibold text-slate-900 hover:bg-white"
                        onClick={handleGuestEnter}
                        disabled={guestLoading}
                      >
                        {guestLoading ? (
                          <span className="flex items-center justify-center">
                            <Loader2 className="mr-2 h-5 w-5 animate-spin text-slate-900" />
                            Loading…
                          </span>
                        ) : (
                          copy.buttons.guest
                        )}
                      </Button>
                    </div>
                  </motion.div>
                </TabsContent>
              </motion.div>
            </Tabs>

            {authFeedback && <p className="mt-6 text-center text-sm text-rose-200">{authFeedback}</p>}
          </div>
        </div>
      </div>

      <Dialog open={usernameDialogOpen} onOpenChange={(open) => (open ? setUsernameDialogOpen(true) : resetUsernameDialog())}>
        <DialogContent className="font-moms sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.dialog.title}</DialogTitle>
            <DialogDescription>{copy.dialog.description}</DialogDescription>
          </DialogHeader>
          <Form {...usernameForm}>
            <form className="space-y-4" onSubmit={usernameForm.handleSubmit(handleUsernameComplete)}>
              <FormField
                control={usernameForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <div className="flex gap-3">
                        <Input {...field} className="flex-1 rounded-2xl border border-white/20 px-4 py-5" />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => usernameForm.setValue('username', generateGuestHandle())}
                        >
                          {copy.dialog.shuffle}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={resetUsernameDialog}>
                  {copy.dialog.cancel}
                </Button>
                <Button type="submit" className="flex-1">
                  {copy.dialog.confirm}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function authMessage(error: FirebaseError) {
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect credentials. Try again.';
    case 'auth/email-already-in-use':
      return 'An account already exists with that email.';
    case 'auth/weak-password':
      return 'Password needs at least 6 characters.';
    default:
      return error.message;
  }
}

const GoogleIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
    <path
      fill="#fff"
      d="M21.35 11.1H12v2.86h5.33c-.22 1.38-1.6 4.05-5.33 4.05a6.67 6.67 0 1 1 0-13.34 6.2 6.2 0 0 1 4.38 1.72l2.46-2.38A10 10 0 1 0 22 12a8.6 8.6 0 0 0-.65-4.19Z"
    />
  </svg>
);

function OrangePulseBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#401600] via-[#1b0600] to-[#2a0c00] opacity-95" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,155,92,0.35),_transparent_65%)]" />
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-[-35%] h-[120vh] w-[150vw] -translate-x-1/2 opacity-90 blur-[120px]"
        style={{ background: 'radial-gradient(circle at center, rgba(255,190,130,0.85), rgba(10,5,2,0))' }}
        animate={{ scale: [0.95, 1.2, 0.95], y: [-20, 10, -20] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="absolute bottom-[-25%] left-1/3 h-[120vh] w-[140vh] opacity-85 blur-[150px]"
        style={{ background: 'radial-gradient(circle at center, rgba(255,120,64,0.9), rgba(10,5,2,0))' }}
        animate={{ scale: [1.05, 0.9, 1.05], x: [0, 80, 0] }}
        transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-x-0 bottom-[-5%] h-[90vh] opacity-80 blur-[120px]"
        style={{ background: 'radial-gradient(circle at center, rgba(255,94,0,0.75), rgba(10,5,2,0))' }}
        animate={{ scale: [0.85, 1.25, 0.85], y: [0, -30, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
