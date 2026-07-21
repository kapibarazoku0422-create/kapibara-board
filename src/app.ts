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
import { directMessageChannel, publish, subscribe, threadChannel } from './realtime.js';

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
app.use(express.static(path.join(process.cwd(), 'public'), { maxAge: config.isProduction ? '7d' : 0, etag: true }));

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

app.use(async (req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
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
  if (req.user) {
    try {
      res.locals.unreadMessages = await repository.getUnreadMessageCount(req.user.id);
    } catch {
      res.locals.unreadMessages = 0;
    }
  }
  res.locals.formatNumber = (value: number) => new Intl.NumberFormat('ja-JP', { notation: value > 9999 ? 'compact' : 'standard' }).format(value);
  res.locals.formatDate = (value: Date) => new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
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
  req.session.flash = { type: 'info', message: '話題を投稿するなら、Googleアカウントではじめよう。' };
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

const threadInput = z.object({
  categoryId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(100_000),
  tags: z.string().max(500).default(''),
});
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
  if (!data) return res.status(404).render('error', { title: 'そのボードは見つからなかったよ', status: 404, message: 'URLが合っているか、もう一度見てみてね。' });
  return res.render('board', { title: data.category.name, ...data, sort });
});

app.get('/threads/:id', async (req, res) => {
  const thread = await repository.getThread(String(req.params.id), req.user?.id);
  if (!thread) return res.status(404).render('error', { title: 'その話題は見つからなかったよ', status: 404, message: '削除されたか、URLが変わったのかもしれません。' });
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
  req.session.flash = { type: 'success', message: '投稿したよ！' };
  return res.redirect(`/threads/${id}`);
});

app.get('/new', requireAuth, async (_req, res) => {
  const categories = await repository.getCategories();
  res.render('new', { title: '話題をつくる', categories, values: {}, errors: {} });
});

app.post('/threads', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const parsed = threadInput.safeParse(req.body);
  if (!parsed.success) {
    const categories = await repository.getCategories();
    return res.status(422).render('new', { title: '話題をつくる', categories, values: req.body, errors: parsed.error.flatten().fieldErrors });
  }
  const id = await repository.createThread({
    authorId: req.user!.id,
    categoryId: parsed.data.categoryId,
    title: parsed.data.title,
    body: parsed.data.body,
    tags: parsed.data.tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean),
  });
  req.session.flash = { type: 'success', message: '話題を公開したよ！' };
  return res.redirect(`/threads/${id}`);
});

app.post('/threads/:id/posts', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  const parsed = postInput.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: 'ひとこと書いてから送ってね。' };
    return res.redirect(`/threads/${threadId}#reply`);
  }
  const post = await repository.createPost({ threadId, authorId: req.user!.id, body: parsed.data.body });
  publish(threadChannel(threadId), { type: 'post', post });
  req.session.flash = { type: 'success', message: 'コメントを投稿したよ！' };
  return res.redirect(`/threads/${threadId}#latest`);
});

app.get('/threads/:id/events', (req, res) => openEventStream(req, res, threadChannel(String(req.params.id))));

app.post('/threads/:id/like', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  await repository.toggleLike(threadId, req.user!.id);
  res.redirect(`/threads/${threadId}`);
});

app.post('/threads/:id/bookmark', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  const active = await repository.toggleBookmark(threadId, req.user!.id);
  req.session.flash = { type: 'success', message: active ? '「あとで読む」に入れたよ。' : '「あとで読む」から外したよ。' };
  res.redirect(`/threads/${threadId}`);
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
  publish(directMessageChannel(req.user!.id, peerId), { type: 'message', message });
  return res.redirect(`/messages/${peerId}#latest`);
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
