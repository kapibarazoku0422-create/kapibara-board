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

  const liveThread = document.querySelector('[data-live-thread]');
  if (liveThread && window.EventSource) {
    const replies = document.querySelector('#live-replies');
    const source = new EventSource(`/threads/${liveThread.dataset.liveThread}/events`);
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type !== 'post' || !replies || replies.querySelector(`[data-post-id="${CSS.escape(payload.post.id)}"]`)) return;
      const post = payload.post;
      const number = replies.querySelectorAll('[data-post-id]').length + 2;
      replies.querySelector('.res-empty')?.remove();

      const article = document.createElement('article');
      article.className = 'res';
      article.dataset.postId = post.id;
      article.dataset.number = String(number);
      replies.querySelector('#latest')?.removeAttribute('id');
      article.id = 'latest';

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
      const time = document.createElement('time');
      time.dateTime = post.createdAt;
      time.textContent = 'たった今';
      header.append(time);

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
      article.append(avatar, content);
      replies.append(article);
      const count = document.querySelector('[data-reply-count]');
      if (count) count.textContent = new Intl.NumberFormat('ja-JP').format(replies.querySelectorAll('[data-post-id]').length);
    });
  }

  const liveGroup = document.querySelector('[data-live-group]');
  if (liveGroup && window.EventSource) {
    const chat = document.querySelector('#live-chat');
    const currentUser = chat?.dataset.currentUser;
    const source = new EventSource(`/groups/${liveGroup.dataset.liveGroup}/chat/events`);
    source.addEventListener('update', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type !== 'gmessage' || !chat || chat.querySelector(`[data-message-id="${CSS.escape(payload.message.id)}"]`)) return;
      const message = payload.message;
      chat.querySelector('.conversation-start')?.remove();
      chat.querySelector('#latest')?.removeAttribute('id');
      const article = document.createElement('article');
      article.className = `chat-row${message.senderId === currentUser ? ' is-mine' : ''}`;
      article.dataset.messageId = message.id;
      article.id = 'latest';

      const avatar = document.createElement('span');
      avatar.className = 'avatar avatar--medium';
      if (message.senderAvatar) {
        const image = document.createElement('img');
        image.src = message.senderAvatar;
        image.alt = '';
        avatar.append(image);
      } else {
        const initial = document.createElement('span');
        initial.textContent = message.senderInitial;
        avatar.append(initial);
      }

      const main = document.createElement('div');
      main.className = 'chat-main';
      const header = document.createElement('header');
      const name = document.createElement('b');
      name.textContent = message.senderName;
      const time = document.createElement('time');
      time.dateTime = message.createdAt;
      time.textContent = 'たった今';
      header.append(name, time);
      const body = document.createElement('p');
      body.textContent = message.body;
      main.append(header, body);

      article.append(avatar, main);
      chat.append(article);
      chat.scrollTop = chat.scrollHeight;
    });
    chat.scrollTop = chat.scrollHeight;
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
