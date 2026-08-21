export interface ArchiveProfile {
  handle: string | null;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  joinedAt: string | null;
}

export interface ArchiveAccount {
  id: string | null;
  handle: string | null;
  displayName: string | null;
  email: string | null;
}

export interface ArchiveAccountRef {
  id: string | null;
  handle: string | null;
  displayName: string | null;
  sourceFile: string;
}

export interface ArchiveDirectMessage {
  id: string | null;
  conversationId: string | null;
  senderId: string | null;
  recipientIds: string[];
  text: string;
  createdAt: string | null;
  mediaUrls: string[];
  sender?: ArchiveParticipant | null;
  recipients?: ArchiveParticipant[];
  expandedUrls?: ArchiveExpandedUrl[];
}

export interface ArchiveExpandedUrl {
  shortUrl: string;
  destination: string;
  source: "archive" | "local-corpus";
}

export interface ArchiveParticipant {
  id: string;
  handle: string | null;
  label: string;
}

export interface ArchiveRepairSummary {
  archiveLinksExpanded: number;
  corpusLinksExpanded: number;
  participantIdsResolved: number;
  participantIdsUnresolved: number;
}

export function emptyArchiveRepairSummary(): ArchiveRepairSummary {
  return {
    archiveLinksExpanded: 0,
    corpusLinksExpanded: 0,
    participantIdsResolved: 0,
    participantIdsUnresolved: 0
  };
}

export interface ArchiveMediaReference {
  id: string | null;
  tweetId: string | null;
  url: string | null;
  filename: string | null;
  mimeType: string | null;
  sourceFile: string;
}

export interface ArchiveList {
  id: string | null;
  name: string | null;
  description: string | null;
  memberIds: string[];
  subscriberIds: string[];
}

export interface ArchiveCollections {
  profile: ArchiveProfile | null;
  account: ArchiveAccount | null;
  directMessages: ArchiveDirectMessage[];
  media: ArchiveMediaReference[];
  followers: ArchiveAccountRef[];
  following: ArchiveAccountRef[];
  lists: ArchiveList[];
}

export function emptyArchiveCollections(): ArchiveCollections {
  return {
    profile: null,
    account: null,
    directMessages: [],
    media: [],
    followers: [],
    following: [],
    lists: []
  };
}
