"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { format } from "date-fns";
import { MessageCircle, Reply, SendHorizonal, X } from "lucide-react";

import type { ChatAvailability, ChatContextDescriptor } from "@/types/social";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useChatRoom, type ChatMessage } from "@/hooks/use-chat-room";
import { useFirebase } from "@/components/firebase-provider";
import { useRealtime } from "@/components/realtime-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { socialPost } from "@/lib/social-client";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useTheme } from "next-themes";

export type ChatParticipantSummary = {
  id: string;
  displayName: string;
  photoURL?: string | null;
  emoji?: string;
  isSelf?: boolean;
};

export type ChatDockProps = {
  context: ChatContextDescriptor;
  availability: ChatAvailability;
  participantCount?: number;
  participants?: ChatParticipantSummary[];
  unreadCount?: number;
  onComposerFocusChange?: (focused: boolean) => void;
};

const avatarGradients = [
  "from-[#ff758c] to-[#ff7eb3]",
  "from-[#43e97b] to-[#38f9d7]",
  "from-[#fa709a] to-[#fee140]",
  "from-[#30cfd0] to-[#330867]",
  "from-[#a18cd1] to-[#fbc2eb]",
  "from-[#f6d365] to-[#fda085]",
];

const fallbackEmojis = ["⚡️", "🔥", "🌟", "🎯", "🚀", "🎉"];

type BubblePosition = {
  x: number;
  y: number;
};

const defaultBubblePosition: BubblePosition = { x: 0, y: 0 };

const deriveContextStorageKey = (descriptor: ChatContextDescriptor) => {
  if (descriptor.scope === "game") {
    return `game:${descriptor.gameId ?? "unknown"}`;
  }
  if (descriptor.scope === "lobby") {
    return `lobby:${descriptor.lobbyId ?? "unknown"}`;
  }
  return `friend:${descriptor.friendshipId ?? descriptor.friendUserId ?? "unknown"}`;
};

const formatMessageTime = (value?: Date | null) => {
  if (!value) return "now";
  try {
    return format(value, "h:mm a");
  } catch {
    return "now";
  }
};

const trimPreview = (text: string, length = 120) => {
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trimEnd()}…`;
};

export function ChatDock({
  context,
  availability,
  participantCount,
  participants,
  unreadCount = 0,
  onComposerFocusChange,
}: ChatDockProps) {
  const { toast } = useToast();
  const { userId } = useFirebase();
  const { connected: realtimeConnected } = useRealtime();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const presenceActionRef = useRef<"enter" | "leave">("leave");
  const composerFocusRef = useRef(false);
  const contextStorageKey = useMemo(() => deriveContextStorageKey(context), [context]);
  const [storedBubblePosition, setStoredBubblePosition] = useLocalStorage<BubblePosition>(
    `chatdock:${contextStorageKey}`,
    defaultBubblePosition
  );
  const [dragOverridePosition, setDragOverridePosition] = useState<BubblePosition | null>(null);
  const dragStateRef = useRef<
    | {
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    }
    | null
  >(null);
  const suppressToggleRef = useRef(false);

  const clampPosition = useCallback((next: BubblePosition) => {
    if (typeof window === "undefined") return next;
    const padding = 16;
    const maxX = window.innerWidth - 80; // approximate width of bubble
    const maxY = window.innerHeight - 80; // approximate height of bubble

    // We want to keep it within the screen bounds with some padding
    // The bubble is positioned from bottom-right, so coordinates are negative-ish or relative
    // Actually the current implementation uses transform translate from a fixed bottom-right position.
    // Let's adjust to be more robust.

    // Current implementation: bottom-6 right-5 (approx 24px, 20px)
    // Translate (0,0) is at that anchor.
    // Negative X moves left, Negative Y moves up.

    const maxTranslateX = 20; // Can go a bit right
    const minTranslateX = -(window.innerWidth - 100); // Can go all the way left

    const maxTranslateY = 20; // Can go a bit down
    const minTranslateY = -(window.innerHeight - 150); // Can go all the way up

    return {
      x: Math.min(maxTranslateX, Math.max(minTranslateX, next.x)),
      y: Math.min(maxTranslateY, Math.max(minTranslateY, next.y)),
    };
  }, []);

  const baseBubblePosition = useMemo(
    () => clampPosition(storedBubblePosition),
    [clampPosition, storedBubblePosition]
  );
  const liveBubblePosition = dragOverridePosition ?? baseBubblePosition;
  const livePositionRef = useRef<BubblePosition>(liveBubblePosition);

  useEffect(() => {
    livePositionRef.current = liveBubblePosition;
  }, [liveBubblePosition]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleResize = () => {
      const current = livePositionRef.current;
      const clamped = clampPosition(current);
      if (clamped.x === current.x && clamped.y === current.y) {
        return;
      }
      livePositionRef.current = clamped;
      setStoredBubblePosition(clamped);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampPosition, setStoredBubblePosition]);

  const derivedParticipantCount = participants?.length ?? participantCount ?? (availability === "persistent" ? 2 : 0);
  const readyToChat = derivedParticipantCount >= 2;

  const {
    ready,
    status,
    messages,
    lastMessageAt,
    sendMessage,
    sending,
    error,
    chatId,
    readReceipts,
    membership,
    refreshMessages,
    markMessagesRead,
    typingUsers,
    sendTyping,
  } =
    useChatRoom({
      context,
      enabled: readyToChat,
    });

  const decoratedParticipants = useMemo<ChatParticipantSummary[]>(() => {
    if (participants?.length) {
      return participants.map((entry, index) => ({
        ...entry,
        emoji: entry.emoji ?? fallbackEmojis[index % fallbackEmojis.length],
        isSelf: entry.isSelf ?? entry.id === userId,
      }));
    }

    const base: ChatParticipantSummary[] = [];
    if (userId) {
      base.push({ id: userId, displayName: "You", isSelf: true });
    }

    if (context.scope === "friend") {
      base.push({
        id: context.friendUserId,
        displayName: context.friendDisplayName ?? "Friend",
      });
    } else {
      base.push({ id: "opponent", displayName: "Player" });
    }

    return base.map((entry, index) => ({
      ...entry,
      emoji: entry.emoji ?? fallbackEmojis[index % fallbackEmojis.length],
    }));
  }, [context, participants, userId]);

  const participantLookup = useMemo(() => {
    const lookup: Record<string, (typeof decoratedParticipants)[number]> = {};
    decoratedParticipants.forEach((entry) => {
      lookup[entry.id] = entry;
    });
    return lookup;
  }, [decoratedParticipants]);

  const opponent = useMemo(
    () => decoratedParticipants.find((entry) => !entry.isSelf) ?? decoratedParticipants[0],
    [decoratedParticipants]
  );
  const partnerDisplayName = opponent?.displayName ?? "Player";

  const lastOutgoingMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate?.senderId === userId) {
        return candidate;
      }
    }
    return null;
  }, [messages, userId]);
  const latestMessage = messages.length ? messages[messages.length - 1] : null;

  const selfReadAt = membership?.lastReadAt?.getTime?.() ?? 0;
  const opponentReadAt = opponent?.id ? readReceipts[opponent.id]?.getTime?.() ?? undefined : undefined;
  const lastOutgoingSentAt = lastOutgoingMessage?.sentAt ? new Date(lastOutgoingMessage.sentAt).getTime() : undefined;

  const readReceipt =
    lastOutgoingMessage && lastOutgoingSentAt && opponentReadAt
      ? opponentReadAt >= lastOutgoingSentAt
        ? "Read"
        : "Delivered"
      : null;

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const syncPresence = useCallback(
    async (action: "enter" | "leave", options?: { refresh?: boolean }) => {
      if (!chatId) return;
      presenceActionRef.current = action;
      try {
        await socialPost("/api/chats/enter", { chatId, action });
        if (action === "enter" && options?.refresh) {
          await refreshMessages();
        }
      } catch (presenceError) {
        console.error("Failed to record chat entry", presenceError);
      }
    },
    [chatId, refreshMessages]
  );

  useEffect(() => {
    if (!chatId || !ready) return;
    const desired = open ? "enter" : "leave";
    if (presenceActionRef.current === desired) return;
    void syncPresence(desired);
  }, [chatId, open, ready, syncPresence]);

  useEffect(() => {
    if (!open || !chatId || !ready) return;
    void syncPresence("enter");
  }, [chatId, messages, open, ready, syncPresence]);

  useEffect(() => {
    return () => {
      if (presenceActionRef.current === "enter" && chatId) {
        void syncPresence("leave");
      }
    };
  }, [chatId, syncPresence]);

  // Handle typing indicator
  useEffect(() => {
    if (!message || !ready) {
      return;
    }
    sendTyping(true);
    const timeout = setTimeout(() => sendTyping(false), 3000);
    return () => clearTimeout(timeout);
  }, [message, ready, sendTyping]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || !ready || availability === "guest-blocked") return;
    try {
      sendTyping(false);
      await sendMessage(message.trim(), { replyTo: replyTarget });
      setMessage("");
      setReplyTarget(null);
    } catch (sendError) {
      toast({
        variant: "destructive",
        title: "Message not sent",
        description:
          sendError instanceof Error ? sendError.message : "We couldn't deliver that message. Try again shortly.",
      });
    }
  }, [availability, message, ready, replyTarget, sendMessage, toast]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const notifyComposerFocus = useCallback(
    (focused: boolean) => {
      composerFocusRef.current = focused;
      onComposerFocusChange?.(focused);
    },
    [onComposerFocusChange]
  );

  useEffect(() => {
    return () => {
      if (composerFocusRef.current) {
        notifyComposerFocus(false);
      }
    };
  }, [notifyComposerFocus]);

  const processDragMove = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      const dragState = dragStateRef.current;
      if (!dragState || pointerId !== dragState.pointerId) return;
      const deltaX = clientX - dragState.startX;
      const deltaY = clientY - dragState.startY;
      if (!dragState.moved) {
        const thresholdExceeded = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
        if (!thresholdExceeded) return;
        dragState.moved = true;
      }
      const next = clampPosition({ x: dragState.originX + deltaX, y: dragState.originY + deltaY });
      livePositionRef.current = next;
      setDragOverridePosition(next);
    },
    [clampPosition]
  );

  const finalizeDrag = useCallback(
    (pointerId: number, options?: { cancelled?: boolean }) => {
      const dragState = dragStateRef.current;
      if (!dragState || pointerId !== dragState.pointerId) return;
      dragStateRef.current = null;
      const moved = dragState.moved;
      if (moved) {
        const finalPosition = clampPosition(livePositionRef.current);
        livePositionRef.current = finalPosition;
        setStoredBubblePosition(finalPosition);
      }
      setDragOverridePosition(null);
      if (moved && !options?.cancelled) {
        suppressToggleRef.current = true;
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            suppressToggleRef.current = false;
          }, 0);
        }
      }
    },
    [clampPosition, setStoredBubblePosition]
  );

  useEffect(() => {
    if (!open || !ready) return;
    void refreshMessages();
  }, [open, ready, refreshMessages]);

  useEffect(() => {
    if (!open || !ready || !chatId) return;
    if (realtimeConnected) return;
    const interval = window.setInterval(() => {
      void refreshMessages();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [chatId, open, ready, realtimeConnected, refreshMessages]);

  useEffect(() => {
    if (!open || !ready || !latestMessage) return;
    if (!latestMessage.sentAt || latestMessage.senderId === userId) return;
    const messageTime = new Date(latestMessage.sentAt).getTime();
    if (!Number.isFinite(messageTime)) return;
    if (messageTime <= selfReadAt) return;
    markMessagesRead({ lastSeenAt: latestMessage.sentAt });
  }, [open, ready, latestMessage, markMessagesRead, selfReadAt, userId]);

  const handleBubblePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const pointerType = event.pointerType ?? "mouse";
      if ((pointerType === "mouse" || pointerType === "pen") && event.button !== 0) return;
      event.preventDefault();
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: livePositionRef.current.x,
        originY: livePositionRef.current.y,
        moved: false,
      };
      if (event.currentTarget.setPointerCapture) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Ignore failures when pointer capture isn't supported.
        }
      }
    },
    []
  );

  const handleBubblePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragStateRef.current || event.pointerId !== dragStateRef.current.pointerId) return;
      event.preventDefault();
      processDragMove(event.clientX, event.clientY, event.pointerId);
    },
    [processDragMove]
  );

  const handleBubblePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      if (dragState.moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.currentTarget.releasePointerCapture) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore release errors.
        }
      }
      finalizeDrag(event.pointerId);
    },
    [finalizeDrag]
  );

  const handleBubblePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragStateRef.current || event.pointerId !== dragStateRef.current.pointerId) return;
      if (event.currentTarget.releasePointerCapture) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore release errors.
        }
      }
      finalizeDrag(event.pointerId, { cancelled: true });
    },
    [finalizeDrag]
  );

  const handleToggle = useCallback(() => {
    if (suppressToggleRef.current) {
      suppressToggleRef.current = false;
      return;
    }
    setOpen((previous) => !previous);
  }, []);

  const computedUnread = useMemo(() => {
    if (!messages.length) return 0;
    return messages.reduce((total, entry) => {
      if (entry.senderId === userId || !entry.sentAt) return total;
      const sentAt = new Date(entry.sentAt).getTime();
      if (!Number.isFinite(sentAt)) return total;
      return sentAt > selfReadAt ? total + 1 : total;
    }, 0);
  }, [messages, selfReadAt, userId]);

  const totalUnread = Math.max(unreadCount, computedUnread);
  const derivedUnread = !open && totalUnread > 0;
  const showUnreadBadge = totalUnread > 0;
  const headerStatus = (() => {
    if (!readyToChat) return "Waiting for players";
    if (status === "loading") return "Connecting…";
    if (!ready) return "Preparing chat…";
    if (error) return error;
    if (typingUsers.length > 0) {
      const names = typingUsers.map((id: string) => participantLookup[id]?.displayName ?? "Player").join(", ");
      return `${names} is typing...`;
    }
    if (lastMessageAt) return `Last message at ${formatMessageTime(lastMessageAt)}`;
    return "Connected";
  })();

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <AnimatePresence>
        {readyToChat && (
          <motion.div
            key="chat-dock"
            className="pointer-events-none absolute bottom-6 right-5 sm:bottom-8 sm:right-8"
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            style={{ transform: `translate3d(${liveBubblePosition.x}px, ${liveBubblePosition.y}px, 0)` }}
          >
            <div className="pointer-events-auto flex flex-col items-end gap-3">
              <AnimatePresence>
                {open && (
                  <motion.div
                    key="chat-panel"
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="w-[min(420px,calc(100vw-3rem))] rounded-[28px] border border-white/10 bg-gradient-to-b from-[#0c0f19]/95 via-[#0c0f19]/90 to-[#0c0f19]/85 p-5 text-white shadow-[0_45px_120px_rgba(0,0,0,0.5)] backdrop-blur-2xl dark:from-[#0c0f19]/95 dark:via-[#0c0f19]/90 dark:to-[#0c0f19]/85 light:from-white/95 light:via-white/90 light:to-white/85 light:text-black light:border-black/10"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[0.65rem] uppercase tracking-[0.4em] text-white/60 light:text-black/60">Chat with</p>
                        <p className="text-xl font-semibold leading-tight text-white light:text-black">{partnerDisplayName}</p>
                        <p className="mt-1 text-xs text-white/65 light:text-black/65">{headerStatus}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {decoratedParticipants.slice(0, 2).map((participant: ChatParticipantSummary, index) => {
                          const gradient = avatarGradients[index % avatarGradients.length];
                          const fallbackInitial = participant.displayName?.[0]?.toUpperCase() ?? "?";
                          return (
                            <div key={participant.id} className="flex flex-col items-center text-[0.6rem] uppercase tracking-[0.25em] text-white/60 light:text-black/60">
                              <Avatar className="h-11 w-11 border border-white/20 bg-gradient-to-br text-base font-semibold light:border-black/10">
                                {participant.photoURL ? (
                                  <AvatarImage src={participant.photoURL} alt={participant.displayName} />
                                ) : (
                                  <AvatarFallback className={cn("bg-gradient-to-br text-white", gradient)}>
                                    {fallbackInitial}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <span className="mt-1 text-[0.55rem] text-white/50 light:text-black/50">
                                {participant.isSelf
                                  ? "YOU"
                                  : participant.displayName?.toUpperCase() ?? "PLAYER"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-5 max-h-72 space-y-3 overflow-y-auto pr-1" ref={scrollRef}>
                      <LayoutGroup>
                        <AnimatePresence initial={false}>
                          {messages.map((entry: ChatMessage) => {
                            const isSelf = entry.senderId === userId || participantLookup[entry.senderId]?.isSelf;
                            const participant = participantLookup[entry.senderId];
                            const bubbleColors = isSelf
                              ? "bg-gradient-to-r from-[#1f8ef1] to-[#5e72e4] text-white"
                              : "bg-white/10 text-white light:bg-black/5 light:text-black";
                            return (
                              <motion.div
                                key={entry.id}
                                layout
                                initial={{ opacity: 0, y: 25, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.9 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                                className={cn("flex gap-3", isSelf ? "justify-end" : "justify-start")}
                                onMouseEnter={() => setHoveredMessageId(entry.id)}
                                onMouseLeave={() => setHoveredMessageId((prev) => (prev === entry.id ? null : prev))}
                              >
                                {!isSelf && (
                                  <Avatar className="h-9 w-9 border border-white/15 light:border-black/10">
                                    {participant?.photoURL ? (
                                      <AvatarImage src={participant.photoURL} alt={participant?.displayName ?? "Player"} />
                                    ) : (
                                      <AvatarFallback className="bg-white/10 text-white light:bg-black/5 light:text-black">
                                        {participant?.displayName?.[0]?.toUpperCase() ?? "?"}
                                      </AvatarFallback>
                                    )}
                                  </Avatar>
                                )}
                                <div className="relative flex max-w-[260px] flex-col">
                                  <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.35em] text-white/50 light:text-black/50">
                                    <span>{participant?.displayName ?? (isSelf ? "You" : "Player")}</span>
                                    <span>{formatMessageTime(entry.sentAt ? new Date(entry.sentAt) : null)}</span>
                                  </div>
                                  <div
                                    className={cn(
                                      "relative mt-1 rounded-3xl px-4 py-2 text-sm leading-snug shadow-[0_18px_40px_rgba(0,0,0,0.35)]",
                                      bubbleColors
                                    )}
                                  >
                                    {entry.replyTo && (
                                      <motion.div
                                        layout
                                        className="mb-2 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white/80 light:border-black/10 light:bg-black/5 light:text-black/80"
                                      >
                                        <p className="text-[0.6rem] uppercase tracking-[0.35em] text-white/70 light:text-black/70">
                                          Replying to {participantLookup[entry.replyTo.senderId]?.displayName ?? "Player"}
                                        </p>
                                        <p className="line-clamp-2 text-white/90 light:text-black/90">{trimPreview(entry.replyTo.text)}</p>
                                      </motion.div>
                                    )}
                                    <p className="whitespace-pre-line break-words">{entry.text}</p>
                                  </div>
                                  {isSelf && entry.id === lastOutgoingMessage?.id && readReceipt && (
                                    <motion.p
                                      layout
                                      className="mt-1 text-[0.6rem] uppercase tracking-[0.35em] text-white/45 light:text-black/45"
                                    >
                                      {readReceipt}
                                    </motion.p>
                                  )}
                                  <AnimatePresence>
                                    {hoveredMessageId === entry.id && (
                                      <motion.button
                                        type="button"
                                        key="reply"
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: 6 }}
                                        transition={{ duration: 0.15 }}
                                        className="absolute -top-3 h-8 w-8 rounded-full border border-white/20 bg-black/70 text-white"
                                        style={{ right: isSelf ? 0 : undefined, left: !isSelf ? 0 : undefined }}
                                        onClick={() => setReplyTarget(entry)}
                                      >
                                        <Reply className="mx-auto h-4 w-4" />
                                      </motion.button>
                                    )}
                                  </AnimatePresence>
                                </div>
                                {isSelf && (
                                  <Avatar className="h-9 w-9 border border-white/15 light:border-black/10">
                                    {participant?.photoURL ? (
                                      <AvatarImage src={participant.photoURL} alt={participant?.displayName ?? "Player"} />
                                    ) : (
                                      <AvatarFallback className="bg-white/10 text-white light:bg-black/5 light:text-black">
                                        {participant?.displayName?.[0]?.toUpperCase() ?? "?"}
                                      </AvatarFallback>
                                    )}
                                  </Avatar>
                                )}
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </LayoutGroup>
                    </div>

                    <div className="mt-4 space-y-3">
                      <AnimatePresence>
                        {replyTarget && (
                          <motion.div
                            key="reply-preview"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="flex items-center justify-between rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-xs light:border-black/10 light:bg-black/5"
                          >
                            <div>
                              <p className="text-[0.6rem] uppercase tracking-[0.35em] text-white/60 light:text-black/60">
                                Replying to {participantLookup[replyTarget.senderId]?.displayName ?? "Player"}
                              </p>
                              <p className="text-white/80 light:text-black/80">{trimPreview(replyTarget.text, 120)}</p>
                            </div>
                            <button
                              type="button"
                              className="rounded-full border border-white/20 p-1 text-white/70 transition hover:text-white light:border-black/10 light:text-black/70 light:hover:text-black"
                              onClick={() => setReplyTarget(null)}
                              aria-label="Cancel reply"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div className="flex items-end gap-2">
                        <Textarea
                          value={message}
                          onChange={(event) => setMessage(event.target.value)}
                          onKeyDown={handleKeyDown}
                          onFocus={() => notifyComposerFocus(true)}
                          onBlur={() => notifyComposerFocus(false)}
                          placeholder={
                            availability === "guest-blocked"
                              ? "Sign in to chat"
                              : ready
                                ? "Message the other player"
                                : status === "loading"
                                  ? "Unlocking chat…"
                                  : "Preparing room…"
                          }
                          disabled={!ready || availability === "guest-blocked" || sending}
                          className="min-h-[46px] flex-1 resize-none rounded-2xl border border-white/15 bg-white/5 text-sm text-white placeholder:text-white/40 light:border-black/10 light:bg-black/5 light:text-black light:placeholder:text-black/40"
                        />
                        <Button
                          type="button"
                          size="icon"
                          disabled={!ready || availability === "guest-blocked" || sending || !message.trim()}
                          className="h-12 w-12 rounded-2xl bg-white text-black hover:bg-white/90 light:bg-black light:text-white light:hover:bg-black/90"
                          onClick={() => void handleSend()}
                        >
                          <SendHorizonal className="h-5 w-5" />
                        </Button>
                      </div>
                      {availability === "guest-blocked" && (
                        <p className="text-xs text-rose-200">Guests can read along but must sign in to reply.</p>
                      )}
                      {error && <p className="text-xs text-rose-300">{error}</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button
                type="button"
                aria-label="Toggle game chat"
                onClick={handleToggle}
                onPointerDown={handleBubblePointerDown}
                onPointerMove={handleBubblePointerMove}
                onPointerUp={handleBubblePointerUp}
                onPointerCancel={handleBubblePointerCancel}
                className={cn(
                  "relative flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-black/85 text-white shadow-[0_18px_45px_rgba(0,0,0,0.5)] transition touch-none light:bg-white/85 light:text-black light:border-black/10",
                  open && "border-white/50 light:border-black/50"
                )}
                animate={derivedUnread ? { scale: [1, 1.1, 0.95, 1] } : { scale: 1 }}
                transition={{ duration: derivedUnread ? 0.9 : 0.2, ease: "easeOut" }}
              >
                <MessageCircle className="h-7 w-7" />
                {showUnreadBadge && (
                  <span className="absolute -top-1 -right-1 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-[#ff5d73] px-2 text-xs font-semibold">
                    {Math.min(99, totalUnread)}
                  </span>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
