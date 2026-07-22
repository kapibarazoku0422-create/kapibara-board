import type { Profile } from 'passport-google-oauth20';
import { pool } from './db.js';
import type { AdminDashboard, Category, ConversationSummary, DirectMessage, GroupDetail, GroupMessage, GroupSummary, HomeData, MemberSummary, Post, ThreadDetail, ThreadSummary, User } from './types.js';

const demoUsers: User[] = [
  { id: 'demo-a', email: 'aoi@example.com', displayName: 'あおい', avatarUrl: null, role: 'member' },
  { id: 'demo-b', email: 'ren@example.com', displayName: 'Ren', avatarUrl: null, role: 'moderator' },
  { id: 'demo-c', email: 'mugi@example.com', displayName: 'むぎ', avatarUrl: null, role: 'member' },
];

const demoCategories: Category[] = [
  { id: 6, slug: 'general', name: '総合', description: 'すべてのジャンルのボードが集まる場所', icon: '◎', color: '#d35400', threadCount: 3951 },
  { id: 1, slug: 'lounge', name: 'ラウンジ', description: '日常のこと、ふと思ったこと', icon: '☕', color: '#ff6b4a', threadCount: 1284 },
  { id: 2, slug: 'technology', name: 'テクノロジー', description: '開発・AI・ガジェットの話', icon: '⌘', color: '#6c5ce7', threadCount: 842 },
  { id: 3, slug: 'creative', name: 'クリエイティブ', description: '写真、音楽、文章、ものづくり', icon: '✦', color: '#e84393', threadCount: 516 },
  { id: 4, slug: 'questions', name: '質問・相談', description: 'みんなの知恵を借りよう', icon: '?', color: '#0984e3', threadCount: 934 },
  { id: 5, slug: 'local', name: 'ローカル', description: '街・イベント・おでかけ情報', icon: '⌖', color: '#00a884', threadCount: 375 },
];

const now = Date.now();
const demoThreads: ThreadSummary[] = [
  makeDemo('11111111-1111-4111-8111-111111111111', '最近ハマっているもの、ゆるく教えて！', 'ゲームでも音楽でも食べ物でも何でもOK。最近つい時間を忘れて楽しんでいるものを教えてください。', 1, demoUsers[0]!, 48, 3120, 186, ['雑談', 'おすすめ'], 18, true),
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
      CASE WHEN c.slug = 'general'
        THEN (SELECT COUNT(*)::int FROM threads WHERE status IN ('published', 'locked') AND group_id IS NULL)
        ELSE COUNT(t.id)::int
      END AS thread_count
    FROM categories c
    LEFT JOIN threads t ON t.category_id = c.id AND t.status IN ('published', 'locked') AND t.group_id IS NULL
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
    let threads = categorySlug && categorySlug !== 'general' ? demoThreads.filter((thread) => thread.categorySlug === categorySlug) : [...demoThreads];
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
  const categoryWhere = categorySlug && categorySlug !== 'general' ? 'AND c.slug = $1' : '';
  if (categorySlug && categorySlug !== 'general') params.push(categorySlug);
  const [categories, threads, trending, counts] = await Promise.all([
    getCategories(),
    pool.query(`${threadSelect} WHERE t.status IN ('published', 'locked') AND t.group_id IS NULL ${categoryWhere} ORDER BY ${order} LIMIT 30`, params),
    pool.query(`${threadSelect} WHERE t.status IN ('published', 'locked') AND t.group_id IS NULL AND t.created_at > NOW() - INTERVAL '14 days' ORDER BY (t.like_count * 3 + t.reply_count * 2 + t.view_count / 20) DESC LIMIT 5`),
    pool.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE status = 'active')::int AS members,
      (SELECT COUNT(*) FROM threads WHERE status IN ('published', 'locked') AND group_id IS NULL)::int AS threads,
      (SELECT COUNT(*) FROM posts p JOIN threads pt ON pt.id = p.thread_id WHERE p.status = 'published' AND pt.group_id IS NULL)::int AS posts`),
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
      AND t.group_id IS NULL
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
    return { ...summary, body: summary.excerpt, authorId: originalAuthor.id, likedByViewer: false, bookmarkedByViewer: false, status: 'published', posts: replies, groupId: null, groupName: null, groupVisibility: null };
  }

  void pool.query(`UPDATE threads SET view_count = view_count + 1 WHERE id = $1 AND status IN ('published', 'locked')`, [id]).catch(() => {});
  const [threadResult, postsResult] = await Promise.all([
    pool.query(`${threadSelect
      .replace('SELECT t.id,', `SELECT t.author_id, t.body, t.status, t.group_id, g.name AS group_name, g.visibility AS group_visibility, t.id,`)
      .replace('FROM threads t', 'FROM threads t LEFT JOIN groups g ON g.id = t.group_id')}
      WHERE t.id = $1 AND t.status IN ('published', 'locked')`, [id]),
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
    status: String(row.status) as 'published' | 'locked',
    groupId: row.group_id ? String(row.group_id) : null,
    groupName: row.group_name ? String(row.group_name) : null,
    groupVisibility: row.group_visibility ? (String(row.group_visibility) as 'public' | 'private') : null,
    posts: postsResult.rows.map((post) => {
      const name = String(post.author_name);
      return { id: String(post.id), body: String(post.body), authorId: String(post.author_id), authorName: name, authorAvatar: post.author_avatar ? String(post.author_avatar) : null, authorInitial: name.slice(0, 1).toUpperCase(), authorRole: post.author_role, createdAt: new Date(post.created_at), isSolution: Boolean(post.is_solution), number: Number(post.number) } as Post;
    }),
  };
}

export async function createThread(input: { authorId: string; categoryId: number; title: string; body: string; tags: string[]; groupId?: string | null }): Promise<string> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(
    `INSERT INTO threads (author_id, category_id, title, body, tags, group_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.authorId, input.categoryId, input.title, input.body, input.tags.slice(0, 5), input.groupId ?? null],
  );
  return String(result.rows[0].id);
}

export async function createPost(input: { threadId: string; authorId: string; body: string }): Promise<Post> {
  if (!pool) throw new Error('Database is not connected');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO posts (thread_id, author_id, body)
      SELECT $1, $2, $3 FROM threads WHERE id = $1 AND status = 'published'
      RETURNING id, body, author_id, created_at`, [input.threadId, input.authorId, input.body]);
    if (!inserted.rowCount) throw new Error('Thread is unavailable or locked');
    await client.query(`UPDATE threads SET reply_count = reply_count + 1, last_activity_at = NOW() WHERE id = $1`, [input.threadId]);
    const author = await client.query('SELECT display_name, avatar_url, role FROM users WHERE id = $1', [input.authorId]);
    await client.query('COMMIT');
    const row = inserted.rows[0];
    const authorRow = author.rows[0];
    const name = String(authorRow.display_name);
    return {
      id: String(row.id),
      body: String(row.body),
      authorId: String(row.author_id),
      authorName: name,
      authorAvatar: authorRow.avatar_url ? String(authorRow.avatar_url) : null,
      authorInitial: name.slice(0, 1).toUpperCase(),
      authorRole: authorRow.role,
      createdAt: new Date(row.created_at),
      isSolution: false,
      number: 0,
    };
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

export async function getCategoryId(slug: string): Promise<number | null> {
  if (!pool) return demoCategories.find((category) => category.slug === slug)?.id ?? null;
  const result = await pool.query('SELECT id FROM categories WHERE slug = $1', [slug]);
  return result.rowCount ? Number(result.rows[0].id) : null;
}

export async function getMembers(viewerId: string, query = ''): Promise<MemberSummary[]> {
  if (!pool) return demoUsers.filter((user) => user.id !== viewerId).map((user) => ({
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio ?? null,
    role: user.role,
    createdAt: user.createdAt ?? new Date(),
  }));
  const cleaned = query.trim().slice(0, 80);
  const result = await pool.query(`SELECT id, display_name, avatar_url, bio, role, created_at
    FROM users
    WHERE status = 'active' AND id <> $1
      AND ($2 = '' OR display_name ILIKE '%' || $2 || '%')
    ORDER BY last_login_at DESC NULLS LAST, created_at DESC
    LIMIT 100`, [viewerId, cleaned]);
  return result.rows.map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    bio: row.bio ? String(row.bio) : null,
    role: row.role,
    createdAt: new Date(row.created_at),
  }));
}

export async function getUnreadMessageCount(userId: string): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM direct_messages WHERE recipient_id = $1 AND read_at IS NULL', [userId]);
  return Number(result.rows[0].count);
}

export async function getInbox(userId: string): Promise<ConversationSummary[]> {
  if (!pool) return [];
  const result = await pool.query(`WITH mine AS (
      SELECT dm.*, CASE WHEN dm.sender_id = $1 THEN dm.recipient_id ELSE dm.sender_id END AS peer_id
      FROM direct_messages dm
      WHERE dm.sender_id = $1 OR dm.recipient_id = $1
    ), latest AS (
      SELECT DISTINCT ON (peer_id) peer_id, body, created_at
      FROM mine ORDER BY peer_id, created_at DESC, id DESC
    )
    SELECT l.body, l.created_at, u.id, u.display_name, u.avatar_url, u.bio, u.role, u.created_at AS user_created_at,
      (SELECT COUNT(*)::int FROM direct_messages unread
       WHERE unread.sender_id = l.peer_id AND unread.recipient_id = $1 AND unread.read_at IS NULL) AS unread_count
    FROM latest l JOIN users u ON u.id = l.peer_id
    WHERE u.status = 'active'
    ORDER BY l.created_at DESC`, [userId]);
  return result.rows.map((row) => ({
    member: {
      id: String(row.id),
      displayName: String(row.display_name),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      bio: row.bio ? String(row.bio) : null,
      role: row.role,
      createdAt: new Date(row.user_created_at),
    },
    lastMessage: String(row.body),
    lastMessageAt: new Date(row.created_at),
    unreadCount: Number(row.unread_count),
  }));
}

export async function getConversation(userId: string, peerId: string): Promise<{ member: MemberSummary; messages: DirectMessage[] } | null> {
  if (!pool) return null;
  const memberResult = await pool.query(`SELECT id, display_name, avatar_url, bio, role, created_at
    FROM users WHERE id = $1 AND status = 'active'`, [peerId]);
  if (!memberResult.rowCount || peerId === userId) return null;
  await pool.query(`UPDATE direct_messages SET read_at = NOW()
    WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL`, [peerId, userId]);
  const result = await pool.query(`SELECT id, sender_id, recipient_id, body, read_at, created_at FROM (
      SELECT id, sender_id, recipient_id, body, read_at, created_at
      FROM direct_messages
      WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
      ORDER BY created_at DESC, id DESC LIMIT 300
    ) recent ORDER BY created_at, id`, [userId, peerId]);
  const row = memberResult.rows[0];
  return {
    member: {
      id: String(row.id),
      displayName: String(row.display_name),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      bio: row.bio ? String(row.bio) : null,
      role: row.role,
      createdAt: new Date(row.created_at),
    },
    messages: result.rows.map((message) => ({
      id: String(message.id),
      senderId: String(message.sender_id),
      recipientId: String(message.recipient_id),
      body: String(message.body),
      readAt: message.read_at ? new Date(message.read_at) : null,
      createdAt: new Date(message.created_at),
    })),
  };
}

export async function createDirectMessage(senderId: string, recipientId: string, body: string): Promise<DirectMessage> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(`INSERT INTO direct_messages (sender_id, recipient_id, body)
    SELECT $1, $2, $3 FROM users WHERE id = $2 AND status = 'active' AND $1 <> $2
    RETURNING id, sender_id, recipient_id, body, read_at, created_at`, [senderId, recipientId, body]);
  if (!result.rowCount) throw new Error('Recipient is unavailable');
  const row = result.rows[0];
  return {
    id: String(row.id),
    senderId: String(row.sender_id),
    recipientId: String(row.recipient_id),
    body: String(row.body),
    readAt: null,
    createdAt: new Date(row.created_at),
  };
}

export async function createReport(reporterId: string, threadId: string, reason: string, detail: string): Promise<void> {
  if (!pool) throw new Error('Database is not connected');
  await pool.query(`INSERT INTO reports (reporter_id, thread_id, reason, detail)
    SELECT $1, id, $3, NULLIF($4, '') FROM threads WHERE id = $2 AND status IN ('published', 'locked')`, [reporterId, threadId, reason, detail]);
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  if (!pool) throw new Error('Database is not connected');
  const [stats, users, threads, reports] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE status = 'active')::int AS users,
      (SELECT COUNT(*) FROM threads WHERE status <> 'deleted')::int AS threads,
      (SELECT COUNT(*) FROM posts WHERE status = 'published')::int AS posts,
      (SELECT COUNT(*) FROM reports WHERE status IN ('open', 'reviewing'))::int AS open_reports`),
    pool.query(`SELECT u.id, u.email, u.display_name, u.avatar_url, u.bio, u.role, u.status, u.created_at,
      COUNT(t.id)::int AS thread_count
      FROM users u LEFT JOIN threads t ON t.author_id = u.id AND t.status <> 'deleted'
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100`),
    pool.query(`${threadSelect.replace('SELECT t.id,', 'SELECT t.status, t.id,')}
      WHERE t.status <> 'deleted' ORDER BY t.created_at DESC LIMIT 100`),
    pool.query(`SELECT r.id, r.reason, r.detail, r.status, r.created_at, r.thread_id,
      reporter.display_name AS reporter_name, t.title AS thread_title
      FROM reports r JOIN users reporter ON reporter.id = r.reporter_id
      LEFT JOIN threads t ON t.id = r.thread_id
      ORDER BY CASE WHEN r.status IN ('open', 'reviewing') THEN 0 ELSE 1 END, r.created_at DESC LIMIT 100`),
  ]);
  return {
    stats: {
      users: Number(stats.rows[0].users),
      threads: Number(stats.rows[0].threads),
      posts: Number(stats.rows[0].posts),
      openReports: Number(stats.rows[0].open_reports),
    },
    users: users.rows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      displayName: String(row.display_name),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      bio: row.bio ? String(row.bio) : null,
      role: row.role,
      status: row.status,
      createdAt: new Date(row.created_at),
      threadCount: Number(row.thread_count),
    })),
    threads: threads.rows.map((row) => ({ ...mapThread(row), status: String(row.status) })),
    reports: reports.rows.map((row) => ({
      id: String(row.id),
      reason: String(row.reason),
      detail: row.detail ? String(row.detail) : null,
      status: String(row.status),
      createdAt: new Date(row.created_at),
      reporterName: String(row.reporter_name),
      threadId: row.thread_id ? String(row.thread_id) : null,
      threadTitle: row.thread_title ? String(row.thread_title) : null,
    })),
  };
}

export async function updateThreadStatus(threadId: string, status: 'published' | 'hidden' | 'locked' | 'deleted'): Promise<void> {
  if (!pool) throw new Error('Database is not connected');
  await pool.query('UPDATE threads SET status = $2, updated_at = NOW() WHERE id = $1', [threadId, status]);
}

export async function updateUserRole(userId: string, role: 'member' | 'moderator' | 'admin'): Promise<void> {
  if (!pool) throw new Error('Database is not connected');
  await pool.query('UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1', [userId, role]);
}

export async function updateUserStatus(userId: string, status: 'active' | 'suspended'): Promise<void> {
  if (!pool) throw new Error('Database is not connected');
  await pool.query('UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1', [userId, status]);
}

export async function updateReportStatus(reportId: string, status: 'reviewing' | 'resolved' | 'dismissed'): Promise<void> {
  if (!pool) throw new Error('Database is not connected');
  await pool.query('UPDATE reports SET status = $2 WHERE id = $1', [reportId, status]);
}

const groupSelect = `
  SELECT g.id, g.name, g.description, g.visibility, g.owner_id, g.created_at, owner.display_name AS owner_name,
    (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
    (SELECT COUNT(*)::int FROM threads t WHERE t.group_id = g.id AND t.status IN ('published', 'locked')) AS board_count,
    EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1) AS is_member,
    EXISTS (SELECT 1 FROM group_invites gi WHERE gi.group_id = g.id AND gi.user_id = $1) AS is_invited
  FROM groups g
  JOIN users owner ON owner.id = g.owner_id
`;

function mapGroup(row: Record<string, unknown>, viewerId: string): GroupSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    visibility: String(row.visibility) as 'public' | 'private',
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name),
    memberCount: Number(row.member_count),
    boardCount: Number(row.board_count),
    isMember: Boolean(row.is_member),
    isOwner: String(row.owner_id) === viewerId,
    isInvited: Boolean(row.is_invited),
    createdAt: new Date(String(row.created_at)),
  };
}

export async function getGroups(viewerId: string): Promise<GroupSummary[]> {
  if (!pool) return [];
  const result = await pool.query(`${groupSelect}
    WHERE g.visibility = 'public'
      OR EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1)
      OR EXISTS (SELECT 1 FROM group_invites gi WHERE gi.group_id = g.id AND gi.user_id = $1)
    ORDER BY is_member DESC, is_invited DESC, g.created_at DESC
    LIMIT 100`, [viewerId]);
  return result.rows.map((row) => mapGroup(row, viewerId));
}

export async function getMyGroups(viewerId: string): Promise<Array<{ id: string; name: string; visibility: 'public' | 'private' }>> {
  if (!pool) return [];
  const result = await pool.query(`SELECT g.id, g.name, g.visibility
    FROM group_members gm JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = $1
    ORDER BY gm.joined_at DESC LIMIT 12`, [viewerId]);
  return result.rows.map((row) => ({ id: String(row.id), name: String(row.name), visibility: String(row.visibility) as 'public' | 'private' }));
}

export async function createGroup(ownerId: string, input: { name: string; description: string; visibility: 'public' | 'private' }): Promise<string> {
  if (!pool) throw new Error('Database is not connected');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO groups (name, description, visibility, owner_id)
      VALUES ($1, $2, $3, $4) RETURNING id`, [input.name, input.description, input.visibility, ownerId]);
    const groupId = String(inserted.rows[0].id);
    await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [groupId, ownerId]);
    await client.query('COMMIT');
    return groupId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getGroup(id: string, viewerId: string): Promise<GroupDetail | null> {
  if (!pool) return null;
  const result = await pool.query(`${groupSelect} WHERE g.id = $2`, [viewerId, id]);
  if (!result.rowCount) return null;
  const summary = mapGroup(result.rows[0], viewerId);
  const canView = summary.visibility === 'public' || summary.isMember;
  if (!canView) return { ...summary, members: [], threads: [] };
  const [members, threads] = await Promise.all([
    pool.query(`SELECT u.id, u.display_name, u.avatar_url, gm.role
      FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 AND u.status = 'active'
      ORDER BY CASE WHEN gm.role = 'owner' THEN 0 ELSE 1 END, gm.joined_at
      LIMIT 60`, [id]),
    pool.query(`${threadSelect} WHERE t.group_id = $1 AND t.status IN ('published', 'locked')
      ORDER BY t.is_pinned DESC, t.last_activity_at DESC LIMIT 50`, [id]),
  ]);
  return {
    ...summary,
    members: members.rows.map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      role: String(row.role) as 'owner' | 'member',
    })),
    threads: threads.rows.map(mapThread),
  };
}

export async function joinGroup(groupId: string, userId: string): Promise<boolean> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(`INSERT INTO group_members (group_id, user_id)
    SELECT g.id, $2 FROM groups g WHERE g.id = $1 AND g.visibility = 'public'
    ON CONFLICT DO NOTHING RETURNING 1`, [groupId, userId]);
  await pool.query('DELETE FROM group_invites WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return Boolean(result.rowCount);
}

export async function leaveGroup(groupId: string, userId: string): Promise<boolean> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND role <> 'owner' RETURNING 1`, [groupId, userId]);
  return Boolean(result.rowCount);
}

export async function inviteToGroup(groupId: string, inviterId: string, targetUserId: string): Promise<boolean> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(`INSERT INTO group_invites (group_id, user_id, invited_by)
    SELECT $1, $3, $2 FROM groups g
    WHERE g.id = $1 AND g.owner_id = $2
      AND EXISTS (SELECT 1 FROM users WHERE id = $3 AND status = 'active')
      AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = $1 AND gm.user_id = $3)
    ON CONFLICT DO NOTHING RETURNING 1`, [groupId, inviterId, targetUserId]);
  return Boolean(result.rowCount);
}

export async function acceptGroupInvite(groupId: string, userId: string): Promise<boolean> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(`WITH invite AS (
      DELETE FROM group_invites WHERE group_id = $1 AND user_id = $2 RETURNING group_id, user_id
    )
    INSERT INTO group_members (group_id, user_id)
    SELECT group_id, user_id FROM invite
    ON CONFLICT DO NOTHING RETURNING 1`, [groupId, userId]);
  return Boolean(result.rowCount);
}

export async function declineGroupInvite(groupId: string, userId: string): Promise<void> {
  if (!pool) throw new Error('Database is not connected');
  await pool.query('DELETE FROM group_invites WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
}

export async function deleteGroup(groupId: string, ownerId: string): Promise<boolean> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query('DELETE FROM groups WHERE id = $1 AND owner_id = $2 RETURNING 1', [groupId, ownerId]);
  return Boolean(result.rowCount);
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return Boolean(result.rowCount);
}

export async function getThreadGroup(threadId: string): Promise<{ groupId: string; visibility: 'public' | 'private' } | null> {
  if (!pool) return null;
  const result = await pool.query(`SELECT g.id, g.visibility FROM threads t JOIN groups g ON g.id = t.group_id WHERE t.id = $1`, [threadId]);
  if (!result.rowCount) return null;
  return { groupId: String(result.rows[0].id), visibility: String(result.rows[0].visibility) as 'public' | 'private' };
}

export async function searchInviteCandidates(groupId: string, query = ''): Promise<MemberSummary[]> {
  if (!pool) return [];
  const cleaned = query.trim().slice(0, 80);
  const result = await pool.query(`SELECT id, display_name, avatar_url, bio, role, created_at
    FROM users u
    WHERE u.status = 'active'
      AND ($2 = '' OR u.display_name ILIKE '%' || $2 || '%')
      AND NOT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = $1 AND gm.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM group_invites gi WHERE gi.group_id = $1 AND gi.user_id = u.id)
    ORDER BY u.last_login_at DESC NULLS LAST, u.created_at DESC
    LIMIT 20`, [groupId, cleaned]);
  return result.rows.map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    bio: row.bio ? String(row.bio) : null,
    role: row.role,
    createdAt: new Date(row.created_at),
  }));
}

export async function getGroupMessages(groupId: string): Promise<GroupMessage[]> {
  if (!pool) return [];
  const result = await pool.query(`SELECT id, group_id, sender_id, body, created_at, display_name, avatar_url FROM (
      SELECT m.id, m.group_id, m.sender_id, m.body, m.created_at, u.display_name, u.avatar_url
      FROM group_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.group_id = $1
      ORDER BY m.created_at DESC, m.id DESC LIMIT 200
    ) recent ORDER BY created_at, id`, [groupId]);
  return result.rows.map((row) => {
    const name = String(row.display_name);
    return {
      id: String(row.id),
      groupId: String(row.group_id),
      senderId: String(row.sender_id),
      senderName: name,
      senderAvatar: row.avatar_url ? String(row.avatar_url) : null,
      senderInitial: name.slice(0, 1).toUpperCase(),
      body: String(row.body),
      createdAt: new Date(row.created_at),
    };
  });
}

export async function createGroupMessage(groupId: string, senderId: string, body: string): Promise<GroupMessage> {
  if (!pool) throw new Error('Database is not connected');
  const result = await pool.query(`WITH inserted AS (
      INSERT INTO group_messages (group_id, sender_id, body)
      SELECT $1, $2, $3 FROM group_members gm WHERE gm.group_id = $1 AND gm.user_id = $2
      RETURNING id, group_id, sender_id, body, created_at
    )
    SELECT i.id, i.group_id, i.sender_id, i.body, i.created_at, u.display_name, u.avatar_url
    FROM inserted i JOIN users u ON u.id = i.sender_id`, [groupId, senderId, body]);
  if (!result.rowCount) throw new Error('Not a member of this group');
  const row = result.rows[0];
  const name = String(row.display_name);
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    senderId: String(row.sender_id),
    senderName: name,
    senderAvatar: row.avatar_url ? String(row.avatar_url) : null,
    senderInitial: name.slice(0, 1).toUpperCase(),
    body: String(row.body),
    createdAt: new Date(row.created_at),
  };
}

export async function findUserById(id: string): Promise<User | null> {
  if (!pool) return demoUsers.find((user) => user.id === id) ?? null;
  const result = await pool.query('SELECT id, email, display_name, avatar_url, bio, role, created_at FROM users WHERE id = $1 AND status = $2', [id, 'active']);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: String(row.id), email: String(row.email), displayName: String(row.display_name), avatarUrl: row.avatar_url, bio: row.bio, role: row.role, createdAt: new Date(row.created_at) };
}

export async function upsertGoogleUser(profile: Profile, adminEmails: string[] = []): Promise<User> {
  if (!pool) throw new Error('Database is not connected');
  const email = profile.emails?.[0]?.value?.toLowerCase();
  if (!email) throw new Error('Google account did not provide an email address');
  const avatar = profile.photos?.[0]?.value ?? null;
  const result = await pool.query(`
    INSERT INTO users (google_sub, email, display_name, avatar_url, last_login_at, role)
    VALUES ($1, $2, $3, $4, NOW(), CASE
      WHEN $2 = ANY($5::text[]) OR NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND status = 'active') THEN 'admin'
      ELSE 'member'
    END)
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      role = CASE
        WHEN EXCLUDED.email = ANY($5::text[]) OR NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND status = 'active') THEN 'admin'
        ELSE users.role
      END,
      last_login_at = NOW(),
      updated_at = NOW()
    RETURNING id, email, display_name, avatar_url, bio, role, created_at
  `, [profile.id, email, profile.displayName || email.split('@')[0], avatar, adminEmails]);
  const row = result.rows[0];
  return { id: String(row.id), email: String(row.email), displayName: String(row.display_name), avatarUrl: row.avatar_url, bio: row.bio, role: row.role, createdAt: new Date(row.created_at) };
}
