"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useRealtime } from "@/components/realtime-provider";
import { useFirebase } from "@/components/firebase-provider";
import { isGuestProfile } from "@/types/user";
import type { NotificationItem } from "@/types/social";
import type { NotificationRealtimeEvent } from "@/types/realtime";
import { socialGet, socialPost, SocialClientError } from "@/lib/social-client";
import { useToast } from "@/hooks/use-toast";

const MAX_CACHED_NOTIFICATIONS = 100;

type NotificationsContextValue = {
  notifications: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: (ids: string[]) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

const normalizeNotification = (input: NotificationItem): NotificationItem => ({
  id: input.id,
  type: input.type,
  payload: input.payload ?? null,
  createdAt: input.createdAt ?? null,
  read: Boolean(input.read),
});

const describeNotification = (notification: NotificationItem) => {
  const payload = (notification.payload ?? {}) as Record<string, unknown>;
  const actor = typeof payload.by === "string" ? payload.by : typeof payload.from === "string" ? payload.from : "A player";

  switch (notification.type) {
    case "friend-request":
      return {
        title: "New friend request",
        description: `${actor} wants to connect with you.`,
      };
    case "friend-accept":
      return {
        title: "Friend request accepted",
        description: `${actor} is now on your friends list.`,
      };
    case "chat-entry":
      return {
        title: "Player joined the chat",
        description: `${actor} opened one of your chats.`,
      };
    default:
      return null;
  }
};

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useFirebase();
  const { socket } = useRealtime();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const canUseNotifications = Boolean(user) && profile ? !isGuestProfile(profile) : false;

  const refreshNotifications = useCallback(async () => {
    if (!canUseNotifications) {
      setNotifications([]);
      return;
    }
    setIsLoading(true);
    try {
      const response = await socialGet<{ notifications: NotificationItem[] }>("/api/notifications");
      const normalized = (response.notifications ?? []).map(normalizeNotification);
      setNotifications(normalized);
    } catch (error) {
      const message = error instanceof SocialClientError ? error.message : "Unable to load notifications";
      console.warn(message, error);
    } finally {
      setIsLoading(false);
    }
  }, [canUseNotifications]);

  useEffect(() => {
    if (!canUseNotifications) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }
    void refreshNotifications();
  }, [canUseNotifications, refreshNotifications]);

  const showToastForNotification = useCallback(
    (notification: NotificationItem) => {
      const summary = describeNotification(notification);
      if (!summary) return;
      toast({
        title: summary.title,
        description: summary.description,
      });
    },
    [toast]
  );

  useEffect(() => {
    if (!socket || !canUseNotifications) return;
    const handleNotification = (event: NotificationRealtimeEvent) => {
      if (event.kind !== "created") return;
      const notification = normalizeNotification(event.notification);
      setNotifications((previous) => {
        if (previous.some((entry) => entry.id === notification.id)) {
          return previous;
        }
        const next = [notification, ...previous];
        if (next.length > MAX_CACHED_NOTIFICATIONS) {
          next.length = MAX_CACHED_NOTIFICATIONS;
        }
        return next;
      });
      showToastForNotification(notification);
    };
    socket.on("notifications:event", handleNotification);
    return () => {
      socket.off("notifications:event", handleNotification);
    };
  }, [socket, canUseNotifications, showToastForNotification]);

  const markNotificationsRead = useCallback(async (ids: string[]) => {
    if (!canUseNotifications || !ids.length) return;
    const uniqueIds = Array.from(new Set(ids));
    setNotifications((previous) =>
      previous.map((notification) =>
        uniqueIds.includes(notification.id) ? { ...notification, read: true } : notification
      )
    );
    try {
      await socialPost("/api/notifications/mark-read", { ids: uniqueIds });
    } catch (error) {
      console.warn("Failed to mark notifications read", error);
    }
  }, [canUseNotifications]);

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.read).length, [notifications]);

  const value = useMemo<NotificationsContextValue>(
    () => ({ notifications, unreadCount, isLoading, refreshNotifications, markNotificationsRead }),
    [notifications, unreadCount, isLoading, refreshNotifications, markNotificationsRead]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export const useNotifications = () => {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return context;
};
