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
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(process.cwd(), 'public'), { maxAge: config.isProduction ? '7d' : 0, etag: true }));

const PgStore = connectPgSimple(session);
app.use(
  session({
    name: 'yohaku.sid',
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

app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.currentUser = req.user ?? null;
  res.locals.currentPath = req.path;
  res.locals.googleAuthEnabled = config.googleAuthEnabled;
  res.locals.demoMode = config.demoMode;
  res.locals.flash = req.session.flash ?? null;
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
  req.session.flash = { type: 'info', message: '投稿するにはGoogleアカウントで参加してください。' };
  return res.redirect('/');
}

function requireDatabase(req: Request, res: Response, next: NextFunction) {
  if (pool) return next();
  req.session.flash = { type: 'info', message: '現在はプレビューモードです。PostgreSQLを接続すると投稿できます。' };
  return res.redirect(req.get('referer') || '/');
}

const threadInput = z.object({
  categoryId: z.coerce.number().int().positive(),
  title: z.string().trim().min(5).max(120),
  body: z.string().trim().min(20).max(20_000),
  tags: z.string().max(120).default(''),
});
const postInput = z.object({ body: z.string().trim().min(2).max(10_000) });

app.get('/', async (req, res) => {
  const sort = ['active', 'popular', 'new'].includes(String(req.query.sort)) ? String(req.query.sort) : 'active';
  const data = await repository.getHomeData(sort);
  res.render('home', { title: '話したいことに、居場所を。', ...data, sort });
});

app.get('/boards/:slug', async (req, res) => {
  const sort = ['active', 'popular', 'new'].includes(String(req.query.sort)) ? String(req.query.sort) : 'active';
  const data = await repository.getCategory(req.params.slug, sort);
  if (!data) return res.status(404).render('error', { title: 'ボードが見つかりません', status: 404, message: 'URLをご確認ください。' });
  return res.render('board', { title: data.category.name, ...data, sort });
});

app.get('/threads/:id', async (req, res) => {
  const thread = await repository.getThread(String(req.params.id), req.user?.id);
  if (!thread) return res.status(404).render('error', { title: 'スレッドが見つかりません', status: 404, message: '削除されたか、URLが間違っている可能性があります。' });
  return res.render('thread', { title: thread.title, thread });
});

app.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  const threads = await repository.searchThreads(query);
  res.render('search', { title: query ? `「${query}」の検索結果` : '検索', query, threads });
});

app.get('/new', requireAuth, async (_req, res) => {
  const categories = await repository.getCategories();
  res.render('new', { title: '新しいスレッド', categories, values: {}, errors: {} });
});

app.post('/threads', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const parsed = threadInput.safeParse(req.body);
  if (!parsed.success) {
    const categories = await repository.getCategories();
    return res.status(422).render('new', { title: '新しいスレッド', categories, values: req.body, errors: parsed.error.flatten().fieldErrors });
  }
  const id = await repository.createThread({
    authorId: req.user!.id,
    categoryId: parsed.data.categoryId,
    title: parsed.data.title,
    body: parsed.data.body,
    tags: parsed.data.tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean),
  });
  req.session.flash = { type: 'success', message: 'スレッドを公開しました。' };
  return res.redirect(`/threads/${id}`);
});

app.post('/threads/:id/posts', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  const parsed = postInput.safeParse(req.body);
  if (!parsed.success) {
    req.session.flash = { type: 'error', message: '返信は2文字以上で入力してください。' };
    return res.redirect(`/threads/${threadId}#reply`);
  }
  await repository.createPost({ threadId, authorId: req.user!.id, body: parsed.data.body });
  req.session.flash = { type: 'success', message: '返信を投稿しました。' };
  return res.redirect(`/threads/${threadId}#latest`);
});

app.post('/threads/:id/like', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  await repository.toggleLike(threadId, req.user!.id);
  res.redirect(`/threads/${threadId}`);
});

app.post('/threads/:id/bookmark', writeLimiter, requireAuth, requireDatabase, async (req, res) => {
  const threadId = String(req.params.id);
  const active = await repository.toggleBookmark(threadId, req.user!.id);
  req.session.flash = { type: 'success', message: active ? 'あとで読むに保存しました。' : '保存を解除しました。' };
  res.redirect(`/threads/${threadId}`);
});

app.get('/me', requireAuth, async (req, res) => {
  const data = await repository.getProfileData(req.user!.id);
  res.render('profile', { title: 'マイページ', ...data });
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

app.use((_req, res) => res.status(404).render('error', { title: 'ページが見つかりません', status: 404, message: 'リンクが古いか、ページが移動したようです。' }));

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled request error', { method: req.method, path: req.path, error });
  if (res.headersSent) return;
  res.status(500).render('error', { title: '少し時間をおいてください', status: 500, message: '予期しないエラーが発生しました。問題が続く場合は管理者へお知らせください。' });
});

export { app };
