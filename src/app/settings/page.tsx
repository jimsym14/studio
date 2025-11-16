'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FirebaseError } from 'firebase/app';
import { updateEmail, updatePassword, updateProfile } from 'firebase/auth';
import { ArrowLeft, Sparkles } from 'lucide-react';

import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { isUsernameAvailable, sanitizeUsername, upsertProfile } from '@/lib/profiles';
import { DEFAULT_PREFERENCES, isGuestProfile } from '@/types/user';

const passwordField = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? '');

const urlField = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? '')
  .refine((value) => value.length === 0 || /^https?:\/\//i.test(value), {
    message: 'Enter a valid image URL',
  });

const settingsSchema = z
  .object({
    username: z
      .string()
      .min(3, 'Pick something at least 3 characters long')
      .max(20, 'Keep it under 20 characters'),
    email: z.string().email('Enter a valid email').transform((value) => value.trim()),
    photoURL: urlField,
    newPassword: passwordField,
    confirmPassword: passwordField,
  })
  .superRefine((data, ctx) => {
    if (data.newPassword && data.newPassword.length > 0) {
      if (!data.confirmPassword || data.confirmPassword.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confirmPassword'],
          message: 'Confirm your password',
        });
      } else if (data.newPassword !== data.confirmPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confirmPassword'],
          message: 'Passwords do not match',
        });
      }
    }
  });

type SettingsValues = z.infer<typeof settingsSchema>;

const initials = (value?: string) => {
  if (!value) return 'WM';
  return value
    .split(/\s+/)
    .map((segment) => segment[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
};

export default function SettingsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { auth, db, user, profile } = useFirebase();
  const [isSaving, setIsSaving] = useState(false);

  const defaultValues = useMemo<SettingsValues>(() => ({
    username: profile?.username ?? user?.displayName ?? '',
    email: profile?.email ?? user?.email ?? '',
    photoURL: profile?.photoURL ?? user?.photoURL ?? '',
    newPassword: '',
    confirmPassword: '',
  }), [profile?.email, profile?.photoURL, profile?.username, user?.displayName, user?.email, user?.photoURL]);

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
      return;
    }
    if (profile && isGuestProfile(profile)) {
      router.replace('/');
    }
  }, [profile, router, user]);

  const previewPhoto = form.watch('photoURL') || defaultValues.photoURL;

  const handleSubmit = async (values: SettingsValues) => {
    if (!auth || !db || !user) return;
    setIsSaving(true);
    try {
      const cleanUsername = sanitizeUsername(values.username);
      if (!cleanUsername) {
        form.setError('username', { message: 'Username is required' });
        setIsSaving(false);
        return;
      }

      if (cleanUsername !== (profile?.username ?? '')) {
        const available = await isUsernameAvailable(db, cleanUsername, user.uid);
        if (!available) {
          form.setError('username', { message: 'That handle is already taken.' });
          setIsSaving(false);
          return;
        }
      }

      if (values.email !== user.email) {
        await updateEmail(user, values.email);
      }

      if (values.newPassword) {
        await updatePassword(user, values.newPassword);
      }

      const resolvedPhoto = values.photoURL || null;

      await updateProfile(user, {
        displayName: cleanUsername,
        photoURL: resolvedPhoto,
      });

      await upsertProfile(db, user.uid, {
        username: cleanUsername,
        authProvider: profile?.authProvider ?? 'password',
        email: values.email,
        photoURL: resolvedPhoto,
        avatarSeed: profile?.avatarSeed ?? cleanUsername,
        preferences: profile?.preferences ?? DEFAULT_PREFERENCES,
      });

      toast({
        title: 'Profile updated',
        description: 'Your changes have been saved.',
      });
      router.push('/');
    } catch (error) {
      console.error('Failed to update profile', error);
      const friendlyMessage =
        error instanceof FirebaseError && error.code === 'auth/requires-recent-login'
          ? 'Please reauthenticate and try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to save changes right now.';
      toast({ variant: 'destructive', title: 'Update failed', description: friendlyMessage });
    } finally {
      setIsSaving(false);
    }
  };

  const heading = profile ? `Hi ${profile.username}, make it yours` : 'Update your profile';

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#0c0401] via-[#120601] to-[#1e0900] px-4 py-12 text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="rounded-full border border-white/20 text-white" onClick={() => router.push('/') }>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back home
          </Button>
          <Sparkles className="h-5 w-5 text-orange-200" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="overflow-hidden rounded-[40px] border border-white/10 bg-white/5 p-6 shadow-[0_40px_140px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
        >
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <h1 className="text-3xl font-black uppercase tracking-[0.3em]">{heading}</h1>
              <p className="mt-2 text-sm text-white/70">Update your handle, contact info, and security details all in one place.</p>

              <Form {...form}>
                <form className="mt-6 space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input {...field} className="rounded-2xl border-white/30 bg-white/10 px-4 py-5 text-white placeholder:text-white/50" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} className="rounded-2xl border-white/30 bg-white/10 px-4 py-5 text-white placeholder:text-white/50" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="photoURL"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Profile image URL</FormLabel>
                        <FormControl>
                          <Input {...field} className="rounded-2xl border-white/30 bg-white/10 px-4 py-5 text-white placeholder:text-white/50" placeholder="https://" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="newPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>New password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} className="rounded-2xl border-white/30 bg-white/10 px-4 py-5 text-white placeholder:text-white/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} className="rounded-2xl border-white/30 bg-white/10 px-4 py-5 text-white placeholder:text-white/50" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Button type="submit" className="w-full rounded-2xl bg-white/90 py-5 text-base font-semibold uppercase tracking-[0.3em] text-slate-900 hover:bg-white" disabled={isSaving}>
                    {isSaving ? 'Saving…' : 'Save profile'}
                  </Button>
                </form>
              </Form>
            </div>

            <div className="rounded-[32px] border border-white/15 bg-white/5 p-5 text-center shadow-inner shadow-black/30">
              <p className="text-xs uppercase tracking-[0.4em] text-white/60">Preview</p>
              <Avatar className="mx-auto mt-4 h-28 w-28 rounded-[30px] border-4 border-white/30">
                <AvatarImage src={previewPhoto || undefined} alt={defaultValues.username} />
                <AvatarFallback>{initials(defaultValues.username)}</AvatarFallback>
              </Avatar>
              <div className="mt-4 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-left">
                <p className="text-sm font-semibold">{form.watch('username') || defaultValues.username || 'Your handle'}</p>
                <p className="text-xs text-white/65">{form.watch('email') || defaultValues.email || 'email@wordmates.app'}</p>
              </div>
              <p className="mt-4 text-xs text-white/60">
                Tip: use a square image URL for the cleanest avatar.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
