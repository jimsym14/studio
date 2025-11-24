"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { FriendsModal } from "@/components/friends-modal";
import { useFirebase } from "@/components/firebase-provider";
import { useRealtime } from "@/components/realtime-provider";
import { isGuestProfile } from "@/types/user";
import { useToast } from "@/hooks/use-toast";
import { socialGet } from "@/lib/social-client";
import type { FriendRequestSummary } from "@/types/social";
import type { FriendRealtimeEvent } from "@/types/realtime";

import { useUnreadChats } from "@/hooks/use-unread-chats";

export type FriendsModalContextValue = {
  openFriendsModal: () => void;
  setFriendsModalOpen: (open: boolean) => void;
  isFriendsModalOpen: boolean;
  pendingRequestCount: number;
  unreadChatCount: number;
  unreadChatIds: Set<string>;
  refreshPendingRequests: () => Promise<void>;
  setOnOpenInviteSettings: (callback: (friendId: string, username: string, passcode: string) => void) => void;
};

const FriendsModalContext = createContext<FriendsModalContextValue | undefined>(undefined);

export function FriendsModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user, profile } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();
  const guest = profile ? isGuestProfile(profile) : false;
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const { totalUnread: unreadChatCount, unreadChatIds } = useUnreadChats();
  const canUseFriends = Boolean(user) && !guest;
  const { socket } = useRealtime();
  const [inviteSettingsCallback, setInviteSettingsCallback] = useState<((friendId: string, username: string, passcode: string) => void) | null>(null);

  const openFriendsModal = useCallback(() => {
    if (!user) {
      router.push("/login");
      return;
    }
    if (guest) {
      toast({
        title: "Sign in to use friends",
        description: "Only registered players can send requests and keep persistent chats.",
      });
      return;
    }
    setOpen(true);
  }, [guest, router, toast, user]);

  const refreshPendingRequests = useCallback(async () => {
    if (!canUseFriends) {
      setPendingRequestCount(0);
      return;
    }
    try {
      const response = await socialGet<{ requests: FriendRequestSummary[] }>(
        "/api/friends/requests?direction=incoming"
      );
      const pending = response.requests?.filter((request) => request.status === "pending").length ?? 0;
      setPendingRequestCount(pending);
    } catch (error) {
      console.warn("Failed to refresh pending friend requests", error);
    }
  }, [canUseFriends]);

  const setOnOpenInviteSettings = useCallback((callback: (friendId: string, username: string, passcode: string) => void) => {
    setInviteSettingsCallback(() => callback);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshPendingRequests();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshPendingRequests]);

  useEffect(() => {
    if (!socket) return;
    const handleFriendEvent = (event: FriendRealtimeEvent) => {
      if (event.kind === "pending-requests" || event.kind === "friends-list") {
        void refreshPendingRequests();
      }
    };
    socket.on("friends:event", handleFriendEvent);
    return () => {
      socket.off("friends:event", handleFriendEvent);
    };
  }, [socket, refreshPendingRequests]);

  const value = useMemo(
    () => ({
      openFriendsModal,
      setFriendsModalOpen: setOpen,
      isFriendsModalOpen: open,
      pendingRequestCount,
      unreadChatCount,
      unreadChatIds,
      refreshPendingRequests,
      setOnOpenInviteSettings,
    }),
    [open, openFriendsModal, pendingRequestCount, unreadChatCount, unreadChatIds, refreshPendingRequests, setOnOpenInviteSettings]
  );

  return (
    <FriendsModalContext.Provider value={value}>
      {children}
      <FriendsModal
        open={open}
        onOpenChange={setOpen}
        onPendingCountChange={setPendingRequestCount}
        refreshPendingRequests={refreshPendingRequests}
        unreadChatIds={unreadChatIds}
        onOpenInviteSettings={inviteSettingsCallback || undefined}
      />
    </FriendsModalContext.Provider>
  );
}

export function useFriendsModal() {
  const context = useContext(FriendsModalContext);
  if (!context) {
    throw new Error("useFriendsModal must be used within a FriendsModalProvider");
  }
  return context;
}
