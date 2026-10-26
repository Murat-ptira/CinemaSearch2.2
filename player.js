/* player.js — страница фильма + плеер с рабочими видео-провайдерами (Kinobox, Iframe-балансеры, Трейлер) */
(() => {
  'use strict';

  /* ================= КОНФИГУРАЦИЯ ================= */
  const PLAYER_CONFIG = {
    defaultProvider: 'kinobox',
    iframeSandbox: '',
  };

  /* ================= УТИЛИТЫ ================= */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* Загрузчик скрипта Kinobox */
  let kbLoaded = false;
  function loadKinoboxScript() {
    if (kbLoaded || window.Kinobox) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://kinobox.tv/kinobox.min.js';
      s.async = true;
      s.onload = () => { kbLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Не удалось загрузить скрипт Kinobox'));
      document.head.appendChild(s);
    });
  }

  /* Универсальный сборщик URL для iframe-балансеров */
  function buildIframeUrl(template, ids) {
    if (!/^https?:\/\//i.test(template)) return null;
    const vals = {
      imdb_id: ids.imdb,
      tmdb_id: ids.tmdb,
      title: ids.title
    };
    let missing = false;
    const url = template.replace(/\{(imdb_id|tmdb_id|title)\}/g, (_, k) => {
      if (!vals[k]) { missing = true; return ''; }
      return encodeURIComponent(vals[k]);
    });
    return missing ? null : url;
  }

  const iframeProvider = ({ key, label, template }) => ({
    key, label,
    async resolve(ctx) {
      const src = buildIframeUrl(template, ctx.ids);
      return src ? { kind: 'iframe', src }
                 : { error: 'Для этого фильма не найден международный ID (IMDb / TMDB).' };
    },
  });

  /* ================= МАССИВ ПРОВАЙДЕРОВ (ИСТОЧНИКОВ) ================= */
  const providers = [
    {
      key: 'kinobox',
      label: 'Плеер #1 (Все озвучки / 4K)',
      async resolve(ctx) {
        if (!ctx.ids.imdb && !ctx.ids.tmdb && !ctx.ids.title) {
          return { error: 'Недостаточно данных для поиска фильма.' };
        }
        return { kind: 'kinobox', ids: ctx.ids };
      }
    },
    iframeProvider({
      key: 'collaps',
      label: 'Плеер #2 (Резерв RU)',
      template: 'https://api.embess.ws/embed/imdb/{imdb_id}'
    }),
    iframeProvider({
      key: 'vidsrc',
      label: 'Плеер #3 (Multi / Мир)',
      template: 'https://vidsrc.xyz/embed/movie?tmdb={tmdb_id}'
    }),
    {
      key: 'trailer',
      label: 'Трейлер',
      async resolve({ details: d }) {
        const v = (d.videos?.results || []).filter(x => x.site === 'YouTube' && x.type === 'Trailer');
        const t = v.find(x => x.iso_639_1 === 'ru') || v[0] || (d.videos?.results || [])[0];
        return t ? { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.key)}` }
                 : { error: 'Трейлер не найден.' };
      }
    },
  ];

  /* ================= СТРАНИЦА ФИЛЬМА ================= */
  const main = $('main'), vd = $('#vd'), vw = $('#pm .vw'), vc = $('#pm .vc'), ac = $('#ac'), bf = $('#bf'), pp = $('#pp');
  const page = Object.assign(document.createElement('section'), { className: 'mp', id: 'mp', hidden: true });
  main.after(page);

  const stash = Object.assign(document.createElement('div'), { hidden: true });
  document.body.append(stash);

  const frame = document.createElement('iframe');
  frame.setAttribute('allow', 'fullscreen; autoplay; picture-in-picture; encrypted-media');
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'origin';
  frame.title = 'Видеоплеер';

  const kbContainer = document.createElement('div');
  kbContainer.id = 'kinobox-container';
  kbContainer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:1;';

  vw.append(frame, kbContainer);
  stash.append(vw, vc, ac);

  let box = null, token = 0, selToken = 0, scrollY0 = 0, inApp = false, ctx = null;

  function stopAll() {
    vd.pause();
    frame.src = 'about:blank';
    frame.hidden = true;
    kbContainer.hidden = true;
    kbContainer.innerHTML = '';
  }

  function useFrame(src) {
    stopAll();
    vd.hidden = true; vc.hidden = true;
    frame.hidden = false;
    PLAYER_CONFIG.iframeSandbox ? frame.setAttribute('sandbox', PLAYER_CONFIG.iframeSandbox) : frame.removeAttribute('sandbox');
    frame.src = src;
    bf.classList.remove('on');
  }

  async function useKinobox(ids) {
    stopAll();
    vd.hidden = true; vc.hidden = true;
    kbContainer.hidden = false;
    spin();
    try {
      await loadKinoboxScript();
      bf.classList.remove('on');
      kbContainer.innerHTML = '<div class="kinobox_player" style="width:100%;height:100%"></div>';
      const searchObj = {};
      if (ids.imdb) searchObj.imdb = ids.imdb;
      if (ids.tmdb) searchObj.tmdb = String(ids.tmdb);
      if (ids.title) searchObj.title = ids.title;

      new window.Kinobox(kbContainer.querySelector('.kinobox_player'), {
        search: searchObj,
        menu: {
          enable: true,
          default: 'menu_list',
          mobile: 'menu_button',
          format: '{N} :: {T} ({Q})',
        },
        players: {
          alloha: { enable: true, position: 1 },
          collaps: { enable: true, position: 2 },
          videocdn: { enable: true, position: 3 },
          voidboost: { enable: true, position: 4 },
          kodik: { enable: true, position: 5 },
          ashdi: { enable: true, position: 6 },
          hdvb: { enable: true, position: 7 }
        }
      }).init();
    } catch (e) {
      kbContainer.hidden = true;
      bf.innerHTML = 'Не удалось загрузить агрегатор плееров. Попробуйте «Плеер #2» или «Плеер #3» выше.';
      bf.classList.add('on');
    }
  }

  function useVideo(r) {
    stopAll();
    vd.hidden = false; vc.hidden = false;
    vd.removeAttribute('crossorigin'); vd.loop = false; vd.preload = 'metadata';
    vd.dataset.fb = r.fallback || '';
    vd.src = r.src; vd.load();
    pp.textContent = 'Играть';
    spin();
  }

  async function select(key) {
    const p = providers.find(x => x.key === key);
    if (!p || !ctx) return;
    const t = ++selToken;
    try { localStorage.setItem('cs_provider', key); } catch {}
    $$('.pl-sw .chip', page).forEach(b => {
      const on = b.dataset.k === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    stopAll();
    spin();
    let r;
    try { r = await p.resolve(ctx); } catch { r = { error: 'Источник не отвечает. Попробуйте другой.' }; }
    if (t !== selToken) return;
    if (r.error) {
      stopAll();
      vd.hidden = true; vc.hidden = true;
      bf.innerHTML = esc(r.error);
      bf.classList.add('on');
      return;
    }
    if (r.kind === 'kinobox') await useKinobox(r.ids);
    else if (r.kind === 'video') useVideo(r);
    else useFrame(r.src);
  }

  vd.addEventListener('error', () => { const fb = vd.dataset.fb; if (fb && !vd.hidden) { vd.dataset.fb = ''; useFrame(fb); } });
  vd.addEventListener('loadedmetadata', () => bf.classList.remove('on'));

  /* Синхронизация кнопки избранного на странице фильма */
  function syncMoviePageFav() {
    const btn = $('#mp-fav', page);
    if (!btn || !ctx?.details) return;
    const isF = window.CSStorage?.isFav(ctx.details.id);
    btn.classList.toggle('fav-on', !!isF);
    const txt = $('#mp-fav-t', btn);
    if (txt) txt.textContent = isF ? 'В избранном' : 'В избранное';
  }
  window.syncMoviePageFav = syncMoviePageFav;

  function render(d, wantTrailer) {
    const year = (d.release_date || '').slice(0, 4);
    const genres = (d.genres || []).map(g => g.name);
    const rt = d.runtime ? `${Math.floor(d.runtime / 60)}ч ${d.runtime % 60}м` : '';
    const bg = d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : '';
    const ids = {
      tmdb: d.id,
      imdb: d.external_ids?.imdb_id || d.imdb_id || null,
      title: d.title || d.original_title || ''
    };
    ctx = { details: d, ids };

    /* Автоматическое добавление фильма в зашифрованную Историю просмотров */
    if (window.CSStorage) {
      window.CSStorage.addHistory(d);
    }

    const [a, b] = genreColors[d.genres?.[0]?.id] || defColors;
    tint({ a, b });
    document.title = `${d.title} — CineSearch`;

    const isF = window.CSStorage?.isFav(d.id);

    page.innerHTML = `
      <div class="mp-bg">${bg ? `<img src="${bg}" alt="">` : ''}</div>
      <div class="wrap">
        <div class="mp-bar">
          <button class="btn o sm" id="mp-back">← Назад в каталог</button>
          <button class="btn o sm${isF ? ' fav-on' : ''}" id="mp-fav" type="button">
            <svg class="i"><use href="#heart"/></svg>
            <span id="mp-fav-t">${isF ? 'В избранном' : 'В избранное'}</span>
          </button>
        </div>
        <div class="mp-top">
          ${d.poster_path ? `<img class="mp-poster" src="${IMG}/w500${d.poster_path}" alt="">` : '<div class="mp-poster"></div>'}
          <div class="mp-info">
            <h1>${esc(d.title)}</h1>
            ${d.tagline ? `<p class="sub">${esc(d.tagline)}</p>` : ''}
            <div class="meta"><span class="rt">★ ${d.vote_average ? d.vote_average.toFixed(1) : '—'} TMDB</span>${year ? `<span>${year}</span>` : ''}${rt ? `<span>${rt}</span>` : ''}${ids.imdb ? `<span>IMDb: ${esc(ids.imdb)}</span>` : ''}</div>
            <div class="chips">${genres.map(g => `<span class="pill">${esc(g)}</span>`).join('')}</div>
            <p class="mp-ov">${esc(d.overview || 'Описание отсутствует.')}</p>
          </div>
        </div>
        <div class="pl">
          <div class="pl-sw" role="tablist" aria-label="Источник видео">${providers.map(p => `<button class="chip" role="tab" data-k="${p.key}">${esc(p.label)}</button>`).join('')}</div>
          <div class="pl-box"></div>
        </div>
      </div>`;

    box = $('.pl-box', page);
    box.append(vw, vc);
    $('.pl', page).prepend(ac);
    $('#mp-back').onclick = () => inApp ? history.back() : (location.hash = '#top');
    $('#mp-fav').onclick = () => window.CSStorage?.toggleFav(d);
    $('.pl-sw', page).onclick = e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) select(k); };

    let saved = null; try { saved = localStorage.getItem('cs_provider'); } catch {}
    const first = wantTrailer ? 'trailer' : (providers.some(p => p.key === saved && p.key !== 'trailer') ? saved : PLAYER_CONFIG.defaultProvider);
    select(first);
  }

  async function openMovie(id, wantTrailer) {
    const t = ++token;
    stopAll(); stash.append(vw, vc, ac);
    main.hidden = true; page.hidden = false; scrollTo(0, 0);
    page.innerHTML = '<div class="loading" style="min-height:60vh"><div class="sp"></div></div>';
    let d;
    try { d = await tmdb(`/movie/${id}`, { append_to_response: 'external_ids,videos', include_video_language: 'ru,en,null' }); }
    catch { if (t === token) page.innerHTML = '<div class="load-err"><b>Не удалось загрузить фильм</b>Проверьте подключение к интернету</div>'; return; }
    if (t === token) render(d, wantTrailer);
  }

  function closeMovie() {
    token++; selToken++;
    stopAll(); stash.append(vw, vc, ac);
    page.hidden = true; main.hidden = false;
    document.title = 'CineSearch — Кинотеатр нового поколения';
    const target = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
    target ? target.scrollIntoView() : scrollTo(0, scrollY0);
    M?.length && tint(M[cur]);
  }

  function route() {
    const m = location.hash.match(/^#\/movie\/(\d+)(\/trailer)?$/);
    if (m) openMovie(+m[1], !!m[2]);
    else if (!page.hidden) closeMovie();
  }

  /* ================= ПОДКЛЮЧЕНИЕ К САЙТУ ================= */
  window.play = (m, trailer) => {
    if (!m) return;
    if (window.CSStorage) window.CSStorage.addHistory(m);
    inApp = true; scrollY0 = scrollY;
    location.hash = `#/movie/${m.id}${trailer ? '/trailer' : ''}`;
  };
  $('#fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : box?.requestFullscreen?.();
  document.addEventListener('keydown', e => {
    if (page.hidden || e.code !== 'Space' || vd.hidden || $$('.md.open').length || /INPUT|BUTTON|IFRAME/.test(e.target.tagName)) return;
    e.preventDefault(); toggle();
  });
  addEventListener('hashchange', route);
  route();
})();