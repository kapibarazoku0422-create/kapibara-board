export type Role = 'member' | 'moderator' | 'admin';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  role: Role;
  status?: 'active' | 'suspended' | 'deleted';
  createdAt?: Date;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  threadCount: number;
}

export interface ThreadSummary {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  categorySlug: string;
  categoryName: string;
  categoryColor: string;
  authorName: string;
  authorAvatar: string | null;
  authorInitial: string;
  replyCount: number;
  viewCount: number;
  likeCount: number;
  isPinned: boolean;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface Post {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  authorInitial: string;
  authorRole: Role;
  createdAt: Date;
  isSolution: boolean;
  number: number;
}

export interface ThreadDetail extends ThreadSummary {
  body: string;
  authorId: string;
  likedByViewer: boolean;
  bookmarkedByViewer: boolean;
  status: 'published' | 'locked';
  posts: Post[];
}

export interface MemberSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  role: Role;
  createdAt: Date;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface ConversationSummary {
  member: MemberSummary;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
}

export interface AdminDashboard {
  stats: { users: number; threads: number; posts: number; openReports: number };
  users: Array<User & { threadCount: number }>;
  threads: Array<ThreadSummary & { status: string }>;
  reports: Array<{
    id: string;
    reason: string;
    detail: string | null;
    status: string;
    createdAt: Date;
    reporterName: string;
    threadId: string | null;
    threadTitle: string | null;
  }>;
}

export interface HomeData {
  categories: Category[];
  threads: ThreadSummary[];
  trending: ThreadSummary[];
  stats: { members: number; threads: number; posts: number; online: number };
}

type PassportUser = User;

declare global {
  namespace Express {
    interface User extends PassportUser {}
  }
}

declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
    flash?: { type: 'success' | 'error' | 'info'; message: string };
  }
}
