(() => {
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('yohaku-theme');
  const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = storedTheme || (preferredDark ? 'dark' : 'light');

  document.querySelector('.theme-toggle')?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('yohaku-theme', next);
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
})();
