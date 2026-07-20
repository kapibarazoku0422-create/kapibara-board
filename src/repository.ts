import type { Profile } from 'passport-google-oauth20';
import { pool } from './db.js';
import type { Category, HomeData, Post, ThreadDetail, ThreadSummary, User } from './types.js';

const demoUsers: User[] = [
  { id: 'demo-a', email: 'aoi@example.com', displayName: 'あおい', avatarUrl: null, role: 'member' },
  { id: 'demo-b', email: 'ren@example.com', displayName: 'Ren', avatarUrl: null, role: 'moderator' },
  { id: 'demo-c', email: 'mugi@example.com', displayName: 'むぎ', avatarUrl: null, role: 'member' },
];

const demoCategories: Category[] = [
  { id: 1, slug: 'lounge', name: 'ラウンジ', description: '日常のこと、ふと思ったこと', icon: '☕', color: '#ff6b4a', threadCount: 1284 },
  { id: 2, slug: 'technology', name: 'テクノロジー', description: '開発・AI・ガジェットの話', icon: '⌘', color: '#6c5ce7', threadCount: 842 },
  { id: 3, slug: 'creative', name: 'クリエイティブ', description: '写真、音楽、文章、ものづくり', icon: '✦', color: '#e84393', threadCount: 516 },
  { id: 4, slug: 'questions', name: '質問・相談', description: 'みんなの知恵を借りよう', icon: '?', color: '#0984e3', threadCount: 934 },
  { id: 5, slug: 'local', name: 'ローカル', description: '街・イベント・おでかけ情報', icon: '⌖', color: '#00a884', threadCount: 375 },
];

const now = Date.now();
const demoThreads: ThreadSummary[] = [
  makeDemo('11111111-1111-4111-8111-111111111111', '最近「余白」を大切にしている人、いますか？', '予定を詰めすぎない日を作ったら、考えが少しずつ整ってきました。みなさんの余白の作り方を聞きたいです。', 1, demoUsers[0]!, 48, 3120, 186, ['暮らし', '雑談'], 18, true),
  makeDemo('22222222-2222-4222-8222-222222222222', '個人開発で最初の100人に使ってもらうまで', '小さなサービスを公開して3か月。やってよかったことと、完全に遠回りだったことをまとめます。', 2, demoUsers[1]!, 32, 2451, 142, ['個人開発', 'プロダクト'], 52),
  makeDemo('33333333-3333-4333-8333-333333333333', 'あなたの「作業がはかどる音」を教えて', '雨音、カフェの環境音、無音。集中したいとき、どんな音を選んでいますか？', 3, demoUsers[2]!, 67, 1980, 97, ['音楽', '集中'], 87),
  makeDemo('44444444-4444-4444-8444-444444444444', '転職するか迷っています。判断軸を一緒に整理したい', '今の環境に大きな不満はないけれど、新しい挑戦にも惹かれています。経験談を聞かせてください。', 4, demoUsers[0]!, 24, 1204, 64, ['仕事', '相談'], 124),
  makeDemo('55555555-5555-4555-8555-555555555555', '週末に行ける、静かな場所を共有しよう', '有名スポットじゃなくても大丈夫。自分だけの落ち着く場所を教えてください。', 5, demoUsers[2]!, 19, 876, 51, ['週末', 'おすすめ'], 205),
  makeDemo('66666666-6666-4666-8666-666666666666', '生成AI時代に、あえて手で書くこと', '便利な道具が増えた今、ノートに手で書く時間の意味を考えています。', 2, demoUsers[1]!, 15, 743, 73, ['AI', 'ノート'], 310),
];

function makeDemo(id: string, title: string, excerpt: string, categoryId: number, author: User, replies: number, views: number, likes: number, tags: string[], minutesAgo: number, pinned = false): ThreadSummary {
  const category = demoCategories.find((item) => item.id === categoryId)!;
  return {
    id,
    title,
    excerpt,
    tags,
    categorySlug: category.slug,
    categoryName: category.name,
    categoryColor: category.color,
    authorName: author.displayName,
    authorAvatar: author.avatarUrl,
    authorInitial: author.displayName.slice(0, 1).toUpperCase(),
    replyCount: replies,
    viewCount: views,
    likeCount: likes,
    isPinned: pinned,
    createdAt: new Date(now - (minutesAgo + 300) * 60_000),
    lastActivityAt: new Date(now - minutesAgo * 60_000),
  };
}

function mapThread(row: Record<string, unknown>): ThreadSummary {
  const name = String(row.author_name);
  return {
    id: String(row.id),
    title: String(row.title),
    excerpt: String(row.excerpt ?? ''),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    categorySlug: String(row.category_slug),
    categoryName: String(row.category_name),
    categoryColor: String(row.category_color),
    authorName: name,
    authorAvatar: row.author_avatar ? String(row.author_avatar) : null,
    authorInitial: name.slice(0, 1).toUpperCase(),
    replyCount: Number(row.reply_count),
    viewCount: Number(row.view_count),
    likeCount: Number(row.like_count),
    isPinned: Boolean(row.is_pinned),
    createdAt: new Date(String(row.created_at)),
    lastActivityAt: new Date(String(row.last_activity_at)),
  };
}

const threadSelect = `
  SELECT t.id, t.title, LEFT(t.body, 180) AS excerpt, t.tags, t.reply_count,
    t.view_count, t.like_count, t.is_pinned, t.created_at, t.last_activity_at,
    c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
    u.display_name AS author_name, u.avatar_url AS author_avatar
  FROM threads t
  JOIN categories c ON c.id = t.category_id
  JOIN users u ON u.id = t.author_id
`;

export async function getCategories(): Promise<Category[]> {
  if (!pool) return demoCategories;
  const result = await pool.query(`
    SELECT c.id, c.slug, c.name, c.description, c.icon, c.color,
      COUNT(t.id)::int AS thread_count
    FROM categories c
    LEFT JOIN threads t ON t.category_id = c.id AND t.status = 'published'
    GROUP BY c.id
    ORDER BY c.sort_order, c.id
  `);
  return result.rows.map((row) => ({
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    icon: String(row.icon),
    color: String(row.color),
    threadCount: Number(row.thread_count),
  }));
}

export async function getHomeData(sort = 'active', categorySlug?: string): Promise<HomeData> {
  if (!pool) {
    let threads = categorySlug ? demoThreads.filter((thread) => thread.categorySlug === categorySlug) : [...demoThreads];
    if (sort === 'popular') threads.sort((a, b) => b.likeCount - a.likeCount);
    if (sort === 'new') threads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      categories: demoCategories,
      threads,
      trending: [...demoThreads].sort((a, b) => b.likeCount - a.likeCount).slice(0, 4),
      stats: { members: 12840, threads: 3951, posts: 48729, online: 238 },
    };
  }

  const order = sort === 'popular' ? 't.like_count DESC, t.last_activity_at DESC' : sort === 'new' ? 't.created_at DESC' : 't.is_pinned DESC, t.last_activity_at DESC';
  const params: string[] = [];
  const categoryWhere = categorySlug ? 'AND c.slug = $1' : '';
  if (categorySlug) params.push(categorySlug);
  const [categories, threads, trending, counts] = await Promise.all([
    getCategories(),
    pool.query(`${threadSelect} WHERE t.status = 'published' ${categoryWhere} ORDER BY ${order} LIMIT 30`, params),
    pool.query(`${threadSelect} WHERE t.status = 'published' AND t.created_at > NOW() - INTERVAL '14 days' ORDER BY (t.like_count * 3 + t.reply_count * 2 + t.view_count / 20) DESC LIMIT 5`),
    pool.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE status = 'active')::int AS members,
      (SELECT COUNT(*) FROM threads WHERE status = 'published')::int AS threads,
      (SELECT COUNT(*) FROM posts WHERE status = 'published')::int AS posts`),
  ]);
  return {
    categories,
    threads: threads.rows.map(mapThread),
    trending: trending.rows.map(mapThread),
    stats: { ...counts.rows[0], online: Math.max(1, Math.round(Number(counts.rows[0].members) * 0.018)) },
  } as HomeData;
}

export async function getCategory(slug: string, sort: string): Promise<{ category: Category; threads: ThreadSummary[] } | null> {
  const home = await getHomeData(sort, slug);
  const category = home.categories.find((item) => item.slug === slug);
  return category ? { category, threads: home.threads } : null;
}

export async function searchThreads(query: string): Promise<ThreadSummary[]> {
  const cleaned = query.trim().slice(0, 80);
  if (!cleaned) return [];
  if (!pool) {
    const lowered = cleaned.toLowerCase();
    return demoThreads.filter((thread) => `${thread.title} ${thread.excerpt} ${thread.tags.join(' ')}`.toLowerCase().includes(lowered));
  }
  const result = await pool.query(`${threadSelect}
    WHERE t.status = 'published'
      AND (
        t.search_document @@ websearch_to_tsquery('simple', $1)
        OR t.title ILIKE '%' || $1 || '%'
        OR t.body ILIKE '%' || $1 || '%'
        OR EXISTS (SELECT 1 FROM unnest(t.tags) AS tag WHERE tag ILIKE '%' || $1 || '%')
      )
    ORDER BY
      CASE WHEN t.title ILIKE '%' || $1 || '%' THEN 0 ELSE 1 END,
      ts_rank(t.search_document, websearch_to_tsquery('simple', $1)) DESC,
      t.last_activity_at DESC
    LIMIT 50`, [cleaned]);
  return result.rows.map(mapThread);
}

export async function getThread(id: string, viewerId?: string): Promise<ThreadDetail | null> {
  if (!pool) {
    const summary = demoThreads.find((thread) => thread.id === id);
    if (!summary) return null;
    const originalAuthor = demoUsers.find((user) => user.displayName === summary.authorName)!;
    const replies: Post[] = Array.from({ length: Math.min(summary.replyCount, 8) }, (_, index) => {
      const author = demoUsers[(index + 1) % demoUsers.length]!;
      const samples = [
        'すごくわかります。予定を入れない時間を、先にカレンダーへ置いておくようにしています。何もしない時間も予定のひとつですね。',
        '散歩の途中でスマートフォンを見ないようにしたら、考えごとが自然にまとまるようになりました。',
        'みなさんの話が参考になります。私は朝の30分だけ通知を全部切るのを試しています。',
      ];
      return { id: `demo-post-${index}`, body: samples[index % samples.length]!, authorId: author.id, authorName: author.displayName, authorAvatar: null, authorInitial: author.displayName.slice(0, 1), authorRole: author.role, createdAt: new Date(now - (120 - index * 12) * 60_000), isSolution: index === 1, number: index + 1 };
    });
    return { ...summary, body: summary.excerpt, authorId: originalAuthor.id, likedByViewer: false, bookmarkedByViewer: false, posts: replies };
  }

  await pool.query('UPDATE threads SET view_count = view_count + 1 WHERE id = $1 AND status = $2', [id, 'published']);
  const [threadResult, postsResult] = await Promise.all([
    pool.query(`${threadSelect.replace('SELECT t.id,', `SELECT t.author_id, t.body, t.id,`)}
      WHERE t.id = $1 AND t.status = 'published'`, [id]),
    pool.query(`SELECT p.id, p.body, p.author_id, p.created_at, p.is_solution,
        u.display_name AS author_name, u.avatar_url AS author_avatar, u.role AS author_role,
        ROW_NUMBER() OVER (ORDER BY p.created_at, p.id)::int AS number
      FROM posts p JOIN users u ON u.id = p.author_id
      WHERE p.thread_id = $1 AND p.status = 'published'
      ORDER BY p.created_at, p.id LIMIT 500`, [id]),
  ]);
  if (!threadResult.rowCount) return null;
  const row = threadResult.rows[0];
  const [liked, bookmarked] = viewerId
    ? await Promise.all([
        pool.query('SELECT 1 FROM thread_likes WHERE thread_id = $1 AND user_id = $2', [id, viewerId]),
        pool.query('SELECT 1 FROM bookmarks WHERE thread_id = $1 AND user_id = $2', [id, viewerId]),
      ])
    : [{ rowCount: 0 }, { rowCount: 0 }];
  return {
    ...mapThread(row),
    body: String(row.body),
    authorId: String(row.author_id),
    likedByViewer: Boolean(liked.rowCount),
    bookmarkedByViewer: Boolean(bookmarked.rowCount),
    posts: postsResult.rows.map((post) => {
      const name = String(post.author_name);
      return { id: String(post.id), body: String(post.body), authorId: String(post.author_id), authorName: name, authorAvatar: post.author_avatar ? String(post.author_avatar) : null, authorInitial: name.slice(0, 1).toUpperCase(), authorRole: post.author_role, createdAt: new Date(post.created_at), isSolution: Boolean(post.is_solution), number: Number(post.number) } as Post;
    }),
  };
}

export async function createThread(input: { authorId: string; categoryId: number; title: string; body: string; tags: string[] }): Promise<string> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(
    `INSERT INTO threads (author_id, category_id, title, body, tags)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.authorId, input.categoryId, input.title, input.body, input.tags.slice(0, 5)],
  );
  return String(result.rows[0].id);
}

export async function createPost(input: { threadId: string; authorId: string; body: string }): Promise<void> {
  if (!pool) throw new Error('Database is not connected');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO posts (thread_id, author_id, body) VALUES ($1, $2, $3)', [input.threadId, input.authorId, input.body]);
    await client.query(`UPDATE threads SET reply_count = reply_count + 1, last_activity_at = NOW() WHERE id = $1 AND status = 'published'`, [input.threadId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function toggleLike(threadId: string, userId: string): Promise<boolean> {
  if (!pool) throw new Error('Database is not connected');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query('DELETE FROM thread_likes WHERE thread_id = $1 AND user_id = $2 RETURNING 1', [threadId, userId]);
    const active = !deleted.rowCount;
    if (active) await client.query('INSERT INTO thread_likes (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [threadId, userId]);
    await client.query(`UPDATE threads SET like_count = (SELECT COUNT(*) FROM thread_likes WHERE thread_id = $1) WHERE id = $1`, [threadId]);
    await client.query('COMMIT');
    return active;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function toggleBookmark(threadId: string, userId: string): Promise<boolean> {
  if (!pool) throw new Error('Database is not connected');
  const deleted = await pool.query('DELETE FROM bookmarks WHERE thread_id = $1 AND user_id = $2 RETURNING 1', [threadId, userId]);
  if (deleted.rowCount) return false;
  await pool.query('INSERT INTO bookmarks (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [threadId, userId]);
  return true;
}

export async function getProfileData(userId: string): Promise<{ authored: ThreadSummary[]; bookmarked: ThreadSummary[] }> {
  if (!pool) return { authored: [], bookmarked: [] };
  const [authored, bookmarked] = await Promise.all([
    pool.query(`${threadSelect} WHERE t.author_id = $1 AND t.status = 'published' ORDER BY t.created_at DESC LIMIT 20`, [userId]),
    pool.query(`${threadSelect} JOIN bookmarks b ON b.thread_id = t.id WHERE b.user_id = $1 AND t.status = 'published' ORDER BY b.created_at DESC LIMIT 20`, [userId]),
  ]);
  return { authored: authored.rows.map(mapThread), bookmarked: bookmarked.rows.map(mapThread) };
}

export async function findUserById(id: string): Promise<User | null> {
  if (!pool) return demoUsers.find((user) => user.id === id) ?? null;
  const result = await pool.query('SELECT id, email, display_name, avatar_url, bio, role, created_at FROM users WHERE id = $1 AND status = $2', [id, 'active']);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: String(row.id), email: String(row.email), displayName: String(row.display_name), avatarUrl: row.avatar_url, bio: row.bio, role: row.role, createdAt: new Date(row.created_at) };
}

export async function upsertGoogleUser(profile: Profile): Promise<User> {
  if (!pool) throw new Error('Database is not connected');
  const email = profile.emails?.[0]?.value?.toLowerCase();
  if (!email) throw new Error('Google account did not provide an email address');
  const avatar = profile.photos?.[0]?.value ?? null;
  const result = await pool.query(`
    INSERT INTO users (google_sub, email, display_name, avatar_url, last_login_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      last_login_at = NOW(),
      updated_at = NOW()
    RETURNING id, email, display_name, avatar_url, bio, role, created_at
  `, [profile.id, email, profile.displayName || email.split('@')[0], avatar]);
  const row = result.rows[0];
  return { id: String(row.id), email: String(row.email), displayName: String(row.display_name), avatarUrl: row.avatar_url, bio: row.bio, role: row.role, createdAt: new Date(row.created_at) };
}
