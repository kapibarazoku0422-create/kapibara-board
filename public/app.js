(() => {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('kapibara-theme');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = storedTheme || (preferredDark ? 'dark' : 'light');

  document.querySelector('.theme-toggle')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('kapibara-theme', next);
  });

  document.querySelector('.flash button')?.addEventListener('click', (event) => {
    event.currentTarget.closest('.flash')?.remove();
  });

  const relativeFormatter = new Intl.RelativeTimeFormat('ja', { numeric: 'auto' });
  document.querySelectorAll('[data-relative]').forEach((element) => {
    const seconds = (new Date(element.dataset.relative).getTime() - Date.now()) / 1000;
    const ranges = [
      ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
      ['day', 86_400], ['hour', 3_600], ['minute', 60],
    ];
    const [unit, amount] = ranges.find(([, value]) => Math.abs(seconds) >= value) || ['second', 1];
    element.textContent = relativeFormatter.format(Math.round(seconds / amount), unit);
  });

  document.querySelectorAll('textarea').forEach((textarea) => {
    const counter = textarea.closest('form, .editor-shell')?.querySelector('[data-character-count]');
    const update = () => {
      if (counter) counter.textContent = new Intl.NumberFormat('ja-JP').format(textarea.value.length);
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(textarea.scrollHeight, 130)}px`;
    };
    textarea.addEventListener('input', update);
    update();
  });

  document.querySelectorAll('.quote-button').forEach((button) => {
    button.addEventListener('click', () => {
      const textarea = document.querySelector('#reply-body');
      if (!textarea) return;
      textarea.value += `${textarea.value ? '\n\n' : ''}@${button.dataset.author} `;
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
      document.querySelector('#reply')?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  document.querySelector('.share-button')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    try {
      if (navigator.share) await navigator.share({ title: button.dataset.shareTitle, url: location.href });
      else {
        await navigator.clipboard.writeText(location.href);
        const original = button.lastChild.textContent;
        button.lastChild.textContent = 'コピーしました';
        setTimeout(() => { button.lastChild.textContent = original; }, 1800);
      }
    } catch (error) {
      if (error.name !== 'AbortError') console.warn('Share failed', error);
    }
  });

  const search = document.querySelector('.header-search input');
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search?.focus();
    }
  });

  document.querySelectorAll('textarea').forEach((textarea) => {
    textarea.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        textarea.closest('form')?.requestSubmit();
      }
    });
  });

  const liveThread = document.querySelector('[data-live-thread]');
  if (liveThread && window.EventSource) {
    const replies = document.querySelector('#live-replies');
    const source = new EventSource(`/threads/${liveThread.dataset.liveThread}/events`);
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type !== 'post' || !replies || replies.querySelector(`[data-post-id="${CSS.escape(payload.post.id)}"]`)) return;
      const post = payload.post;
      const article = document.createElement('article');
      article.className = 'reply-card';
      article.dataset.postId = post.id;
      article.id = 'latest';

      const rail = document.createElement('div');
      rail.className = 'reply-rail';
      const avatar = document.createElement('span');
      avatar.className = 'avatar avatar--medium';
      if (post.authorAvatar) {
        const image = document.createElement('img');
        image.src = post.authorAvatar;
        image.alt = '';
        avatar.append(image);
      } else {
        const initial = document.createElement('span');
        initial.textContent = post.authorInitial;
        avatar.append(initial);
      }
      rail.append(avatar, document.createElement('span'));

      const content = document.createElement('div');
      content.className = 'reply-content';
      const header = document.createElement('header');
      const author = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = post.authorName;
      author.append(name);
      if (post.authorRole !== 'member') {
        const role = document.createElement('span');
        role.className = 'role-badge';
        role.textContent = post.authorRole === 'admin' ? '管理者' : 'モデレーター';
        author.append(role);
      }
      const meta = document.createElement('div');
      const time = document.createElement('time');
      time.dateTime = post.createdAt;
      time.textContent = 'たった今';
      meta.append(time);
      header.append(author, meta);
      const body = document.createElement('div');
      body.className = 'rich-body rich-body--reply';
      body.textContent = post.body;
      const footer = document.createElement('footer');
      const thanks = document.createElement('button');
      thanks.type = 'button';
      thanks.className = 'mini-action';
      thanks.textContent = '♡ いいね';
      footer.append(thanks);
      content.append(header, body, footer);
      replies.querySelector('#latest')?.removeAttribute('id');
      article.append(rail, content);
      replies.append(article);
      const count = document.querySelector('[data-reply-count]');
      if (count) count.textContent = new Intl.NumberFormat('ja-JP').format(replies.querySelectorAll('[data-post-id]').length);
    });
  }

  const liveDm = document.querySelector('[data-live-dm]');
  if (liveDm && window.EventSource) {
    const messages = document.querySelector('#live-messages');
    const currentUser = messages?.dataset.currentUser;
    const source = new EventSource(`/messages/${liveDm.dataset.liveDm}/events`);
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type !== 'message' || !messages || messages.querySelector(`[data-message-id="${CSS.escape(payload.message.id)}"]`)) return;
      const message = payload.message;
      messages.querySelector('.conversation-start')?.remove();
      messages.querySelector('#latest')?.removeAttribute('id');
      const article = document.createElement('article');
      article.className = `message-bubble${message.senderId === currentUser ? ' is-mine' : ''}`;
      article.dataset.messageId = message.id;
      article.id = 'latest';
      const body = document.createElement('p');
      body.textContent = message.body;
      const time = document.createElement('time');
      time.dateTime = message.createdAt;
      time.textContent = 'たった今';
      article.append(body, time);
      messages.append(article);
      messages.scrollTop = messages.scrollHeight;
    });
    messages.scrollTop = messages.scrollHeight;
  }
})();
