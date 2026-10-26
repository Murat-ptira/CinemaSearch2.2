/* player.js — страница фильма, видео-провайдеры, система комментариев и страницы профилей */
(() => {
  'use strict';

  /* ================= КОНФИГУРАЦИЯ ================= */
  const PLAYER_CONFIG = {
    defaultProvider: 'kinobox',
    iframeSandbox: '',
  };

  /* ================= УТИЛИТЫ ================= */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const fmtDate = ts => {
    try {
      return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
    } catch { return ''; }
  };

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
    const vals = { imdb_id: ids.imdb, tmdb_id: ids.tmdb, title: ids.title };
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

  /* ================= МАССИВ ПРОВАЙДЕРОВ ================= */
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

  /* ================= СТРАНИЦА ФИЛЬМА И СТРАНИЦА ПРОФИЛЯ ================= */
  const main = $('main'), vd = $('#vd'), vw = $('#pm .vw'), vc = $('#pm .vc'), ac = $('#ac'), bf = $('#bf'), pp = $('#pp');
  const page = Object.assign(document.createElement('section'), { className: 'mp', id: 'mp', hidden: true });
  const userPage = Object.assign(document.createElement('section'), { className: 'up', id: 'up', hidden: true });
  main.after(page, userPage);

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
  let curRating = 10, curProfUid = null, curProfTab = 'favs';

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

  function syncMoviePageFav() {
    const btn = $('#mp-fav', page);
    if (!btn || !ctx?.details) return;
    const isF = window.CSStorage?.isFav(ctx.details.id);
    btn.classList.toggle('fav-on', !!isF);
    const txt = $('#mp-fav-t', btn);
    if (txt) txt.textContent = isF ? 'В избранном' : 'В избранное';
  }
  window.syncMoviePageFav = syncMoviePageFav;

  /* ================= РЕНДЕР КОММЕНТАРИЕВ НА СТРАНИЦЕ ФИЛЬМА ================= */
  function renderAvatar(name, photoURL, cls = 'cm-av') {
    const ch = (name || 'U').charAt(0).toUpperCase();
    return `<div class="${cls}">${photoURL ? `<img src="${esc(photoURL)}" alt="" referrerpolicy="no-referrer">` : ch}</div>`;
  }

  function renderCommentsSection() {
    const wrap = $('#cm-mount', page);
    if (!wrap || !ctx?.details) return;
    const movieId = ctx.details.id;
    const movieTitle = ctx.details.title || '';
    const u = window.CSStorage?.getUser();
    const comments = window.CSStorage?.getMovieComments(movieId, movieTitle) || [];

    wrap.innerHTML = `
      <div class="cm-head">
        <h2><svg class="i" style="width:24px;height:24px"><use href="#msg"/></svg>Отзывы зрителей <span class="cm-cnt">${comments.length}</span></h2>
      </div>

      ${u ? `
        <form class="cm-form" id="cm-form">
          <div class="cm-form-top">
            <div class="cm-u-Chip" data-uprof="${esc(u.uid)}" title="Перейти в мой профиль">
              ${renderAvatar(u.name, u.photoURL)}
              <div>
                <div>${esc(u.name)}</div>
                <small style="color:var(--mu);font-weight:400;font-size:12px">Публичный профиль →</small>
              </div>
            </div>
            <div class="cm-stars" role="group" aria-label="Ваша оценка">
              <span>Ваша оценка:</span>
              ${[6,7,8,9,10].map(n => `<button type="button" class="st-btn${curRating===n?' on':''}" data-rt="${n}">★ ${n}</button>`).join('')}
            </div>
          </div>
          <textarea class="cm-ta" id="cm-text" placeholder="Поделитесь впечатлениями о фильме (без спойлеров)…" maxlength="1000" required></textarea>
          <div class="cm-form-ft">
            <span class="cm-hint">Нажмите на имя любого автора ниже, чтобы посмотреть его любимые фильмы и подписаться</span>
            <button type="submit" class="btn p sm">Опубликовать отзыв</button>
          </div>
        </form>
      ` : `
        <div class="cm-form" style="text-align:center;padding:28px 20px">
          <p style="color:var(--mu);margin-bottom:12px">Войдите в аккаунт, чтобы оставлять рецензии, ставить оценки и подписываться на киноманов</p>
          <button type="button" class="btn p sm" id="cm-login-btn" style="justify-self:center">Войти или зарегистрироваться</button>
        </div>
      `}

      <div class="cm-list" id="cm-list">
        ${comments.length ? comments.map(c => {
          const liked = u && Array.isArray(c.likes) && c.likes.includes(u.uid);
          const isMine = u && c.uid === u.uid;
          return `
            <article class="cm-card" data-cid="${esc(c.id)}">
              <div class="cm-c-top">
                <button type="button" class="cm-author" data-uprof="${esc(c.uid)}" title="Открыть профиль ${esc(c.name)}">
                  ${renderAvatar(c.name, c.photoURL)}
                  <span>
                    <b>${esc(c.name)}</b>
                    <small>${fmtDate(c.createdAt)}</small>
                  </span>
                </button>
                <span class="cm-rt-pill">★ ${Number(c.rating) || 10} / 10</span>
              </div>
              <p class="cm-body">${esc(c.text)}</p>
              <div class="cm-c-ft">
                <button type="button" class="cm-like${liked ? ' on' : ''}" data-clike="${esc(c.id)}">
                  <svg class="i" style="width:15px;height:15px"><use href="#heart"/></svg>
                  <span>Полезно · ${(c.likes || []).length}</span>
                </button>
                ${isMine ? `<button type="button" class="cm-del" data-cdel="${esc(c.id)}">Удалить</button>` : ''}
              </div>
            </article>`;
        }).join('') : `<div class="em"><b>Пока нет отзывов</b>Станьте первым, кто поделится мнением об этой картине!</div>`}
      </div>`;

    const loginBtn = $('#cm-login-btn', wrap);
    if (loginBtn) loginBtn.onclick = () => { window.authUI?.(); window.openM?.($('#auth')); };

    const form = $('#cm-form', wrap);
    if (form) {
      form.addEventListener('click', e => {
        const rb = e.target.closest('[data-rt]');
        if (rb) {
          curRating = +rb.dataset.rt;
          $$('[data-rt]', form).forEach(b => b.classList.toggle('on', +b.dataset.rt === curRating));
        }
      });
      form.addEventListener('submit', e => {
        e.preventDefault();
        const ta = $('#cm-text', form);
        const txt = ta.value.trim();
        if (!txt) return;
        window.CSStorage?.addComment(movieId, movieTitle, txt, curRating);
        ta.value = '';
        renderCommentsSection();
      });
    }
  }

  /* Делегирование событий внутри секции комментариев */
  page.addEventListener('click', e => {
    const profBtn = e.target.closest('[data-uprof]');
    if (profBtn) {
      const uid = profBtn.dataset.uprof;
      if (uid) {
        inApp = true;
        location.hash = `#/user/${encodeURIComponent(uid)}`;
      }
      return;
    }
    const likeBtn = e.target.closest('[data-clike]');
    if (likeBtn && ctx?.details) {
      if (!window.CSStorage?.getUser()) {
        window.authUI?.(); window.openM?.($('#auth'));
        return;
      }
      window.CSStorage.toggleCommentLike(ctx.details.id, likeBtn.dataset.clike);
      renderCommentsSection();
      return;
    }
    const delBtn = e.target.closest('[data-cdel]');
    if (delBtn && ctx?.details) {
      window.CSStorage?.deleteComment(ctx.details.id, delBtn.dataset.cdel);
      renderCommentsSection();
    }
  });

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

    if (window.CSStorage) window.CSStorage.addHistory(d);

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
        <div class="cm-sec" id="cm-mount"></div>
      </div>`;

    box = $('.pl-box', page);
    box.append(vw, vc);
    $('.pl', page).prepend(ac);
    $('#mp-back', page).onclick = () => inApp ? history.back() : (location.hash = '#top');
    $('#mp-fav', page).onclick = () => window.CSStorage?.toggleFav(d);
    $('.pl-sw', page).onclick = e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) select(k); };

    let saved = null; try { saved = localStorage.getItem('cs_provider'); } catch {}
    const first = wantTrailer ? 'trailer' : (providers.some(p => p.key === saved && p.key !== 'trailer') ? saved : PLAYER_CONFIG.defaultProvider);
    select(first);

    renderCommentsSection();
    if (window.CSFirestore?.fetchMovieComments) {
      window.CSFirestore.fetchMovieComments(d.id).then(res => { if (res && !page.hidden) renderCommentsSection(); });
    }
  }

  /* ================= ПУБЛИЧНАЯ СТРАНИЦА ПРОФИЛЯ ПОЛЬЗОВАТЕЛЯ (#/user/UID) ================= */
  async function openUserProfile(uid) {
    stopAll(); stash.append(vw, vc, ac);
    main.hidden = true; page.hidden = true; userPage.hidden = false;
    scrollTo(0, 0);
    curProfUid = uid;

    let prof = window.CSStorage?.getProfile(uid);
    if (!prof && window.CSFirestore?.fetchProfile) {
      userPage.innerHTML = '<div class="loading" style="min-height:60vh"><div class="sp"></div></div>';
      prof = await window.CSFirestore.fetchProfile(uid);
    }
    if (!prof) {
      prof = { uid, name: 'Киноман CineSearch', bio: 'Участник сообщества CineSearch', photoURL: '', followers: [], following: [], favs: [] };
    }
    renderUserProfile(prof);
  }

  function renderUserProfile(prof) {
    const me = window.CSStorage?.getUser();
    const isMe = me && me.uid === prof.uid;
    const myProf = me ? window.CSStorage?.getProfile(me.uid) : null;
    const isFollowing = myProf && Array.isArray(myProf.following) && myProf.following.includes(prof.uid);
    const favs = isMe ? (window.CSStorage?.getFavs() || []) : (prof.favs || []);
    const userComments = window.CSStorage?.getUserComments(prof.uid) || [];
    const allProfiles = window.CSStorage?.getAllProfiles() || {};
    const followingList = (prof.following || []).map(id => allProfiles[id] || { uid: id, name: 'Киноман', favs: [] });

    document.title = `${prof.name} — Профиль CineSearch`;

    userPage.innerHTML = `
      <div class="wrap">
        <div class="mp-bar">
          <button class="btn o sm" id="up-back">← Назад</button>
          ${isMe ? `<span class="pill">Это ваш публичный профиль</span>` : ''}
        </div>

        <div class="up-card">
          ${renderAvatar(prof.name, prof.photoURL, 'up-av')}
          <div class="up-main">
            <h1>${esc(prof.name)}</h1>
            <p class="up-bio" id="up-bio-txt">${esc(prof.bio || 'Люблю хорошее кино в 4K HDR на CineSearch.')}</p>
            ${isMe ? `
              <form class="up-bio-edit" id="up-bio-form">
                <input id="up-bio-inp" placeholder="Расскажите о ваших любимых жанрах и режиссёрах…" value="${esc(prof.bio || '')}" maxlength="240">
                <button type="submit" class="btn o sm">Сохранить статус</button>
              </form>
            ` : ''}
            <div class="up-stats">
              <span class="up-st"><b>${(prof.followers || []).length}</b> подписчиков</span>
              <span class="up-st"><b>${(prof.following || []).length}</b> подписок</span>
              <span class="up-st"><b>${favs.length}</b> любимых фильмов</span>
              <span class="up-st"><b>${userComments.length}</b> отзывов</span>
            </div>
          </div>
          <div class="up-acts">
            ${!isMe ? `
              <button type="button" class="btn ${isFollowing ? 'o sub-on' : 'p'}" id="up-follow-btn">
                ${isFollowing ? '✓ Вы подписаны' : '+ Подписаться'}
              </button>
            ` : ''}
          </div>
        </div>

        <div class="up-nav" role="tablist">
          <button type="button" class="chip${curProfTab==='favs'?' on':''}" data-ptab="favs">Любимые фильмы (${favs.length})</button>
          <button type="button" class="chip${curProfTab==='reviews'?' on':''}" data-ptab="reviews">Отзывы (${userComments.length})</button>
          <button type="button" class="chip${curProfTab==='following'?' on':''}" data-ptab="following">Подписки (${followingList.length})</button>
        </div>

        <div id="up-tab-body"></div>
      </div>`;

    $('#up-back', userPage).onclick = () => inApp ? history.back() : (location.hash = '#top');

    const bioForm = $('#up-bio-form', userPage);
    if (bioForm) {
      bioForm.onsubmit = e => {
        e.preventDefault();
        const val = $('#up-bio-inp', bioForm).value;
        const updated = window.CSStorage?.updateBio(prof.uid, val);
        if (updated) renderUserProfile(updated);
      };
    }

    const followBtn = $('#up-follow-btn', userPage);
    if (followBtn) {
      followBtn.onclick = () => {
        if (!window.CSStorage?.getUser()) {
          window.authUI?.(); window.openM?.($('#auth'));
          return;
        }
        window.CSStorage.toggleFollow(prof.uid);
        renderUserProfile(window.CSStorage.getProfile(prof.uid));
      };
    }

    const body = $('#up-tab-body', userPage);
    if (curProfTab === 'favs') {
      if (!favs.length) {
        body.innerHTML = `<div class="em"><b>В избранном пока нет фильмов</b>Пользователь ещё не добавил фильмы в свою коллекцию.</div>`;
      } else {
        body.innerHTML = `<div class="cards">${favs.map((m, i) => `
          <article class="card" style="--i:${i}" data-playid="${m.id}" tabindex="0" role="button">
            <img src="${pic(m, 720)}" width="720" height="495" loading="lazy" decoding="async" alt="">
            <div class="ci">
              <div class="ct"><span class="pill">Любимый фильм</span><span class="pill">★ ${esc(m.r || '—')}</span></div>
              <div class="cb"><div><div class="cm">${esc(m.y || '')}</div><h3 class="d">${esc(m.t)}</h3></div><span class="pp"><svg class="i f"><use href="#p"/></svg></span></div>
            </div>
          </article>`).join('')}</div>`;
      }
    } else if (curProfTab === 'reviews') {
      if (!userComments.length) {
        body.innerHTML = `<div class="em"><b>Отзывов пока нет</b>Пользователь ещё не публиковал рецензии к фильмам.</div>`;
      } else {
        body.innerHTML = `<div class="cm-list">${userComments.map(c => `
          <article class="cm-card">
            <div class="cm-c-top">
              <button type="button" class="cm-author" data-playid="${c.movieId}">
                <span><b>Фильм: ${esc(c.movieTitle || '#' + c.movieId)} →</b><small>${fmtDate(c.createdAt)}</small></span>
              </button>
              <span class="cm-rt-pill">★ ${Number(c.rating) || 10} / 10</span>
            </div>
            <p class="cm-body">${esc(c.text)}</p>
          </article>`).join('')}</div>`;
      }
    } else {
      if (!followingList.length) {
        body.innerHTML = `<div class="em"><b>Нет подписок</b>Пользователь пока ни на кого не подписан.</div>`;
      } else {
        body.innerHTML = `<div class="up-users">${followingList.map(u => `
          <div class="up-u-item" data-uprof="${esc(u.uid)}">
            <div class="up-u-info">
              ${renderAvatar(u.name, u.photoURL)}
              <div><b>${esc(u.name)}</b><small>Любимых фильмов: ${(u.favs || []).length}</small></div>
            </div>
            <span class="pill">Профиль →</span>
          </div>`).join('')}</div>`;
      }
    }
  }

  userPage.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-ptab]');
    if (tabBtn && curProfUid) {
      curProfTab = tabBtn.dataset.ptab;
      const p = window.CSStorage?.getProfile(curProfUid);
      if (p) renderUserProfile(p);
      return;
    }
    const playCard = e.target.closest('[data-playid]');
    if (playCard) {
      inApp = true;
      location.hash = `#/movie/${playCard.dataset.playid}`;
      return;
    }
    const uCard = e.target.closest('[data-uprof]');
    if (uCard) {
      inApp = true;
      location.hash = `#/user/${encodeURIComponent(uCard.dataset.uprof)}`;
    }
  });

  window.refreshSocialUI = () => {
    if (!page.hidden) renderCommentsSection();
    if (!userPage.hidden && curProfUid) {
      const p = window.CSStorage?.getProfile(curProfUid);
      if (p) renderUserProfile(p);
    }
  };

  async function openMovie(id, wantTrailer) {
    const t = ++token;
    stopAll(); stash.append(vw, vc, ac);
    main.hidden = true; userPage.hidden = true; page.hidden = false; scrollTo(0, 0);
    page.innerHTML = '<div class="loading" style="min-height:60vh"><div class="sp"></div></div>';
    let d;
    try { d = await tmdb(`/movie/${id}`, { append_to_response: 'external_ids,videos', include_video_language: 'ru,en,null' }); }
    catch { if (t === token) page.innerHTML = '<div class="load-err"><b>Не удалось загрузить фильм</b>Проверьте подключение к интернету</div>'; return; }
    if (t === token) render(d, wantTrailer);
  }

  function closeAllSubPages() {
    token++; selToken++;
    stopAll(); stash.append(vw, vc, ac);
    page.hidden = true; userPage.hidden = true; main.hidden = false;
    document.title = 'CineSearch — Кинотеатр нового поколения';
    const target = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
    target ? target.scrollIntoView() : scrollTo(0, scrollY0);
    M?.length && tint(M[cur]);
  }

  function route() {
    const m = location.hash.match(/^#\/movie\/(\d+)(\/trailer)?$/);
    if (m) {
      openMovie(+m[1], !!m[2]);
      return;
    }
    const u = location.hash.match(/^#\/user\/([^/]+)$/);
    if (u) {
      openUserProfile(decodeURIComponent(u[1]));
      return;
    }
    if (!page.hidden || !userPage.hidden) closeAllSubPages();
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
    if (page.hidden || e.code !== 'Space' || vd.hidden || $$('.md.open').length || /INPUT|BUTTON|IFRAME|TEXTAREA/.test(e.target.tagName)) return;
    e.preventDefault(); toggle();
  });
  addEventListener('hashchange', route);
  route();
})();
