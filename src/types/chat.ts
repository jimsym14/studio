export type ChatMessageReplyPayload = {
  id: string;
  senderId: string;
  text: string;
};

export type ChatMessagePayload = {
  id: string;
  senderId: string;
  text: string;
  sentAt?: string | null;
  isSystem?: boolean;
  replyTo?: ChatMessageReplyPayload | null;
  clientMessageId?: string | null;
};
