(() => {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('kapibara-theme');
  const preferredLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  root.dataset.theme = storedTheme || (preferredLight ? 'light' : 'dark');

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
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 320)}px`;
    };
    textarea.addEventListener('input', update);
    update();
  });

  const bindQuoteButton = (button) => {
    button.addEventListener('click', () => {
      const textarea = document.querySelector('#reply-body');
      if (!textarea) return;
      textarea.value += `${textarea.value ? '\n' : ''}>>${button.dataset.number} `;
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
      document.querySelector('#reply')?.scrollIntoView({ behavior: 'smooth' });
    });
  };
  document.querySelectorAll('.quote-button').forEach(bindQuoteButton);

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

  const search = document.querySelector('.topbar-search input');
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

  const buildAvatar = (avatarUrl, initialText) => {
    const avatar = document.createElement('span');
    avatar.className = 'avatar avatar--medium';
    if (avatarUrl) {
      const image = document.createElement('img');
      image.src = avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      avatar.append(image);
    } else {
      const initial = document.createElement('span');
      initial.textContent = initialText;
      avatar.append(initial);
    }
    return avatar;
  };

  const timeNow = (iso) => {
    const time = document.createElement('time');
    time.dateTime = iso;
    time.textContent = 'たった今';
    return time;
  };

  // --- thread replies (SSE + async post share this) ---
  const replies = document.querySelector('#live-replies');
  const insertReply = (post) => {
    if (!replies || replies.querySelector(`[data-post-id="${CSS.escape(post.id)}"]`)) return;
    const number = replies.querySelectorAll('[data-post-id]').length + 2;
    replies.querySelector('.res-empty')?.remove();
    replies.querySelector('#latest')?.removeAttribute('id');

    const article = document.createElement('article');
    article.className = 'res';
    article.dataset.postId = post.id;
    article.dataset.number = String(number);
    article.id = 'latest';

    const content = document.createElement('div');
    content.className = 'res-main';
    const header = document.createElement('header');
    header.className = 'res-header';
    const num = document.createElement('span');
    num.className = 'res-num';
    num.textContent = String(number);
    const name = document.createElement('b');
    name.className = 'res-name';
    name.textContent = post.authorName;
    header.append(num, name);
    if (post.authorRole !== 'member') {
      const role = document.createElement('span');
      role.className = 'res-role res-role--staff';
      role.textContent = post.authorRole === 'admin' ? '管理者' : 'モデレーター';
      header.append(role);
    }
    header.append(timeNow(post.createdAt));

    const body = document.createElement('div');
    body.className = 'res-body rich-body';
    body.textContent = post.body;

    const footer = document.createElement('footer');
    footer.className = 'res-footer';
    const quote = document.createElement('button');
    quote.type = 'button';
    quote.className = 'mini-action quote-button';
    quote.dataset.number = String(number);
    quote.textContent = `↩ >>${number}`;
    bindQuoteButton(quote);
    footer.append(quote);

    content.append(header, body, footer);
    article.append(buildAvatar(post.authorAvatar, post.authorInitial), content);
    replies.append(article);
    const count = document.querySelector('[data-reply-count]');
    if (count) count.textContent = new Intl.NumberFormat('ja-JP').format(replies.querySelectorAll('[data-post-id]').length);
  };

  const liveThread = document.querySelector('[data-live-thread]');
  if (liveThread && window.EventSource) {
    const source = new EventSource(`/threads/${liveThread.dataset.liveThread}/events`);
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'post') insertReply(payload.post);
    });
  }

  // --- group chat ---
  const chat = document.querySelector('#live-chat');
  const insertChatMessage = (message) => {
    if (!chat || chat.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
    chat.querySelector('.conversation-start')?.remove();
    chat.querySelector('#latest')?.removeAttribute('id');
    const article = document.createElement('article');
    article.className = `chat-row${message.senderId === chat.dataset.currentUser ? ' is-mine' : ''}`;
    article.dataset.messageId = message.id;
    article.id = 'latest';
    const main = document.createElement('div');
    main.className = 'chat-main';
    const header = document.createElement('header');
    const name = document.createElement('b');
    name.textContent = message.senderName;
    header.append(name, timeNow(message.createdAt));
    const body = document.createElement('p');
    body.textContent = message.body;
    main.append(header, body);
    article.append(buildAvatar(message.senderAvatar, message.senderInitial), main);
    chat.append(article);
    chat.scrollTop = chat.scrollHeight;
  };

  const liveGroup = document.querySelector('[data-live-group]');
  if (liveGroup && window.EventSource) {
    const source = new EventSource(`/groups/${liveGroup.dataset.liveGroup}/chat/events`);
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'gmessage') insertChatMessage(payload.message);
    });
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  // --- direct messages ---
  const dmList = document.querySelector('#live-messages');
  const insertDirectMessage = (message) => {
    if (!dmList || dmList.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return;
    dmList.querySelector('.conversation-start')?.remove();
    dmList.querySelector('#latest')?.removeAttribute('id');
    const article = document.createElement('article');
    article.className = `message-bubble${message.senderId === dmList.dataset.currentUser ? ' is-mine' : ''}`;
    article.dataset.messageId = message.id;
    article.id = 'latest';
    const body = document.createElement('p');
    body.textContent = message.body;
    article.append(body, timeNow(message.createdAt));
    dmList.append(article);
    dmList.scrollTop = dmList.scrollHeight;
  };

  const liveDm = document.querySelector('[data-live-dm]');
  if (liveDm && window.EventSource) {
    const source = new EventSource(`/messages/${liveDm.dataset.liveDm}/events`);
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'message') insertDirectMessage(payload.message);
    });
    if (dmList) dmList.scrollTop = dmList.scrollHeight;
  }

  // --- live feed pill (home / board pages) ---
  const feed = document.querySelector('[data-live-feed]');
  if (feed && window.EventSource) {
    const filter = feed.dataset.liveFeed;
    const source = new EventSource('/feed/events');
    let pill = null;
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type !== 'thread') return;
      if (filter && filter !== 'general' && payload.categorySlug && payload.categorySlug !== filter) return;
      if (pill) return;
      pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'live-pill';
      pill.textContent = '↻ 新しいボードがあります';
      pill.addEventListener('click', () => location.reload());
      feed.before(pill);
    });
  }

  // --- async form submissions (fall back to normal submit on failure) ---
  const clearTextarea = (form) => {
    const textarea = form.querySelector('textarea');
    if (!textarea) return;
    textarea.value = '';
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
  };

  document.querySelectorAll('form[data-async]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const kind = form.dataset.async;
      const submitButton = form.querySelector('[type="submit"]');
      submitButton?.setAttribute('disabled', '');
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'fetch' },
          body: new URLSearchParams(new FormData(form)),
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = await response.json().catch(() => null);
        if (kind === 'reply' && data?.post) {
          insertReply(data.post);
          clearTextarea(form);
          document.querySelector('#latest')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (kind === 'dm' && data?.message) {
          insertDirectMessage(data.message);
          clearTextarea(form);
        } else if (kind === 'chat' && data?.message) {
          insertChatMessage(data.message);
          clearTextarea(form);
        } else if (kind === 'like' && typeof data?.active === 'boolean') {
          const button = form.querySelector('button');
          button.classList.toggle('is-active', data.active);
          const count = button.querySelector('b');
          if (count) count.textContent = new Intl.NumberFormat('ja-JP', { notation: data.count > 9999 ? 'compact' : 'standard' }).format(data.count);
        } else if (kind === 'bookmark' && typeof data?.active === 'boolean') {
          const button = form.querySelector('button');
          button.classList.toggle('is-active', data.active);
          button.lastChild.textContent = data.active ? '保存済み' : '保存';
        } else {
          throw new Error('unexpected response');
        }
      } catch (error) {
        console.warn('Async submit failed; falling back', error);
        HTMLFormElement.prototype.submit.call(form);
      } finally {
        submitButton?.removeAttribute('disabled');
      }
    });
  });
})();
