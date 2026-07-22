import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import methodOverride from 'method-override';
import { z } from 'zod';
import { passport } from './auth.js';
import { config } from './config.js';
import { checkDatabase, pool } from './db.js';
import * as repository from './repository.js';
import { directMessageChannel, groupChannel, publish, siteChannel, subscribe, threadChannel } from './realtime.js';

const app = express();

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
if (config.trustProxy || config.isProduction) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(compression({ filter: (req, res) => req.headers.accept === 'text/event-stream' ? false : compression.filter(req, res) }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(process.cwd(), 'public'), {
  maxAge: config.isProduction ? '7d' : 0,
  etag: true,
  setHeaders(res) {
    if (config.isProduction && (res.req as Request | undefined)?.query?.v) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

const PgStore = connectPgSimple(session);
app.use(
  session({
    name: 'kapibara.sid',
    store: pool
      ? new PgStore({ pool, tableName: 'user_sessions', createTableIfMissing: false, pruneSessionInterval: 900 })
      : undefined,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

const assetVersion = (process.env.RENDER_GIT_COMMIT ?? Date.now().toString(36)).slice(0, 8);

let navCategoriesCache: { data: Awaited<ReturnType<typeof repository.getCategories>>; expiresAt: number } | null = null;
async function getNavCategories() {
  if (navCategoriesCache && navCategoriesCache.expiresAt > Date.now()) return navCategoriesCache.data;
  const data = await repository.getCategories();
  navCategoriesCache = { data, expiresAt: Date.now() + 30_000 };
  return data;
}

type UserHeaderData = { unread: number; myGroups: Awaited<ReturnType<typeof repository.getMyGroups>> };
const userHeaderCache = new Map<string, UserHeaderData & { expiresAt: number }>();

function invalidateUserHeader(userId: string) {
  userHeaderCache.delete(userId);
}

async function getUserHeaderData(userId: string): Promise<UserHeaderData> {
  const cached = userHeaderCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const [unread, myGroups] = await Promise.all([
    repository.getUnreadMessageCount(userId),
    repository.getMyGroups(userId),
  ]);
  if (userHeaderCache.size > 1000) userHeaderCache.clear();
  const data = { unread, myGroups, expiresAt: Date.now() + 15_000 };
  userHeaderCache.set(userId, data);
  return data;
}

app.use(async (req, res, next) => {
  if (req.user && !req.session.csrfToken) req.session.csrfToken = randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken ?? '';
  res.locals.currentUser = req.user ?? null;
  res.locals.currentPath = req.path;
  res.locals.assetVersion = assetVersion;
  try {
    res.locals.navCategories = await getNavCategories();
  } catch {
    res.locals.navCategories = [];
  }
  res.locals.googleAuthEnabled = config.googleAuthEnabled;
  res.locals.demoMode = config.demoMode;
  res.locals.flash = req.session.flash ?? null;
  res.locals.unreadMessages = 0;
  res.locals.myGroups = [];
  const skipHeaderData = req.path === '/health' || req.path.endsWith('/events');
  if (req.user && !skipHeaderData) {
    try {
      const header = await getUserHeaderData(req.user.id);
      res.locals.unreadMessages = header.unread;
      res.locals.myGroups = header.myGroups;
    } catch {
      res.locals.unreadMessages = 0;
    }
  }
  res.locals.formatNumber = (value: number) => new Intl.NumberFormat('ja-JP', { notation: value > 9999 ? 'compact' : 'standard' }).format(value);
  res.locals.formatDate = (value: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
  delete req.session.flash;
  next();
});

const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const actual = typeof req.body?._csrf === 'string' ? req.body._csrf : '';
  const expected = req.session.csrfToken ?? '';
  const valid = actual.length === expected.length && actual.length > 0 && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  if (!valid) return res.status(403).render('error', { title: '操作を確認できませんでした', status: 403, message: 'ページを再読み込みして、もう一度お試しください。' });
  next();
};
app.use(csrfProtection);

const writeLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: '投稿が少し速すぎます。1分ほど待ってからお試しください。' });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  req.session.flash = { type: 'info', message: 'ボードを作るなら、Googleアカウントではじめよう。' };
  return res.redirect('/');
}

function requireDatabase(req: Request, res: Response, next: NextFunction) {
  if (pool) return next();
  req.session.flash = { type: 'info', message: '現在はプレビューモードです。PostgreSQLを接続すると投稿できます。' };
  return res.redirect(req.get('referer') || '/');
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return requireAuth(req, res, next);
  if (req.user?.role === 'admin') return next();
  return res.status(403).render('error', { title: 'ここは管理者専用です', status: 403, message: '管理者アカウントでアクセスしてね。' });
}

function openEventStream(req: Request, res: Response, channel: string) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const listener = (payload: unknown) => {
    res.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
    (res as Response & { flush?: () => void }).flush?.();
  };
  const unsubscribe = subscribe(channel, listener);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
  heartbeat.unref();
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => uuidPattern.test(value);
const isAjax = (req: Request) => req.get('x-requested-with') === 'fetch';

const threadInput = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  groupId: z.string().regex(uuidPattern).optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(100_000),
  tags: z.string().max(500).default(''),
});
const groupInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  visibility: z.enum(['public', 'private']).default('public'),
});
const groupMessageInput = z.object({ body: z.string().trim().min(1).max(4000) });
const inviteInput = z.object({ userId: z.string().regex(uuidPattern) });
const postInput = z.object({ body: z.string().trim().min(1).max(100_000) });
const quickPostInput = z.object({ body: z.string().trim().min(1).max(100_000) });
const messageInput = z.object({ body: z.string().trim().min(1).max(50_000) });
const reportInput = z.object({
  reason: z.enum(['spam', 'harassment', 'privacy', 'dangerous', 'other']),
  detail: z.string().trim().max(2000).default(''),
});

app.get('/', async (req, res) => {
  const sort = ['active', 'popular', 'new'].includes(String(req.query.sort)) ? String(req.query.sort) : 'active';
  const data = await repository.getHomeData(sort);
  res.render('home', { title: '好きな話を、のんびりしよう。', ...data, sort });
});

app.get('/boards/:slug', async (req, res) => {
  const sort = ['active', 'popular', 'new'].includes(String(req.query.sort)) ? String(req.query.sort) : 'active';
  const data = await repository.getCategory(req.params.slug, sort);
  if (!data) return res.status(404).render('error', { title: 'そのカテゴリは見つからなかったよ', status: 404, message: 'URLが合っているか、もう一度見てみてね。' });
  return res.render('board', { title: data.category.name, ...data, sort });
});

app.get('/threads/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id) && pool) return res.status(404).render('error', { title: 'そのボードは見つからなかったよ', status: 404, message: '削除されたか、URLが変わったのかもしれません。' });
  const thread = await repository.getThread(id, req.user?.id);
  if (!thread) return res.status(404).render('error', { title: 'そのボードは見つからなかったよ', status: 404, message: '削除されたか、URLが変わったのかもしれません。' });
  if (thread.groupId && thread.groupVisibility === 'private') {
    const member = req.user ? await repository.isGroupMember(thread.groupId, req.user.id) : false;
    if (!member) return res.status(404).render('error', { title: 'そのボードは見つからなかったよ', status: 404, message: '非公開グループのボードは、メンバーだけが見られます。' });
  }
  return res.render('thread', { title: thread.title, thread });
});

app.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  const threads = await repository.searchThreads(query);
  res.render('search', { title: query ? `「${query}」の検索結果` : '検索', query, threads });
});

app.post('/quick-post', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const parsed = quickPostInput.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: 'ひとこと書いてから投稿してね。' };
    return res.redirect('/#latest');
  }
  const categoryId = await repository.getCategoryId('general');
  if (!categoryId) throw new Error('General category is missing');
  const firstLine = parsed.data.body.split(/\r?\n/).find(Boolean) ?? parsed.data.body;
  const title = firstLine.length > 70 ? `${firstLine.slice(0, 70)}…` : firstLine;
  const id = await repository.createThread({ authorId: req.user!.id, categoryId, title, body: parsed.data.body, tags: [] });
  publish(siteChannel(), { type: 'thread', categorySlug: 'general' });
  req.session.flash = { type: 'success', message: '投稿したよ！' };
  return res.redirect(`/threads/${id}`);
});

async function getGroupContext(groupId: string | undefined, userId: string) {
  if (!groupId || !isUuid(groupId)) return null;
  const member = await repository.isGroupMember(groupId, userId);
  if (!member) return null;
  return repository.getGroup(groupId, userId);
}

app.get('/new', requireAuth, async (req, res) => {
  const categories = await repository.getCategories();
  const group = await getGroupContext(typeof req.query.group === 'string' ? req.query.group : undefined, req.user!.id);
  res.render('new', { title: 'ボードを作る', categories, group, values: {}, errors: {} });
});

app.post('/threads', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const parsed = threadInput.safeParse(req.body);
  const group = await getGroupContext(typeof req.body.groupId === 'string' ? req.body.groupId : undefined, req.user!.id);
  if (typeof req.body.groupId === 'string' && req.body.groupId && !group) {
    req.session.flash = { type: 'error', message: 'そのグループには参加していないみたい。' };
    return res.redirect('/groups');
  }
  const categoryId = group ? await repository.getCategoryId('general') : parsed.success ? parsed.data.categoryId : undefined;
  if (!parsed.success || !categoryId) {
    const categories = await repository.getCategories();
    const errors = !parsed.success ? parsed.error.flatten().fieldErrors : { categoryId: ['カテゴリを選んでね'] };
    return res.status(422).render('new', { title: 'ボードを作る', categories, group, values: req.body, errors });
  }
  const id = await repository.createThread({
    authorId: req.user!.id,
    categoryId,
    title: parsed.data.title,
    body: parsed.data.body,
    tags: parsed.data.tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean),
    groupId: group?.id ?? null,
  });
  if (!group) {
    const categorySlug = (await getNavCategories()).find((category) => category.id === categoryId)?.slug ?? null;
    publish(siteChannel(), { type: 'thread', categorySlug });
  }
  req.session.flash = { type: 'success', message: 'ボードを公開したよ！' };
  return res.redirect(`/threads/${id}`);
});

app.post('/threads/:id/posts', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  const parsed = postInput.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: 'ひとこと書いてから送ってね。' };
    return res.redirect(`/threads/${threadId}#reply`);
  }
  const threadGroup = await repository.getThreadGroup(threadId);
  if (threadGroup && !(await repository.isGroupMember(threadGroup.groupId, req.user!.id))) {
    req.session.flash = { type: 'error', message: 'グループに参加するとレスできるよ。' };
    return res.redirect(`/groups/${threadGroup.groupId}`);
  }
  const post = await repository.createPost({ threadId, authorId: req.user!.id, body: parsed.data.body });
  publish(threadChannel(threadId), { type: 'post', post });
  if (isAjax(req)) return res.json({ post });
  req.session.flash = { type: 'success', message: 'レスを投稿したよ！' };
  return res.redirect(`/threads/${threadId}#latest`);
});

app.get('/threads/:id/events', (req, res) => openEventStream(req, res, threadChannel(String(req.params.id))));
app.get('/feed/events', (req, res) => openEventStream(req, res, siteChannel()));

app.post('/threads/:id/like', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  const result = await repository.toggleLike(threadId, req.user!.id);
  if (isAjax(req)) return res.json(result);
  return res.redirect(`/threads/${threadId}`);
});

app.post('/threads/:id/bookmark', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  const active = await repository.toggleBookmark(threadId, req.user!.id);
  if (isAjax(req)) return res.json({ active });
  req.session.flash = { type: 'success', message: active ? '「あとで読む」に入れたよ。' : '「あとで読む」から外したよ。' };
  return res.redirect(`/threads/${threadId}`);
});

app.post('/threads/:id/report', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const parsed = reportInput.safeParse(req.body);
  const threadId = String(req.params.id);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: '通報理由を選んでね。' };
    return res.redirect(`/threads/${threadId}`);
  }
  await repository.createReport(req.user!.id, threadId, parsed.data.reason, parsed.data.detail);
  req.session.flash = { type: 'success', message: '知らせてくれてありがとう。管理者が確認します。' };
  return res.redirect(`/threads/${threadId}`);
});

app.get('/me', requireAuth, async (req, res) => {
  const data = await repository.getProfileData(req.user!.id);
  res.render('profile', { title: 'マイページ', ...data });
});

app.get('/members', requireAuth, requireDatabase, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const members = await repository.getMembers(req.user!.id, query);
  res.render('members', { title: 'メンバー', members, query });
});

app.get('/messages', requireAuth, requireDatabase, async (req, res) => {
  const conversations = await repository.getInbox(req.user!.id);
  res.render('messages', { title: 'DM', conversations });
});

app.get('/messages/:userId/events', requireAuth, (req, res) => {
  openEventStream(req, res, directMessageChannel(req.user!.id, String(req.params.userId)));
});

app.get('/messages/:userId', requireAuth, requireDatabase, async (req, res) => {
  const conversation = await repository.getConversation(req.user!.id, String(req.params.userId));
  if (!conversation) return res.status(404).render('error', { title: '相手が見つからなかったよ', status: 404, message: 'メンバー一覧からもう一度探してみてね。' });
  invalidateUserHeader(req.user!.id);
  return res.render('conversation', { title: `${conversation.member.displayName}さんとのDM`, ...conversation });
});

app.post('/messages/:userId', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const peerId = String(req.params.userId);
  const parsed = messageInput.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: 'メッセージを書いてから送ってね。' };
    return res.redirect(`/messages/${peerId}`);
  }
  const message = await repository.createDirectMessage(req.user!.id, peerId, parsed.data.body);
  invalidateUserHeader(peerId);
  publish(directMessageChannel(req.user!.id, peerId), { type: 'message', message });
  if (isAjax(req)) return res.json({ message });
  return res.redirect(`/messages/${peerId}#latest`);
});

const groupNotFound = (res: Response) => res.status(404).render('error', { title: 'そのグループは見つからなかったよ', status: 404, message: '解散したか、URLが違うのかもしれません。' });

app.get('/groups', requireAuth, requireDatabase, async (req, res) => {
  const groups = await repository.getGroups(req.user!.id);
  res.render('groups', { title: 'グループ', groups });
});

app.post('/groups', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const parsed = groupInput.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: 'グループ名（60文字まで）を入れてね。' };
    return res.redirect('/groups');
  }
  const id = await repository.createGroup(req.user!.id, parsed.data);
  invalidateUserHeader(req.user!.id);
  req.session.flash = { type: 'success', message: `グループ「${parsed.data.name}」を作ったよ！` };
  return res.redirect(`/groups/${id}`);
});

app.get('/groups/:id', requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  const group = await repository.getGroup(id, req.user!.id);
  if (!group) return groupNotFound(res);
  const inviteQuery = typeof req.query.invite_q === 'string' ? req.query.invite_q.slice(0, 80) : '';
  const inviteCandidates = group.isOwner && inviteQuery ? await repository.searchInviteCandidates(id, inviteQuery) : [];
  return res.render('group', { title: group.name, group, inviteQuery, inviteCandidates });
});

app.post('/groups/:id/join', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  const joined = await repository.joinGroup(id, req.user!.id);
  invalidateUserHeader(req.user!.id);
  req.session.flash = joined
    ? { type: 'success', message: 'グループに参加したよ！' }
    : { type: 'error', message: 'このグループは招待制です。' };
  return res.redirect(`/groups/${id}`);
});

app.post('/groups/:id/leave', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  const left = await repository.leaveGroup(id, req.user!.id);
  invalidateUserHeader(req.user!.id);
  req.session.flash = left
    ? { type: 'info', message: 'グループを抜けたよ。' }
    : { type: 'error', message: 'オーナーは抜けられません。解散するか、そのまま見守ろう。' };
  return res.redirect(left ? '/groups' : `/groups/${id}`);
});

app.post('/groups/:id/invite', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  const parsed = inviteInput.safeParse(req.body);
  if (!isUuid(id) || !parsed.success) return groupNotFound(res);
  const invited = await repository.inviteToGroup(id, req.user!.id, parsed.data.userId);
  req.session.flash = invited
    ? { type: 'success', message: '招待を送ったよ！' }
    : { type: 'error', message: '招待できなかったよ。すでにメンバーかもしれない。' };
  return res.redirect(`/groups/${id}`);
});

app.post('/groups/:id/invites/accept', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  const accepted = await repository.acceptGroupInvite(id, req.user!.id);
  invalidateUserHeader(req.user!.id);
  req.session.flash = accepted
    ? { type: 'success', message: 'グループに参加したよ！' }
    : { type: 'error', message: '招待が見つからなかったよ。' };
  return res.redirect(accepted ? `/groups/${id}` : '/groups');
});

app.post('/groups/:id/invites/decline', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  await repository.declineGroupInvite(id, req.user!.id);
  req.session.flash = { type: 'info', message: '招待をお断りしたよ。' };
  return res.redirect('/groups');
});

app.post('/groups/:id/delete', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  const deleted = await repository.deleteGroup(id, req.user!.id);
  invalidateUserHeader(req.user!.id);
  req.session.flash = deleted
    ? { type: 'info', message: 'グループを解散したよ。中のボードとチャットも削除されました。' }
    : { type: 'error', message: 'グループを解散できるのはオーナーだけです。' };
  return res.redirect(deleted ? '/groups' : `/groups/${id}`);
});

app.get('/groups/:id/chat', requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  const group = await repository.getGroup(id, req.user!.id);
  if (!group) return groupNotFound(res);
  if (!group.isMember) {
    req.session.flash = { type: 'info', message: 'チャットに入るにはグループに参加してね。' };
    return res.redirect(`/groups/${id}`);
  }
  const messages = await repository.getGroupMessages(id);
  return res.render('group-chat', { title: `${group.name} チャット`, group, messages });
});

app.post('/groups/:id/chat', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return groupNotFound(res);
  const parsed = groupMessageInput.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: 'メッセージを書いてから送ってね。' };
    return res.redirect(`/groups/${id}/chat`);
  }
  try {
    const message = await repository.createGroupMessage(id, req.user!.id, parsed.data.body);
    publish(groupChannel(id), { type: 'gmessage', message });
    if (isAjax(req)) return res.json({ message });
  } catch {
    if (isAjax(req)) return res.status(403).json({ error: 'not-a-member' });
    req.session.flash = { type: 'error', message: 'チャットに参加できるのはメンバーだけです。' };
    return res.redirect(`/groups/${id}`);
  }
  return res.redirect(`/groups/${id}/chat#latest`);
});

app.get('/groups/:id/chat/events', requireAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id) || !(await repository.isGroupMember(id, req.user!.id))) return res.status(403).end();
  return openEventStream(req, res, groupChannel(id));
});

app.get('/admin', requireAdmin, requireDatabase, async (_req, res) => {
  const dashboard = await repository.getAdminDashboard();
  res.render('admin', { title: '管理者パネル', ...dashboard });
});

app.post('/admin/threads/:id/status', writeLimiter, requireAdmin, requireDatabase, async (req, res) => {
  const parsed = z.enum(['published', 'hidden', 'locked', 'deleted']).safeParse(req.body.status);
  if (parsed.success) await repository.updateThreadStatus(String(req.params.id), parsed.data);
  return res.redirect('/admin#threads');
});

app.post('/admin/users/:id/role', writeLimiter, requireAdmin, requireDatabase, async (req, res) => {
  const parsed = z.enum(['member', 'moderator', 'admin']).safeParse(req.body.role);
  if (parsed.success) await repository.updateUserRole(String(req.params.id), parsed.data);
  return res.redirect('/admin#users');
});

app.post('/admin/users/:id/status', writeLimiter, requireAdmin, requireDatabase, async (req, res) => {
  const parsed = z.enum(['active', 'suspended']).safeParse(req.body.status);
  if (parsed.success && String(req.params.id) !== req.user!.id) await repository.updateUserStatus(String(req.params.id), parsed.data);
  return res.redirect('/admin#users');
});

app.post('/admin/reports/:id/status', writeLimiter, requireAdmin, requireDatabase, async (req, res) => {
  const parsed = z.enum(['reviewing', 'resolved', 'dismissed']).safeParse(req.body.status);
  if (parsed.success) await repository.updateReportStatus(String(req.params.id), parsed.data);
  return res.redirect('/admin#reports');
});

app.get('/auth/google', authLimiter, (req, res, next) => {
  if (!config.googleAuthEnabled) {
    req.session.flash = { type: 'info', message: 'Google OAuthのキーを設定するとログインできます。設定方法はREADMEをご覧ください。' };
    return res.redirect('/');
  }
  return passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});

app.get('/auth/google/callback', authLimiter, (req, res, next) => {
  if (!config.googleAuthEnabled) return res.redirect('/');
  return passport.authenticate('google', { failureRedirect: '/?auth=failed' })(req, res, next);
}, (req, res) => {
  req.session.flash = { type: 'success', message: `おかえりなさい、${req.user?.displayName ?? ''}さん。` };
  res.redirect('/');
});

app.post('/logout', (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.regenerate(() => res.redirect('/'));
  });
});

app.get('/health', async (_req, res) => {
  if (config.demoMode && !pool) return res.status(200).json({ status: 'ok', mode: 'demo' });
  const database = await checkDatabase();
  return res.status(database ? 200 : 503).json({ status: database ? 'ok' : 'unhealthy', database });
});

app.use((_req, res) => res.status(404).render('error', { title: 'ページが見つからなかったよ', status: 404, message: 'リンクが古いか、ページが移動したみたいです。' }));

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled request error', { method: req.method, path: req.path, error });
  if (res.headersSent) return;
  res.status(500).render('error', { title: 'ちょっと休憩中です', status: 500, message: '少し待ってから、もう一度試してみてね。' });
});

export { app };
