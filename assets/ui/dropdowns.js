(() => {
  const widgets = new Map();
  let active = null;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function enhance(select) {
    if (widgets.has(select)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'ts-dropdown';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ts-dropdown-trigger';
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const label = select.getAttribute('aria-label') || select.labels?.[0]?.querySelector('strong')?.textContent || 'Choose an option';
    trigger.setAttribute('aria-label', label);
    const text = document.createElement('span');
    text.className = 'ts-dropdown-value';
    const chevron = document.createElement('span');
    chevron.className = 'ts-dropdown-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(text, chevron);
    const menu = document.createElement('div');
    menu.className = 'ts-dropdown-menu';
    menu.id = `${select.id}-listbox`;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', label);
    menu.setAttribute('popover', 'manual');
    menu.hidden = true;
    trigger.setAttribute('aria-controls', menu.id);
    select.before(wrapper);
    wrapper.append(trigger, select);
    select.hidden = true;
    document.body.append(menu);
    let highlighted = select.selectedIndex;
    let timer = null;
    let search = '';
    let searchTimer;
    const options = [...select.options].map((option, index) => {
      const item = document.createElement('div');
      item.className = 'ts-dropdown-option';
      item.id = `${menu.id}-${index}`;
      item.setAttribute('role', 'option');
      item.textContent = option.textContent;
      item.addEventListener('pointermove', () => highlight(index));
      item.addEventListener('pointerdown', event => event.preventDefault());
      item.addEventListener('click', () => choose(index));
      menu.append(item);
      return item;
    });

    function highlight(index) {
      if (index < 0 || select.options[index]?.disabled) return;
      highlighted = index;
      options.forEach((option, i) => option.classList.toggle('is-highlighted', i === index));
      trigger.setAttribute('aria-activedescendant', options[index].id);
      options[index].scrollIntoView({ block: 'nearest' });
    }
    function move(delta) {
      let index = highlighted;
      for (let i = 0; i < options.length; i++) {
        index = (index + delta + options.length) % options.length;
        if (!select.options[index].disabled) { highlight(index); break; }
      }
    }
    function position() {
      if (active !== widget) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 132), innerWidth - 16);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
      const below = innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const upward = below < Math.min(menu.scrollHeight, 220) && above > below;
      menu.style.maxHeight = `${Math.max(40, Math.min(260, upward ? above : below))}px`;
      menu.style.top = `${upward ? Math.max(8, rect.top - menu.offsetHeight - 6) : rect.bottom + 6}px`;
      menu.style.transformOrigin = upward ? 'bottom center' : 'top center';
    }
    function open() {
      sync();
      if (trigger.disabled || !options.length) return;
      active?.close();
      clearTimeout(timer);
      active = widget;
      menu.hidden = false;
      if (menu.showPopover && !menu.matches(':popover-open')) menu.showPopover();
      position();
      trigger.setAttribute('aria-expanded', 'true');
      highlight(select.selectedIndex >= 0 ? select.selectedIndex : 0);
      // Commit the closed geometry before starting the opening transition.
      void menu.offsetWidth;
      menu.classList.add('is-open');
    }
    function close() {
      if (active === widget) active = null;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      menu.classList.remove('is-open');
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (menu.hidePopover && menu.matches(':popover-open')) menu.hidePopover();
        menu.hidden = true;
      }, reducedMotion() ? 0 : 150);
    }
    function choose(index) {
      if (select.options[index]?.disabled || trigger.disabled) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close();
      trigger.focus({ preventScroll: true });
    }
    function sync() {
      trigger.disabled = select.disabled || Boolean(select.closest('[inert]'));
      text.textContent = select.selectedOptions[0]?.textContent || '';
      options.forEach((option, i) => {
        option.setAttribute('aria-selected', String(i === select.selectedIndex));
        option.setAttribute('aria-disabled', String(select.options[i].disabled));
      });
      if (trigger.disabled && active === widget) close();
    }
    const widget = { select, trigger, menu, sync, close, position };
    widgets.set(select, widget);
    trigger.addEventListener('click', () => active === widget ? close() : open());
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'Escape') { if (active === widget) { event.preventDefault(); close(); } return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (active !== widget) { open(); return; }
        if (event.key === 'ArrowDown') move(1);
        else if (event.key === 'ArrowUp') move(-1);
        else if (event.key === 'Home') { highlighted = options.length - 1; move(1); }
        else if (event.key === 'End') { highlighted = 0; move(-1); }
        else choose(highlighted);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (active !== widget) open();
        clearTimeout(searchTimer);
        search += event.key.toLowerCase();
        const index = [...select.options].findIndex(option => !option.disabled && option.textContent.toLowerCase().startsWith(search));
        if (index >= 0) highlight(index);
        searchTimer = setTimeout(() => { search = ''; }, 600);
      }
    });
    trigger.addEventListener('blur', close);
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['disabled'] });
    sync();
  }
  function syncAll() {
    document.querySelectorAll('select').forEach(enhance);
    widgets.forEach(widget => widget.sync());
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.trigger.contains(event.target) && !active.menu.contains(event.target)) active.close();
  });
  window.addEventListener('resize', () => active?.position());
  document.addEventListener('scroll', event => {
    if (active && !active.menu.contains(event.target)) active.position();
  }, true);
  window.addEventListener('blur', () => active?.close());
  document.addEventListener('DOMContentLoaded', syncAll);
  globalThis.TuneShiftDropdowns = { syncAll };
})();
