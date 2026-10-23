// ☰ menu: a slide-in drawer used on every page of the site.
export function mountMenu(items, opts = {}) {
  const btn = document.createElement('button');
  btn.className = 'menu-btn' + (opts.light ? ' light' : '');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span></span><span></span><span></span>';

  const shade = document.createElement('div');
  shade.className = 'drawer-shade';
  const nav = document.createElement('nav');
  nav.className = 'drawer';
  nav.setAttribute('aria-label', 'Main menu');
  nav.innerHTML = `<div class="drawer-head"><img src="icon.png" alt="" width="26" height="26"><b>GST Desk</b>
      <button type="button" class="drawer-x" aria-label="Close menu">✕</button></div>
    <ul>${items.map((it, i) => it.sep ? '<li class="sep"></li>' :
      `<li><a href="${it.href || '#'}" data-i="${i}"${it.download ? ' download' : ''}${it.external ? ' target="_blank" rel="noopener"' : ''}${it.current ? ' aria-current="page"' : ''}>
        <span class="ic">${it.icon || ''}</span><span>${it.label}</span>${it.hint ? `<small>${it.hint}</small>` : ''}</a></li>`).join('')}</ul>
    ${opts.footer ? `<div class="drawer-foot">${opts.footer}</div>` : ''}`;
  document.body.append(shade, nav);

  const open = () => { nav.classList.add('open'); shade.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); const a = nav.querySelector('a'); if (a) a.focus(); };
  const close = () => { nav.classList.remove('open'); shade.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); };
  btn.addEventListener('click', () => nav.classList.contains('open') ? close() : open());
  shade.addEventListener('click', close);
  nav.querySelector('.drawer-x').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) close(); });
  nav.querySelectorAll('a[data-i]').forEach(a => a.addEventListener('click', (e) => {
    const it = items[+a.dataset.i];
    if (it.onClick) { e.preventDefault(); close(); it.onClick(); }
    else if (it.href && it.href.startsWith('#')) close();
  }));
  (opts.into || document.body).prepend(btn);
  return { open, close, button: btn };
}
