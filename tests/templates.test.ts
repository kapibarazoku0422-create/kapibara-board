import path from 'node:path';
import ejs from 'ejs';
import { describe, expect, it } from 'vitest';

const views = path.join(process.cwd(), 'views');
const currentUser = { id: 'user-a', email: 'a@example.com', displayName: 'あおい', avatarUrl: null, role: 'admin' };
const member = { id: 'user-b', displayName: 'むぎ', avatarUrl: null, bio: null, role: 'member', createdAt: new Date() };
const base = {
  title: 'Test',
  currentUser,
  csrfToken: 'token',
  flash: null,
  demoMode: false,
  unreadMessages: 2,
  formatNumber: (value: number) => String(value),
  formatDate: () => '今日',
};

describe('social templates', () => {
  it('renders members, inbox, and live conversation', async () => {
    const members = await ejs.renderFile(path.join(views, 'members.ejs'), { ...base, members: [member], query: '' });
    const messages = await ejs.renderFile(path.join(views, 'messages.ejs'), {
      ...base,
      conversations: [{ member, lastMessage: 'こんにちは', lastMessageAt: new Date(), unreadCount: 1 }],
    });
    const conversation = await ejs.renderFile(path.join(views, 'conversation.ejs'), {
      ...base,
      member,
      messages: [{ id: 'dm-1', senderId: 'user-b', recipientId: 'user-a', body: 'こんにちは', createdAt: new Date(), readAt: null }],
    });
    expect(members).toContain('DMを送る');
    expect(messages).toContain('こんにちは');
    expect(conversation).toContain('data-live-dm');
  });

  it('renders the admin dashboard controls', async () => {
    const html = await ejs.renderFile(path.join(views, 'admin.ejs'), {
      ...base,
      stats: { users: 2, threads: 1, posts: 3, openReports: 1 },
      users: [{ ...currentUser, status: 'active', createdAt: new Date(), threadCount: 1 }],
      threads: [{ id: 'thread-1', title: '話題', excerpt: '', tags: [], categorySlug: 'general', categoryName: '総合', categoryColor: '#000', authorName: 'あおい', authorAvatar: null, authorInitial: 'あ', replyCount: 3, viewCount: 10, likeCount: 2, isPinned: false, createdAt: new Date(), lastActivityAt: new Date(), status: 'published' }],
      reports: [{ id: 'report-1', reason: 'spam', detail: null, status: 'open', createdAt: new Date(), reporterName: 'むぎ', threadId: 'thread-1', threadTitle: '話題' }],
    });
    expect(html).toContain('管理者パネル');
    expect(html).toContain('/admin/threads/thread-1/status');
  });
});
