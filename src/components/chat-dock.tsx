"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { format } from "date-fns";
import {
  MessageCircle,
  X,
  SendHorizonal,
  Reply,
  Copy,
  Smile,
  Heart,
  ThumbsUp,
  Frown,
  Angry,
  Laugh,
  Plus
} from "lucide-react";
import EmojiPicker, { Theme, EmojiClickData } from "emoji-picker-react";
import { useLongPress } from "use-long-press";

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

type BubbleEdge = "left" | "right";

type BubblePosition = {
  edge: BubbleEdge;
  offsetY: number;
};

const BUBBLE_SIZE = 64;
const EDGE_PADDING = 24;
const CHAT_PANEL_WIDTH = 420;
const CHAT_PANEL_HEIGHT = 580; // Approximate max height

const defaultBubblePosition: BubblePosition = { edge: "right", offsetY: 9000 };

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
  const { userId, user } = useFirebase();
  const { connected: realtimeConnected } = useRealtime();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
  const [suppressToggleRef, setSuppressToggle] = useState(false);
  const isDraggingRef = useRef(false);
  const { theme } = useTheme();
  const [isMobile, setIsMobile] = useState(false);
  const nativeEmojiInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentRef = useRef<number>(0);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.matchMedia("(pointer: coarse)").matches);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    messageId: string;
    rect: DOMRect;
  } | null>(null);

  const clampPosition = useCallback((next: BubblePosition) => {
    if (typeof window === "undefined") return next;

    // Ensure bubble stays within screen bounds
    const maxY = window.innerHeight - BUBBLE_SIZE - EDGE_PADDING;
    const minY = EDGE_PADDING;

    return {
      edge: "right" as const,
      offsetY: Math.min(maxY, Math.max(minY, next.offsetY)),
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
      if (clamped.edge === current.edge && clamped.offsetY === current.offsetY) {
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
    membership,
    refreshMessages,
    typingUsers,
    sendTyping,
    sendReaction,
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
        const thresholdExceeded = Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5;
        if (!thresholdExceeded) return;
        dragState.moved = true;
        isDraggingRef.current = true; // Mark as dragging
        setOpen(false); // Close chat immediately on drag start
      }

      // Live update: follow cursor precisely during drag
      const newY = clientY - BUBBLE_SIZE / 2;

      const next = clampPosition({ edge: "right" as const, offsetY: newY });
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
        // Snap to edge with final position
        const finalPosition = clampPosition(livePositionRef.current);
        livePositionRef.current = finalPosition;
        setStoredBubblePosition(finalPosition);
      }
      setDragOverridePosition(null);
      if (moved && !options?.cancelled) {
        setSuppressToggle(true);
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            setSuppressToggle(false);
            isDraggingRef.current = false; // Clear dragging flag
          }, 150);
        }
      } else {
        isDraggingRef.current = false; // Clear dragging flag
      }
    },
    [clampPosition, setStoredBubblePosition]
  );

  useEffect(() => {
    // Firestore listeners will auto-sync when chat opens
  }, [open, ready]);

  const handleBubblePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const pointerType = event.pointerType ?? "mouse";
      if ((pointerType === "mouse" || pointerType === "pen") && event.button !== 0) return;
      event.preventDefault();
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: 0, // Not used anymore
        originY: livePositionRef.current.offsetY,
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
    if (suppressToggleRef || isDraggingRef.current) {
      return;
    }
    setOpen((previous) => !previous);
  }, [suppressToggleRef]);

  // Track last opened time locally to show "new" messages since open
  const [lastOpenedAt, setLastOpenedAt] = useState<number>(Date.now());

  useEffect(() => {
    if (open) {
      setLastOpenedAt(Date.now());
    }
  }, [open]);

  const computedUnread = useMemo(() => {
    if (!messages.length || open) return 0;
    return messages.reduce((total, entry) => {
      if (entry.senderId === userId || !entry.sentAt) return total;
      const sentAt = new Date(entry.sentAt).getTime();
      if (sentAt > lastOpenedAt) return total + 1;
      return total;
    }, 0);
  }, [messages, userId, open, lastOpenedAt]);

  const totalUnread = Math.max(unreadCount, computedUnread);
  const derivedUnread = totalUnread > 0;
  const showUnreadBadge = !open && totalUnread > 0;
  const headerStatus = (() => {
    if (!readyToChat) return "Waiting for players";
    if (status === "loading") return "Connecting…";
    if (!ready) return "Preparing chat…";
    if (error) return error;
    if (lastMessageAt) return `Last message at ${formatMessageTime(lastMessageAt)}`;
    return "Connected";
  })();

  // Calculate chat panel position - REVERSED LOGIC
  // Bottom half of screen = chat on TOP-LEFT of bubble
  // Top half of screen = chat on BOTTOM-LEFT of bubble
  const chatPanelPosition = useMemo(() => {
    if (typeof window === "undefined") return "bottom";

    const bubbleY = liveBubblePosition.offsetY;
    const windowHeight = window.innerHeight;
    const isBottomHalf = bubbleY > windowHeight / 2;

    // Reversed: bottom half → top, top half → bottom
    return isBottomHalf ? "top" : "bottom";
  }, [liveBubblePosition.offsetY]);

  const bubbleStyle = useMemo<CSSProperties>(() => {
    const baseStyle: CSSProperties = {
      position: "fixed",
      top: `${liveBubblePosition.offsetY}px`,
    };
    if (liveBubblePosition.edge === "left") {
      return { ...baseStyle, left: `${EDGE_PADDING}px` };
    } else {
      return { ...baseStyle, right: `${EDGE_PADDING}px` };
    }
  }, [liveBubblePosition]);

  // Context Menu Handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, messageId: string) => {
    e.preventDefault();
    const target = (e.target as HTMLElement).closest('[data-message-bubble]');
    if (target) {
      setContextMenu({
        messageId,
        rect: target.getBoundingClientRect(),
      });
    }
  }, []);

  const bindLongPress = useLongPress((e, { context }) => {
    const event = e as unknown as React.MouseEvent;
    const messageId = context as string;
    const target = (event.target as HTMLElement).closest('[data-message-bubble]');
    if (target) {
      setContextMenu({
        messageId,
        rect: target.getBoundingClientRect(),
      });
    }
  }, {
    threshold: 500,
    captureEvent: true,
    cancelOnMovement: true,
  });

  const closeContextMenu = () => {
    setContextMenu(null);
    setShowEmojiPicker(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ description: "Copied to clipboard" });
    closeContextMenu();
  };

  const handleReplyFromMenu = (message: ChatMessage) => {
    setReplyTarget(message);
    closeContextMenu();
  };

  const handleReaction = (emoji: string) => {
    if (!contextMenu) return;
    void sendReaction(contextMenu.messageId, emoji);
    closeContextMenu();
  };

  const handleNativeEmojiSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    // Attempt to extract the last character which is likely the emoji
    // But actually, the input will just have the emoji.
    // We'll just take the value.
    handleReaction(val);
    e.target.value = ""; // Reset
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <AnimatePresence>
        {readyToChat && (
          <motion.div
            key="chat-dock"
            className={cn(
              "pointer-events-auto flex flex-col items-end relative",
              isMobile && "select-none touch-callout-none"
            )}
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            style={{ ...bubbleStyle, WebkitTouchCallout: isMobile ? "none" : "default" }}
          >
            <AnimatePresence mode="wait">
              {open && (
                <motion.div
                  key="chat-panel"
                  initial={{
                    opacity: 0,
                    scale: 0.1,
                    x: 0,
                    y: chatPanelPosition === "top" ? 20 : -20,
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    x: 0,
                    y: 0,
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.1,
                    x: 0,
                    y: chatPanelPosition === "top" ? 20 : -20,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 350,
                    damping: 25,
                    opacity: { duration: 0.2 }
                  }}
                  style={{
                    position: "absolute",
                    right: 0,
                    bottom: chatPanelPosition === "top" ? "calc(100% + 16px)" : undefined,
                    top: chatPanelPosition === "bottom" ? "calc(100% + 16px)" : undefined,
                    transformOrigin: chatPanelPosition === "top"
                      ? "bottom right"
                      : "top right"
                  }}
                  className="w-[min(500px,calc(100vw-3rem))] rounded-[28px] border bg-white/95 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.15)] backdrop-blur-2xl dark:border-white/10 dark:bg-gradient-to-b dark:from-[#0c0f19]/95 dark:via-[#0c0f19]/90 dark:to-[#0c0f19]/85 dark:text-white border-gray-200 text-gray-900 max-h-[80vh] flex flex-col"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.65rem] uppercase tracking-[0.4em] text-gray-500 dark:text-white/60">Chat with</p>
                      <p className="text-xl font-comic leading-tight text-gray-900 dark:text-white">{partnerDisplayName}</p>
                      <p className="mt-1 text-xs text-gray-600 dark:text-white/65">{headerStatus}</p>
                    </div>
                  </div>

                  <div className="mt-6 max-h-80 overflow-y-auto px-0 scrollbar-hide overscroll-contain" ref={scrollRef}>
                    <LayoutGroup>
                      <AnimatePresence initial={false}>
                        {messages.map((entry: ChatMessage, index: number) => {
                          const isSelf = entry.senderId === userId || participantLookup[entry.senderId]?.isSelf;
                          const participant = participantLookup[entry.senderId];
                          const bubbleColors = isSelf
                            ? "bg-gradient-to-br from-[#0B84FE] to-[#0066CC] text-white shadow-[0_2px_12px_rgba(11,132,254,0.3)]"
                            : "bg-[#E9E9EB] text-gray-900 dark:bg-white/10 dark:text-white";

                          // Check if previous message was from same sender
                          // Check if previous message was from same sender
                          const prevMessage = index > 0 ? messages[index - 1] : null;
                          const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;
                          const isGroupStart = index === 0 || messages[index - 1].senderId !== entry.senderId;
                          const isGroupEnd = index === messages.length - 1 || messages[index + 1].senderId !== entry.senderId;

                          const isActive = contextMenu?.messageId === entry.id;

                          return (
                            <motion.div
                              key={entry.clientMessageId || entry.id}
                              layout={!isMobile}
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{
                                opacity: 1,
                                y: 0,
                                scale: isActive ? 1.15 : 1,
                                zIndex: isActive ? 9999 : 0,
                                filter: (contextMenu && isActive) ? "drop-shadow(0 10px 20px rgba(0,0,0,0.3))" : "none"
                              }}
                              exit={{ opacity: 0, y: -10, scale: 0.9 }}
                              transition={{ type: "spring", stiffness: 500, damping: 30 }}
                              className={cn(
                                "flex gap-1.5 md:gap-3 items-end relative",
                                isSelf ? "justify-end" : "justify-start",
                                isGroupEnd ? "mb-4" : "mb-1"
                              )}
                              onContextMenu={(e) => handleContextMenu(e, entry.id)}
                              {...bindLongPress(entry.id)}
                              data-message-bubble
                              style={{ WebkitTouchCallout: "none" }}
                            >
                              {!isSelf && isGroupEnd ? (
                                <Avatar className="h-7 w-7 md:h-9 md:w-9 border border-gray-300 dark:border-white/15">
                                  {participant?.photoURL ? (
                                    <AvatarImage src={participant.photoURL} alt={participant?.displayName ?? "Player"} />
                                  ) : (
                                    <AvatarFallback className="bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white">
                                      {participant?.displayName?.[0]?.toUpperCase() ?? "?"}
                                    </AvatarFallback>
                                  )}
                                </Avatar>
                              ) : !isSelf && (
                                <div className="w-7 md:w-9" />
                              )}
                              <div className="flex flex-col gap-1 max-w-[80%] relative group">
                                <div
                                  className={cn(
                                    "relative px-4 py-2 text-xs md:text-sm shadow-sm transition-all",
                                    isSelf
                                      ? "bg-[#0B84FE] text-white rounded-2xl rounded-tr-sm"
                                      : "bg-[#f68131] text-white dark:bg-white/10 dark:text-white rounded-2xl rounded-tl-sm"
                                  )}
                                  onContextMenu={(e) => handleContextMenu(e, entry.id)}
                                >
                                  {entry.replyTo && (
                                    <div className="mb-2 rounded-2xl border bg-white/20 px-3 py-2 text-xs border-gray-300 dark:border-white/20 dark:bg-white/10">
                                      <p className="text-[0.6rem] uppercase tracking-[0.35em] text-gray-600 dark:text-white/70">
                                        Replying to {participantLookup[entry.replyTo.senderId]?.displayName ?? "Player"}
                                      </p>
                                      <p className="line-clamp-2 text-gray-800 dark:text-white/90">{trimPreview(entry.replyTo.text)}</p>
                                    </div>
                                  )}
                                  <p className="whitespace-pre-wrap break-words leading-relaxed">{entry.text}</p>

                                  {/* Reactions */}
                                  {entry.reactions && Object.keys(entry.reactions).length > 0 && (
                                    <div className={cn(
                                      "absolute -bottom-2 flex gap-0.5",
                                      isSelf ? "-left-2" : "-right-2"
                                    )}>
                                      {Object.entries(entry.reactions).map(([uid, emoji]) => (
                                        <button
                                          key={uid}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (uid === user?.uid) {
                                              handleReaction(emoji);
                                            }
                                          }}
                                          className={cn(
                                            "flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs shadow-sm ring-1 ring-black/5 dark:bg-gray-800 dark:ring-white/10 transition-transform hover:scale-110",
                                            uid === user?.uid && "ring-blue-500 dark:ring-blue-400"
                                          )}
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {isSelf && isGroupEnd ? (
                                <Avatar className="h-7 w-7 md:h-9 md:w-9 border border-gray-300 dark:border-white/15">
                                  {participant?.photoURL ? (
                                    <AvatarImage src={participant.photoURL} alt={participant?.displayName ?? "Player"} />
                                  ) : (
                                    <AvatarFallback className="bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-white">
                                      {participant?.displayName?.[0]?.toUpperCase() ?? "?"}
                                    </AvatarFallback>
                                  )}
                                </Avatar>
                              ) : isSelf && (
                                <div className="w-7 md:w-9" />
                              )}
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </LayoutGroup>
                  </div>

                  <div className="mt-6 space-y-3">
                    <AnimatePresence>
                      {replyTarget && (
                        <motion.div
                          key="reply-preview"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="flex items-center justify-between rounded-2xl border bg-gray-100 px-3 py-2 text-xs border-gray-300 dark:border-white/15 dark:bg-white/5"
                        >
                          <div className="flex-1 min-w-0 mr-2">
                            <p className="text-[0.6rem] uppercase tracking-[0.35em] text-gray-500 dark:text-white/60 truncate">
                              Replying to {participantLookup[replyTarget.senderId]?.displayName ?? "Player"}
                            </p>
                            <p className="truncate text-gray-700 dark:text-white/80">{replyTarget.text}</p>
                          </div>
                          <button
                            type="button"
                            className="ml-2 rounded-full border p-1.5 transition bg-white/50 hover:bg-white border-gray-300 text-gray-600 hover:text-gray-900 dark:border-white/20 dark:bg-white/10 dark:text-white/70 dark:hover:text-white dark:hover:bg-white/20"
                            onClick={() => setReplyTarget(null)}
                            aria-label="Cancel reply"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="flex items-end gap-2 relative">
                      <AnimatePresence>
                        {typingUsers.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute -top-6 left-0 right-0 flex justify-center"
                          >
                            <span className="text-[10px] font-medium text-gray-400 dark:text-white/40 px-2 py-0.5">
                              {typingUsers.map((id) => participantLookup[id]?.displayName ?? "Player").join(", ")} is typing...
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <Textarea
                        value={message}
                        onChange={(event) => {
                          setMessage(event.target.value);
                          // Throttle typing updates to every 2 seconds
                          const now = Date.now();
                          if (now - lastTypingSentRef.current > 2000) {
                            sendTyping(true);
                            lastTypingSentRef.current = now;
                          }
                        }}
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
                        className="flex-1 resize-none rounded-2xl border bg-gray-100 text-sm text-gray-900 placeholder:text-gray-500 border-gray-300 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-white/40 py-3 px-4 min-h-[48px] max-h-[120px] scrollbar-hide"
                        rows={1}
                        style={{ height: 'auto', lineHeight: '1.5' }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        disabled={!ready || availability === "guest-blocked" || sending || !message.trim()}
                        className="h-12 w-12 shrink-0 rounded-full bg-[#0B84FE] text-white hover:bg-[#0066CC] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
                "relative flex h-16 w-16 items-center justify-center rounded-full border shadow-lg transition-all touch-none bg-white text-gray-900 border-gray-300 dark:border-white/20 dark:bg-black/90 dark:text-white",
                dragOverridePosition && "cursor-grabbing"
              )}
              animate={derivedUnread
                ? { scale: [1, 1.12, 1], rotate: [0, -10, 10, 0] }
                : { scale: 1, rotate: 0 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 20,
                mass: 0.8
              }}
              whileTap={{ scale: 0.85 }}
            >
              <MessageCircle className="h-7 w-7" />
              {showUnreadBadge && (
                <span className="absolute -top-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#ff5d73] text-xs font-bold text-white shadow-lg">
                  !
                </span>
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backdrop for Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-transparent pointer-events-auto"
            onClick={closeContextMenu}
          >
            {/* Context Menu Dropdown */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="absolute flex flex-col gap-2 p-2 rounded-2xl bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-white/20 shadow-2xl min-w-[180px] select-none"
              style={{
                position: "fixed",
                left: Math.min(contextMenu.rect.left, window.innerWidth - 200),
                top: Math.min(contextMenu.rect.bottom + 8, window.innerHeight - 200),
                WebkitUserSelect: "none",
                userSelect: "none",
                WebkitTouchCallout: "none",
              }}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Reactions */}
              <div className="flex justify-between px-2 py-2 mb-1 bg-white/10 rounded-xl border border-transparent dark:border-transparent">
                {[
                  { emoji: "❤️", label: "Love" },
                  { emoji: "👍", label: "Like" },
                  { emoji: "😂", label: "Haha" },
                  { emoji: "😮", label: "Wow" },
                  { emoji: "😢", label: "Sad" },
                  { emoji: "😡", label: "Angry" },
                ].map((reaction, i) => (
                  <button
                    key={i}
                    className="p-2 hover:bg-white/20 hover:scale-110 active:scale-95 rounded-full transition-all text-xl border border-transparent hover:border-gray-200 dark:hover:border-white/10"
                    onClick={() => handleReaction(reaction.emoji)}
                  >
                    {reaction.emoji}
                  </button>
                ))}
                <button
                  className="p-1.5 hover:bg-white/20 rounded-full transition-colors text-gray-700 dark:text-white relative"
                  onClick={() => {
                    if (isMobile) {
                      nativeEmojiInputRef.current?.focus();
                    } else {
                      setShowEmojiPicker(!showEmojiPicker);
                    }
                  }}
                >
                  <Plus className="w-5 h-5" />
                  {/* Hidden native emoji input */}
                  <input
                    ref={nativeEmojiInputRef}
                    type="text"
                    className="absolute inset-0 opacity-0 w-full h-full pointer-events-none"
                    style={{ fontSize: "16px" }} // Prevent zoom on iOS
                    onChange={handleNativeEmojiSelect}
                    aria-label="Choose emoji"
                  />
                </button>
              </div>
              {showEmojiPicker && (
                <div
                  className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 backdrop-blur-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowEmojiPicker(false);
                  }}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <EmojiPicker
                      onEmojiClick={(emojiData: EmojiClickData) => handleReaction(emojiData.emoji)}
                      theme={Theme.AUTO}
                      width={350}
                      height={450}
                    />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-1">
                <button
                  className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-white hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98] rounded-xl transition-all w-full text-left border border-transparent hover:border-gray-200 dark:hover:border-white/10"
                  onClick={() => {
                    const msg = messages.find(m => m.id === contextMenu.messageId);
                    if (msg) handleReplyFromMenu(msg);
                  }}
                >
                  <Reply className="w-4 h-4" />
                  Reply
                </button>
                <button
                  className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-white hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98] rounded-xl transition-all w-full text-left border border-transparent hover:border-gray-200 dark:hover:border-white/10"
                  onClick={() => {
                    const msg = messages.find(m => m.id === contextMenu.messageId);
                    if (msg) handleCopy(msg.text);
                  }}
                >
                  <Copy className="w-4 h-4" />
                  Copy Text
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {
        open && !contextMenu && (
          <div
            className="fixed inset-0 z-[65] bg-black/5 md:bg-transparent"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )
      }
    </div >
  );
}
