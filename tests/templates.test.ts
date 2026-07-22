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
  currentPath: '/',
  assetVersion: 'test',
  myGroups: [{ id: 'group-1', name: '夜ふかし部', visibility: 'public' }],
  navCategories: [{ id: 1, slug: 'general', name: '総合', description: '', icon: '総', color: '#000', threadCount: 1 }],
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
    expect(members).toContain('/messages/user-b');
    expect(messages).toContain('こんにちは');
    expect(conversation).toContain('data-live-dm');
  });

  it('renders group list, group page, and group chat', async () => {
    const group = {
      id: 'group-1',
      name: '夜ふかし部',
      description: '深夜テンションで語る場所',
      visibility: 'private' as const,
      ownerId: 'user-a',
      ownerName: 'あおい',
      memberCount: 2,
      boardCount: 1,
      isMember: true,
      isOwner: true,
      isInvited: false,
      createdAt: new Date(),
      members: [{ id: 'user-a', displayName: 'あおい', avatarUrl: null, role: 'owner' as const }],
      threads: [],
    };
    const list = await ejs.renderFile(path.join(views, 'groups.ejs'), { ...base, groups: [group] });
    const page = await ejs.renderFile(path.join(views, 'group.ejs'), { ...base, group, inviteQuery: '', inviteCandidates: [] });
    const chat = await ejs.renderFile(path.join(views, 'group-chat.ejs'), {
      ...base,
      group,
      messages: [{ id: 'gm-1', groupId: 'group-1', senderId: 'user-a', senderName: 'あおい', senderAvatar: null, senderInitial: 'あ', body: 'こんばんは', createdAt: new Date() }],
    });
    expect(list).toContain('夜ふかし部');
    expect(page).toContain('/groups/group-1/chat');
    expect(page).toContain('メンバーを招待する');
    expect(chat).toContain('data-live-group');
    expect(chat).toContain('こんばんは');
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
