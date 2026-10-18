/* Тренажёр «Допуск»: логика приложения.
   Данные хранятся только в браузере этого устройства (localStorage). */
(function () {
  const D = window.OPO;
  const KEY = 'opo-trainer-v1';
  const ADMIN_PASSWORD = '1234';
  const root = document.getElementById('app');

  /* ---------- Хранилище ---------- */
  function blank() {
    return { profiles: [], currentId: null, records: [], content: {}, settings: null, sound: true };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (e) { /* хранилище недоступно — работаем в памяти */ }
    return blank();
  }
  let st = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ничего */ }
  }

  /* ---------- Утилиты ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtDate = d => d ? new Date(d).toLocaleDateString('ru-RU') : '—';
  const fmtDateTime = d => new Date(d).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x.toISOString(); };
  const uid = () => Math.random().toString(36).slice(2, 10);
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
  function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many); }

  /* ---------- Контент с учётом правок администратора ---------- */
  const settings = () => Object.assign({}, D.SETTINGS, st.settings || {});
  const questions = () => st.content.questions || D.Q;
  function theoryFor(n, pos) {
    const key = n === 8 ? '8-' + pos : String(n);
    const over = st.content.theory && st.content.theory[key];
    const base = D.THEORY[n];
    const cards = n === 8 ? base.byPos[pos] : base.cards;
    const title = n === 8 ? base.title + ': ' + D.POSITIONS[pos].short : base.title;
    if (!over) return { title, cards };
    return { title: over.title || title, cards: over.cards.map((c, i) => Object.assign({}, cards[i] || {}, c)) };
  }
  function levelMax(n) { const s = settings(); const [t, c] = s.counts[n - 1]; return t * s.ptsTest + c * s.ptsCase; }
  function threshold(n) { return Math.min(settings().thresholds[n - 1], levelMax(n)); }

  /* ---------- Профиль ---------- */
  const me = () => st.profiles.find(p => p.id === st.currentId) || null;
  const lvl = (p, n) => p.levels[n] || { best: 0, passed: false, attempts: 0 };
  const passedCount = p => D.LEVELS.filter(L => lvl(p, L.n).passed).length;
  const totalPoints = p => D.LEVELS.reduce((s, L) => s + (lvl(p, L.n).passed ? lvl(p, L.n).best : 0), 0);
  const maxTotal = () => D.LEVELS.reduce((s, L) => s + levelMax(L.n), 0);
  const unlocked = (p, n) => n === 1 || lvl(p, n - 1).passed;
  const levelTitle = n => n === 0 ? 'Без уровня' : D.LEVELS[n - 1].name;

  function ratingRows() {
    const local = st.profiles.map(p => ({ id: p.id, fio: p.fio, pos: p.pos, dept: p.dept, level: passedCount(p), points: totalPoints(p), badges: Object.keys(p.badges), local: true }));
    return D.DEMO_PEOPLE.concat(local).sort((a, b) => b.points - a.points || b.level - a.level).map((r, i) => Object.assign({ rank: i + 1 }, r));
  }
  const rankOf = p => (ratingRows().find(r => r.id === p.id) || {}).rank || 0;

  function checkBadges(p) {
    const got = [];
    const L = n => lvl(p, n);
    const perfectCount = D.LEVELS.filter(x => L(x.n).perfect).length;
    let run = 0, bestRun = 0;
    D.LEVELS.forEach(x => { run = L(x.n).firstTry ? run + 1 : 0; bestRun = Math.max(bestRun, run); });
    const rank = rankOf(p);
    const rules = {
      pro: passedCount(p) >= 5,
      znatok: p.stats.bestStreak >= 10,
      control: !!L(6).perfect,
      titan: totalPoints(p) >= 900,
      excel: rank > 0 && rank <= 3,
      guard: p.stats.casesOk >= 10,
      trust: bestRun >= 3,
      expert: L(10).passed,
      leader: rank === 1,
      standard: perfectCount >= 3,
    };
    D.BADGES.forEach(b => { if (rules[b.id] && !p.badges[b.id]) { p.badges[b.id] = new Date().toISOString(); got.push(b); } });
    return got;
  }

  /* ---------- Запись для наряда-допуска ---------- */
  const CHECK_TYPES = {
    general: 'Общая проверка знаний требований НПА',
    hazard: 'Подготовка к работам повышенной опасности',
  };
  function recordStatus(r) {
    if (r.status === 'used') return { code: 'used', label: 'Использована: наряд-допуск выдан' };
    if (r.status === 'replaced') return { code: 'used', label: 'Заменена новой записью' };
    if (r.until && new Date(r.until) < new Date()) return { code: 'expired', label: 'Срок истёк' };
    return { code: 'active', label: 'Действует' };
  }
  function untilText(r) {
    return r.checkType === 'hazard' ? 'до начала следующих работ и выдачи нового наряда-допуска' : fmtDate(r.until);
  }
  function makeRecord(p) {
    const now = new Date();
    st.records.forEach(r => { if (r.profileId === p.id && r.status === 'active') r.status = 'replaced'; });
    const r = {
      id: 'ПБ-' + now.getFullYear() + '-' + hash(p.id + now.toISOString()).slice(0, 6),
      profileId: p.id, fio: p.fio, tab: p.tab, pos: p.pos, dept: p.dept, checkType: p.checkType,
      level: 10, points: totalPoints(p), max: maxTotal(), date: now.toISOString(),
      until: p.checkType === 'general' ? addMonths(now, settings().validityMonths) : null,
      status: 'active',
    };
    r.check = hash(recordText(r, true)).slice(0, 6);
    st.records.unshift(r);
    return r;
  }
  function recordText(r, noCheck) {
    const lines = [
      'ТРЕНАЖЁР ПБиОТ «ДОПУСК» (учебная демо-версия)',
      'Запись № ' + r.id,
      'ФИО: ' + r.fio,
      'Таб. №: ' + (r.tab || '—'),
      'Должность: ' + D.POSITIONS[r.pos].name,
      'Подразделение: ' + (r.dept || '—'),
      'Уровень: 10 — ' + D.LEVELS[9].name,
      'Вид проверки: ' + CHECK_TYPES[r.checkType],
      'Баллы: ' + r.points + ' из ' + r.max,
      'Дата: ' + fmtDate(r.date),
      'Действительна: ' + untilText(r),
    ];
    if (!noCheck) lines.push('Контрольный код: ' + r.check);
    return lines.join('\n');
  }
  function qrSvg(text) {
    try {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
      const qr = qrcode(0, 'M');
      qr.addData(text, 'Byte');
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true, alt: 'QR-код записи' });
    } catch (e) {
      return '<p class="muted">QR-код не удалось построить. Текст записи ниже.</p>';
    }
  }

  /* ---------- Звук: нейтральная фоновая музыка и эффекты (Web Audio, без файлов) ---------- */
  const Sound = {
    ctx: null, master: null, timer: null, step: 0,
    ensure() {
      if (this.ctx) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
        return true;
      } catch (e) { return false; }
    },
    tone(freq, t0, dur, vol, type, attack) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = type || 'sine'; o.frequency.value = freq;
      f.type = 'lowpass'; f.frequency.value = 1400;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + (attack || 0.02));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    chords: [[220, 277.18, 329.63, 415.3], [185, 233.08, 277.18, 369.99], [146.83, 220, 277.18, 329.63], [164.81, 207.65, 246.94, 329.63]],
    playChord() {
      const t = this.ctx.currentTime, ch = this.chords[this.step++ % this.chords.length];
      ch.forEach((f, i) => this.tone(f, t + i * 0.04, 7.5, 0.035, i % 2 ? 'triangle' : 'sine', 2.2));
      this.tone(ch[0] / 2, t, 7.5, 0.04, 'sine', 2.5);
    },
    startMusic() {
      if (!st.sound || this.timer || !this.ensure()) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playChord();
      this.timer = setInterval(() => this.playChord(), 6000);
    },
    stopMusic() { clearInterval(this.timer); this.timer = null; },
    sfx(kind) {
      if (!st.sound || !this.ensure()) return;
      const t = this.ctx.currentTime;
      if (kind === 'ok') { this.tone(660, t, 0.25, 0.12); this.tone(990, t + 0.09, 0.35, 0.1); }
      if (kind === 'bad') { this.tone(196, t, 0.35, 0.12, 'triangle'); this.tone(164.8, t + 0.12, 0.4, 0.1, 'triangle'); }
      if (kind === 'win') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.12, 0.6, 0.12, 'triangle'));
    },
  };

  /* ---------- Состояние интерфейса ---------- */
  const ui = { view: 'levels', admin: false, adminTab: 'people', levelN: null, theoryIdx: 0, session: null, result: null, celebrate: [], editQ: null, qFilter: { topic: 'all', pos: 'any', type: 'all' }, theoryKey: '1', ratingPos: 'all', toast: null, confirmReset: false, verify: '' };

  function go(view) { ui.view = view; render(); window.scrollTo(0, 0); }
  function toast(msg) { ui.toast = msg; renderToast(); clearTimeout(toast.t); toast.t = setTimeout(() => { ui.toast = null; renderToast(); }, 2600); }
  function renderToast() {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = ui.toast || ''; el.hidden = !ui.toast;
  }

  /* ---------- Мелкие компоненты ---------- */
  const ill = key => key && D.ILL[key] ? `<figure class="ill">${D.ILL[key]}</figure>` : '';
  const hearts = (n, max) => `<span class="hearts" aria-label="Здоровье на ОПО: ${n} из ${max}">${Array.from({ length: max }, (_, i) => `<svg viewBox="0 0 24 24" class="heart ${i < n ? 'on' : ''}"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z"/></svg>`).join('')}</span>`;
  const badgeIcon = (b, on) => `<span class="badge-ico ${on ? 'on' : ''}" aria-hidden="true"><svg viewBox="0 0 48 56"><path d="M24 2 L44 10 V28 C44 40 35 49 24 54 C13 49 4 40 4 28 V10 Z"/></svg><b>${b.sym}</b></span>`;
  const posPill = pos => `<span class="pill pos-${pos}">${esc(D.POSITIONS[pos].short)}</span>`;
  const riskMeter = r => `<span class="risk" aria-label="Уровень опасности ${r} из 4">${[1,2,3,4].map(i => `<i class="${i <= r ? 'on' : ''}"></i>`).join('')}</span>`;

  /* ---------- Каркас ---------- */
  function navButtons() {
    const items = [['levels', 'Уровни', '<path d="M4 20h16M6 16h12M8 12h8M10 8h4M12 4v0"/>'], ['rating', 'Рейтинг', '<path d="M6 20V10M12 20V4M18 20v-7"/>'], ['cabinet', 'Кабинет', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-7 8-7s7 2.5 8 7"/>'], ['admin', 'Специалист ПБ', '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>']];
    return items.map(([v, label, icon]) => `<button class="nav-btn ${ui.view === v || (v === 'levels' && ['level', 'theory', 'quiz', 'result'].includes(ui.view)) ? 'active' : ''}" data-act="nav" data-v="${v}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span></button>`).join('');
  }
  function shell(content) {
    const p = me();
    return `
      <div class="shell">
        <aside class="side">
          <div class="brand"><span class="brand-mark" aria-hidden="true"></span><div><b>ДОПУСК</b><small>тренажёр ПБиОТ на ОПО</small></div></div>
          <nav class="side-nav">${navButtons()}</nav>
          <p class="side-foot">Учебная демонстрация. Данные хранятся только на этом устройстве.</p>
        </aside>
        <div class="main">
          <header class="topbar">
            <div class="brand mobile-only"><span class="brand-mark" aria-hidden="true"></span><b>ДОПУСК</b></div>
            <div class="topbar-right">
              ${p ? `<button class="chip" data-act="nav" data-v="cabinet" title="Личный кабинет"><span class="avatar">${esc(p.fio.trim().charAt(0) || '?')}</span><span class="chip-text">${esc(p.fio.split(' ')[0])} · ур. ${passedCount(p)} · ${totalPoints(p)} б.</span></button>` : ''}
              <button class="icon-btn ${st.sound ? 'on' : ''}" data-act="sound" aria-pressed="${st.sound}" title="Фоновая музыка и звуки">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>${st.sound ? '' : '<path d="M3 3l18 18"/>'}</svg>
                <span class="sr">Звук ${st.sound ? 'включён' : 'выключен'}</span>
              </button>
            </div>
          </header>
          <main class="view">${content}</main>
        </div>
        <nav class="tabbar">${navButtons()}</nav>
      </div>`;
  }

  /* ---------- Регистрация ---------- */
  function viewOnboard() {
    const others = st.profiles;
    return `
      <div class="onboard">
        <section class="onboard-hero">
          <div class="brand big"><span class="brand-mark" aria-hidden="true"></span><div><b>ДОПУСК</b><small>игровой тренажёр по промышленной безопасности и охране труда</small></div></div>
          <h1>Пройдите 10 уровней и получите запись для наряда-допуска</h1>
          <p>Короткая теория, тесты и ситуации с объектов нефтегазодобычи. За верные ответы — баллы, за ошибки — потеря баллов и «здоровья на ОПО».</p>
          <ul class="hero-facts">
            <li><b>10</b><span>уровней от «Стажёра» до допуска</span></li>
            <li><b>7</b><span>тем: ПБ, ОТ, СИЗ, пожарная, первая помощь, наряд-допуск, авария</span></li>
            <li><b>QR</b><span>код записи после финала</span></li>
          </ul>
        </section>
        <section class="card onboard-form">
          ${others.length ? `<div class="profiles"><h2>Продолжить на этом устройстве</h2>${others.map(p => `<button class="profile-row" data-act="pick-profile" data-id="${p.id}"><span class="avatar">${esc(p.fio.charAt(0))}</span><span><b>${esc(p.fio)}</b><small>${esc(D.POSITIONS[p.pos].short)} · уровень ${passedCount(p)} · ${totalPoints(p)} баллов</small></span></button>`).join('')}<div class="divider"><span>или новый работник</span></div></div>` : ''}
          <h2>Регистрация работника</h2>
          <form id="reg-form" class="form" autocomplete="off">
            <label class="field"><span>ФИО</span><input id="reg-fio" name="fio" required placeholder="Иванов Иван Иванович" maxlength="80"></label>
            <div class="row2">
              <label class="field"><span>Табельный номер</span><input id="reg-tab" name="tab" placeholder="например, 004512" maxlength="20" inputmode="numeric"></label>
              <label class="field"><span>Подразделение</span><input id="reg-dept" name="dept" placeholder="ЦДНГ-1" maxlength="40"></label>
            </div>
            <fieldset class="field"><legend>Должность</legend>
              <div class="pos-grid">
                ${Object.entries(D.POSITIONS).map(([k, v], i) => `
                  <label class="pos-card"><input type="radio" name="pos" value="${k}" ${i === 0 ? 'checked' : ''} id="reg-pos-${k}">
                    <span class="pos-body"><b>${esc(v.name)}</b><span class="risk-line">${riskMeter(v.risk)} <small>опасность: ${v.riskLabel.toLowerCase()}</small></span><small>${esc(v.note)}</small></span>
                  </label>`).join('')}
              </div>
            </fieldset>
            <fieldset class="field"><legend>Вид проверки знаний</legend>
              <div class="seg">
                <label><input type="radio" name="check" value="general" checked id="reg-check-general"><span>${CHECK_TYPES.general}<small>запись действует по нормам НПА</small></span></label>
                <label><input type="radio" name="check" value="hazard" id="reg-check-hazard"><span>${CHECK_TYPES.hazard}<small>до выдачи следующего наряда-допуска</small></span></label>
              </div>
            </fieldset>
            <button class="btn primary wide" type="submit">Начать обучение</button>
          </form>
          <button class="link" data-act="nav" data-v="admin">Войти как специалист по ПБ</button>
        </section>
      </div>`;
  }

  /* ---------- Уровни ---------- */
  function viewLevels() {
    const p = me(), passed = passedCount(p), next = Math.min(passed + 1, 10);
    const done = passed === 10;
    const pts = totalPoints(p);
    return `
      <section class="hero-card">
        <div class="hero-main">
          <span class="eyebrow">${esc(D.POSITIONS[p.pos].name)}</span>
          <h1>${done ? 'Все уровни пройдены' : `Уровень ${next}: ${esc(D.LEVELS[next - 1].name)}`}</h1>
          <p>${done ? 'Запись для наряда-допуска сформирована — откройте её в кабинете.' : `Тема: ${esc(D.TOPICS[D.LEVELS[next - 1].topic] || 'Финальный экзамен')}. Чтобы пройти, наберите ${threshold(next)} из ${levelMax(next)} баллов.`}</p>
          <div class="hero-actions">
            ${done ? `<button class="btn primary" data-act="nav" data-v="cabinet">Открыть запись и QR-код</button>` : `<button class="btn primary" data-act="open-level" data-n="${next}">${lvl(p, next).attempts ? 'Попробовать снова' : 'Начать уровень'}</button>`}
          </div>
        </div>
        <div class="hero-stats">
          <div><span>Пройдено</span><b>${passed}<small>/10</small></b></div>
          <div><span>Баллы</span><b>${pts}<small>/${maxTotal()}</small></b></div>
          <div><span>Бейджи</span><b>${Object.keys(p.badges).length}<small>/10</small></b></div>
          <div class="progress" aria-label="Прогресс"><i style="width:${Math.round(passed * 10)}%"></i></div>
        </div>
      </section>
      <h2 class="section-title">Карта уровней</h2>
      <ol class="level-map">
        ${D.LEVELS.map(L => {
          const s = lvl(p, L.n), open = unlocked(p, L.n);
          const cls = s.passed ? 'passed' : open ? 'open' : 'locked';
          return `<li class="level ${cls} ${L.final ? 'final' : ''}">
            <button ${open ? '' : 'disabled'} data-act="open-level" data-n="${L.n}">
              <span class="level-num">${L.n}</span>
              <span class="level-body"><b>${esc(L.name)}</b><small>${esc(L.final ? 'Финальный экзамен · все темы' : D.TOPICS[L.topic])}</small></span>
              <span class="level-side">${s.passed ? `<span class="pill ok">${s.best} б.</span>` : open ? `<span class="pill">порог ${threshold(L.n)}</span>` : '<svg class="lock" viewBox="0 0 24 24" role="img" aria-label="Закрыт"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'}</span>
            </button>
          </li>`;
        }).join('')}
      </ol>`;
  }

  function viewLevelIntro() {
    const p = me(), n = ui.levelN, L = D.LEVELS[n - 1], s = settings(), [t, c] = s.counts[n - 1], th = theoryFor(n, p.pos);
    return `
      <button class="back" data-act="nav" data-v="levels">← Все уровни</button>
      <section class="card level-intro">
        <span class="eyebrow">Уровень ${n} из 10${L.final ? ' · финал' : ''}</span>
        <h1>${esc(L.name)}</h1>
        <p class="lead">Тема: <b>${esc(L.final ? 'все темы и профиль должности' : D.TOPICS[L.topic])}</b>. Вопросы подобраны для должности «${esc(D.POSITIONS[p.pos].short)}».</p>
        <dl class="facts">
          <div><dt>Заданий</dt><dd>${t + c}<small> = ${t} тест. + ${c} ситуац.</small></dd></div>
          <div><dt>Порог прохождения</dt><dd>${threshold(n)}<small> из ${levelMax(n)} б.</small></dd></div>
          <div><dt>Здоровье на ОПО</dt><dd>${hearts(s.lives, s.lives)}</dd></div>
          <div><dt>Лучший результат</dt><dd>${lvl(p, n).best || '—'}</dd></div>
        </dl>
        <ul class="rules">
          <li>Верный тест: <b>+${s.ptsTest}</b>, верная ситуация: <b>+${s.ptsCase}</b>.</li>
          <li>Ошибка: <b>−${s.penalty}</b> баллов и <b>−1</b> здоровье.</li>
          <li>${s.restoreStreak} верных ответа подряд восстанавливают 1 здоровье.</li>
          <li>Здоровье закончилось — уровень придётся пройти заново. Времени на ответ не ограничено.</li>
        </ul>
        <div class="btn-row">
          <button class="btn primary" data-act="start-theory">Теория: ${esc(th.title)}</button>
          ${lvl(p, n).theory ? `<button class="btn ghost" data-act="start-quiz">Сразу к заданиям</button>` : ''}
        </div>
      </section>`;
  }

  function viewTheory() {
    const p = me(), n = ui.levelN, th = theoryFor(n, p.pos), i = ui.theoryIdx, card = th.cards[i], last = i === th.cards.length - 1;
    return `
      <button class="back" data-act="open-level" data-n="${n}">← Уровень ${n}</button>
      <section class="card theory">
        <div class="theory-head"><span class="eyebrow">Теория · ${esc(th.title)}</span><span class="dots">${th.cards.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'done' : ''}"></i>`).join('')}</span></div>
        <div class="theory-body ${card.img ? 'has-ill' : ''}">
          <div><h2>${esc(card.h)}</h2><ul class="bullets">${card.t.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          ${ill(card.img)}
        </div>
        <div class="btn-row between">
          <button class="btn ghost" data-act="theory-prev" ${i === 0 ? 'disabled' : ''}>Назад</button>
          ${last ? `<button class="btn primary" data-act="start-quiz">Изучил, к заданиям</button>` : `<button class="btn primary" data-act="theory-next">Дальше</button>`}
        </div>
      </section>`;
  }

  /* ---------- Подбор вопросов ---------- */
  function pick(pool, n) { return shuffle(pool).slice(0, n); }
  function buildSession(n, pos) {
    const s = settings(), L = D.LEVELS[n - 1], [nt, nc] = s.counts[n - 1];
    const fits = q => q.pos === 'all' || q.pos === pos;
    const all = questions().filter(fits);
    let tests, cases;
    if (L.topic === 'final') {
      const prof = all.filter(q => q.topic === 'profile'), rest = all.filter(q => q.topic !== 'profile');
      const pt = Math.min(3, nt), pc = Math.min(1, nc);
      tests = pick(prof.filter(q => q.type === 'test'), pt).concat(pick(rest.filter(q => q.type === 'test'), nt - pt));
      cases = pick(prof.filter(q => q.type === 'case'), pc).concat(pick(rest.filter(q => q.type === 'case'), nc - pc));
    } else {
      const pool = L.topic === 'mix' ? all.filter(q => q.topic !== 'profile') : all.filter(q => q.topic === L.topic);
      tests = pick(pool.filter(q => q.type === 'test'), nt);
      cases = pick(pool.filter(q => q.type === 'case'), nc);
    }
    // ситуации равномерно вставляются между тестами
    const items = shuffle(tests);
    cases.forEach((c, k) => { const at = Math.round((k + 1) * (items.length + 1) / (cases.length + 1)); items.splice(Math.min(at, items.length), 0, c); });
    return items.map(q => q.kind === 'order'
      ? Object.assign({}, q, { order: shuffle(q.steps.map((t, k) => ({ t, k }))) })
      : Object.assign({}, q, { opts: shuffle(q.a.map((t, k) => ({ t, ok: k === q.c }))) }));
  }

  function startQuiz() {
    const p = me(), n = ui.levelN;
    p.levels[n] = Object.assign(lvl(p, n), { theory: true }); save();
    const items = buildSession(n, p.pos);
    if (!items.length) { toast('Для этого уровня нет вопросов. Добавьте их в разделе специалиста ПБ.'); return; }
    ui.session = { n, items, i: 0, score: 0, lives: settings().lives, streak: 0, bestStreak: 0, correct: 0, wrong: 0, casesOk: 0, answered: false, pickIdx: null, seq: [], lastOk: null, restored: false };
    go('quiz');
    Sound.startMusic();
  }

  function viewQuiz() {
    const S = ui.session, s = settings(), q = S.items[S.i], isCase = q.type === 'case';
    const pct = Math.round((S.i / S.items.length) * 100);
    let body;
    if (q.kind === 'order') {
      const placed = S.seq;
      body = `
        <p class="hint">Нажимайте шаги в правильном порядке.${S.answered ? '' : ' Ошиблись — нажмите «Сбросить».'}</p>
        <ol class="seq">${placed.map((k, idx) => {
          const cls = S.answered ? (k === idx ? 'ok' : 'bad') : '';
          return `<li class="${cls}"><span>${idx + 1}</span>${esc(q.steps[k])}</li>`;
        }).join('')}</ol>
        ${S.answered ? '' : `<div class="opts">${q.order.filter(o => !placed.includes(o.k)).map(o => `<button class="opt" data-act="seq-add" data-k="${o.k}">${esc(o.t)}</button>`).join('')}</div>`}
        ${S.answered && !S.lastOk ? `<div class="correct-order"><b>Правильный порядок:</b><ol>${q.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}
        ${!S.answered ? `<div class="btn-row"><button class="btn ghost" data-act="seq-reset" ${placed.length ? '' : 'disabled'}>Сбросить</button><button class="btn primary" data-act="seq-check" ${placed.length === q.steps.length ? '' : 'disabled'}>Проверить</button></div>` : ''}`;
    } else {
      body = `<div class="opts">${q.opts.map((o, k) => {
        let cls = '';
        if (S.answered) cls = o.ok ? 'ok' : (k === S.pickIdx ? 'bad' : 'dim');
        return `<button class="opt ${cls}" data-act="answer" data-k="${k}" ${S.answered ? 'disabled' : ''}><span class="opt-key">${'АБВГД'[k]}</span><span>${esc(o.t)}</span></button>`;
      }).join('')}</div>`;
    }
    const feedback = S.answered ? `
      <div class="feedback ${S.lastOk ? 'ok' : 'bad'}" role="status">
        <b>${S.lastOk ? `Верно! +${isCase ? s.ptsCase : s.ptsTest}` : `Неверно. −${s.penalty} баллов, −1 здоровье`}</b>
        ${S.restored ? '<span class="restored">Серия верных ответов — здоровье восстановлено!</span>' : ''}
        <p>${esc(q.ex || '')}</p>
        <button class="btn primary" data-act="next">${S.lives <= 0 || S.i === S.items.length - 1 ? 'Результат' : 'Следующее задание'}</button>
      </div>` : '';
    return `
      <section class="quiz">
        <div class="quiz-top">
          <button class="back" data-act="quit-quiz">✕ Выйти</button>
          <div class="quiz-meta"><span>Задание ${S.i + 1} из ${S.items.length}</span><span class="score">${S.score} б.</span>${hearts(S.lives, s.lives)}</div>
        </div>
        <div class="progress thin"><i style="width:${pct}%"></i></div>
        <article class="card q-card ${isCase ? 'case' : ''}">
          <div class="q-tags"><span class="pill ${isCase ? 'warn' : ''}">${isCase ? (q.kind === 'order' ? 'Ситуация · порядок действий' : 'Ситуационное задание') : 'Тестовый вопрос'}</span><span class="pill soft">${esc(D.TOPICS[q.topic])}</span></div>
          <div class="q-main ${q.img ? 'has-ill' : ''}"><h2 class="q-text">${esc(q.q)}</h2>${ill(q.img)}</div>
          ${body}
          ${feedback}
        </article>
      </section>`;
  }

  function judge(ok) {
    const S = ui.session, s = settings(), q = S.items[S.i];
    S.answered = true; S.lastOk = ok; S.restored = false;
    if (ok) {
      S.score += q.type === 'case' ? s.ptsCase : s.ptsTest;
      S.correct++; S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
      if (q.type === 'case') S.casesOk++;
      if (S.streak % s.restoreStreak === 0 && S.lives < s.lives) { S.lives++; S.restored = true; }
      Sound.sfx('ok');
    } else {
      S.score = Math.max(0, S.score - s.penalty);
      S.wrong++; S.streak = 0; S.lives--;
      Sound.sfx('bad');
    }
    render();
  }

  function finishQuiz() {
    const S = ui.session, p = me(), n = S.n, s = settings();
    const outOfLives = S.lives <= 0;
    const passed = !outOfLives && S.score >= threshold(n);
    const before = passedCount(p);
    const L = lvl(p, n);
    const wasPassed = L.passed;
    L.attempts = (L.attempts || 0) + 1;
    if (passed) {
      L.passed = true;
      L.best = Math.max(L.best || 0, S.score);
      if (S.wrong === 0) L.perfect = true;
      if (!wasPassed && L.attempts === 1) L.firstTry = true;
    }
    p.levels[n] = L;
    p.stats.correct += S.correct; p.stats.wrong += S.wrong; p.stats.casesOk += S.casesOk;
    p.stats.bestStreak = Math.max(p.stats.bestStreak, S.bestStreak);
    p.history.unshift({ date: new Date().toISOString(), level: n, score: S.score, max: levelMax(n), passed, correct: S.correct, wrong: S.wrong, lives: Math.max(0, S.lives), reason: outOfLives ? 'lives' : passed ? 'ok' : 'points' });
    p.history = p.history.slice(0, 60);
    let record = null;
    if (passed && n === 10) record = makeRecord(p);
    const newBadges = checkBadges(p);
    save();
    ui.result = { n, passed, outOfLives, score: S.score, correct: S.correct, wrong: S.wrong, levelUp: passed && !wasPassed, record };
    ui.session = null;
    ui.celebrate = [];
    if (passed && !wasPassed) ui.celebrate.push({ kind: 'level', n, after: passedCount(p), before });
    newBadges.forEach(b => ui.celebrate.push({ kind: 'badge', b }));
    go('result');
    if (ui.celebrate.length) showCelebration(); else if (passed) Sound.sfx('win');
  }

  function viewResult() {
    const R = ui.result, s = settings(), L = D.LEVELS[R.n - 1];
    const msg = R.passed ? (R.n === 10 ? 'Финальный экзамен сдан. Запись для наряда-допуска сформирована.' : `Уровень пройден. Следующий — «${esc(D.LEVELS[R.n].name)}».`)
      : R.outOfLives ? 'Здоровье на ОПО закончилось. Повторите теорию и попробуйте снова — без спешки.'
      : `Не хватило баллов: нужно ${threshold(R.n)}. Почти получилось — повторите теорию и попробуйте ещё раз.`;
    return `
      <section class="card result ${R.passed ? 'ok' : 'bad'}">
        <span class="eyebrow">Уровень ${R.n} · ${esc(L.name)}</span>
        <h1>${R.passed ? 'Отлично!' : 'Пока не пройден'}</h1>
        <p class="lead">${msg}</p>
        <dl class="facts">
          <div><dt>Баллы</dt><dd>${R.score}<small> / ${levelMax(R.n)}</small></dd></div>
          <div><dt>Порог</dt><dd>${threshold(R.n)}</dd></div>
          <div><dt>Верно</dt><dd>${R.correct}</dd></div>
          <div><dt>Ошибок</dt><dd>${R.wrong}</dd></div>
        </dl>
        <div class="btn-row">
          ${R.record ? `<button class="btn primary" data-act="nav" data-v="cabinet">Открыть запись и QR-код</button>` : ''}
          ${R.passed && R.n < 10 ? `<button class="btn primary" data-act="open-level" data-n="${R.n + 1}">К уровню ${R.n + 1}</button>` : ''}
          ${!R.passed ? `<button class="btn primary" data-act="open-level" data-n="${R.n}">Попробовать снова</button>` : ''}
          <button class="btn ghost" data-act="nav" data-v="levels">Карта уровней</button>
        </div>
      </section>`;
  }

  /* ---------- Рейтинг ---------- */
  function viewRating() {
    const p = me(), rows = ratingRows().filter(r => ui.ratingPos === 'all' || r.pos === ui.ratingPos);
    return `
      <div class="page-head"><div><span class="eyebrow">Таблица лидеров</span><h1>Рейтинг работников</h1></div>
        <div class="seg small" role="group" aria-label="Фильтр по должности">
          ${[['all', 'Все'], ...Object.entries(D.POSITIONS).map(([k, v]) => [k, v.short])].map(([k, l]) => `<button class="${ui.ratingPos === k ? 'on' : ''}" data-act="rating-pos" data-pos="${k}">${esc(l)}</button>`).join('')}
        </div>
      </div>
      <p class="muted small">Работники с пометкой «демо» вымышленные. Ваши результаты сохраняются на этом устройстве.</p>
      <div class="table-wrap card flush">
        <table class="table rating">
          <thead><tr><th>#</th><th>Работник</th><th>Должность</th><th class="num">Уровень</th><th class="num">Баллы</th><th>Бейджи</th></tr></thead>
          <tbody>${rows.map(r => `
            <tr class="${p && r.id === p.id ? 'me' : ''}">
              <td class="num rank">${r.rank <= 3 ? `<span class="medal m${r.rank}">${r.rank}</span>` : r.rank}</td>
              <td><b>${esc(r.fio)}</b>${p && r.id === p.id ? ' <span class="pill ok">вы</span>' : r.demo ? ' <span class="pill soft">демо</span>' : ''}<small class="block muted">${esc(r.dept || '')}</small></td>
              <td>${posPill(r.pos)}</td>
              <td class="num">${r.level}</td>
              <td class="num"><b>${r.points}</b></td>
              <td><span class="mini-badges">${r.badges.slice(0, 6).map(id => { const b = D.BADGES.find(x => x.id === id); return b ? `<i title="${esc(b.name)}">${b.sym}</i>` : ''; }).join('')}${r.badges.length > 6 ? `<em>+${r.badges.length - 6}</em>` : ''}</span></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  /* ---------- Личный кабинет ---------- */
  function viewCabinet() {
    const p = me(), pts = totalPoints(p), passed = passedCount(p);
    const rec = st.records.find(r => r.profileId === p.id && r.status !== 'replaced');
    const acc = p.stats.correct + p.stats.wrong ? Math.round(p.stats.correct * 100 / (p.stats.correct + p.stats.wrong)) : 0;
    const recStatus = rec ? recordStatus(rec) : null;
    return `
      <div class="page-head"><div><span class="eyebrow">Личный кабинет</span><h1>${esc(p.fio)}</h1></div>
        <button class="btn ghost small" data-act="switch-profile">Сменить работника</button></div>
      <div class="cab-grid">
        <section class="card profile-card">
          <dl class="kv">
            <div><dt>Должность</dt><dd>${esc(D.POSITIONS[p.pos].name)}</dd></div>
            <div><dt>Опасность работ</dt><dd>${riskMeter(D.POSITIONS[p.pos].risk)} ${D.POSITIONS[p.pos].riskLabel}</dd></div>
            <div><dt>Табельный №</dt><dd class="mono">${esc(p.tab || '—')}</dd></div>
            <div><dt>Подразделение</dt><dd>${esc(p.dept || '—')}</dd></div>
            <div><dt>Вид проверки</dt><dd>${CHECK_TYPES[p.checkType]}</dd></div>
            <div><dt>В тренажёре с</dt><dd>${fmtDate(p.created)}</dd></div>
          </dl>
        </section>
        <section class="card stats-card">
          <div class="stat"><span>Текущий уровень</span><b>${passed}</b><small>${esc(levelTitle(passed))}</small></div>
          <div class="stat"><span>Баллы</span><b>${pts}</b><small>из ${maxTotal()}</small></div>
          <div class="stat"><span>Место в рейтинге</span><b>${rankOf(p)}</b><small>из ${ratingRows().length}</small></div>
          <div class="stat"><span>Точность</span><b>${acc}%</b><small>${p.stats.correct} верно · ${p.stats.wrong} ошибок</small></div>
        </section>
      </div>

      <section class="card record-card ${rec ? recStatus.code : 'none'}">
        <div class="record-head"><div><span class="eyebrow">Запись для оформления наряда-допуска</span><h2>${rec ? 'Запись № <span class="mono">' + esc(rec.id) + '</span>' : 'Запись ещё не сформирована'}</h2></div>
          ${rec ? `<span class="status ${recStatus.code}">${recStatus.label}</span>` : ''}</div>
        ${rec ? `
          <div class="record-body">
            <div class="qr">${qrSvg(recordText(rec))}</div>
            <div class="record-info">
              <dl class="kv">
                <div><dt>Дата</dt><dd>${fmtDate(rec.date)}</dd></div>
                <div><dt>Уровень</dt><dd>10 — ${esc(D.LEVELS[9].name)}</dd></div>
                <div><dt>Баллы</dt><dd>${rec.points} из ${rec.max}</dd></div>
                <div><dt>Действительна</dt><dd>${esc(untilText(rec))}</dd></div>
                <div><dt>Контрольный код</dt><dd class="mono">${rec.check}</dd></div>
              </dl>
              <p class="muted small">Покажите QR-код лицу, выдающему наряд-допуск: в нём ФИО, должность, уровень, дата и срок действия.</p>
              <button class="btn ghost small" data-act="copy-record">Скопировать текст записи</button>
              <pre class="record-text" id="record-text">${esc(recordText(rec))}</pre>
              ${recStatus.code !== 'active' ? `<p class="note">Чтобы получить новую запись, пройдите финальный уровень ещё раз.</p>` : ''}
            </div>
          </div>` : `<p>Запись с QR-кодом появится после успешного прохождения уровня 10 «${esc(D.LEVELS[9].name)}». Пройдено уровней: ${passed} из 10.</p><div class="progress"><i style="width:${passed * 10}%"></i></div>`}
      </section>

      <h2 class="section-title">Бейджи <small>${Object.keys(p.badges).length} из ${D.BADGES.length}</small></h2>
      <ul class="badge-grid">${D.BADGES.map(b => { const on = !!p.badges[b.id]; return `<li class="badge ${on ? 'on' : ''}">${badgeIcon(b, on)}<div><b>${esc(b.name)}</b><small>${esc(b.cond)}</small>${on ? `<em>получен ${fmtDate(p.badges[b.id])}</em>` : ''}</div></li>`; }).join('')}</ul>

      <h2 class="section-title">История прохождения</h2>
      ${p.history.length ? `<div class="table-wrap card flush"><table class="table">
        <thead><tr><th>Дата</th><th>Уровень</th><th class="num">Баллы</th><th class="num">Верно / ошибки</th><th>Итог</th></tr></thead>
        <tbody>${p.history.map(h => `<tr><td>${fmtDateTime(h.date)}</td><td>${h.level}. ${esc(D.LEVELS[h.level - 1].name)}</td><td class="num">${h.score} / ${h.max}</td><td class="num">${h.correct} / ${h.wrong}</td><td>${h.passed ? '<span class="pill ok">пройден</span>' : h.reason === 'lives' ? '<span class="pill bad">здоровье 0</span>' : '<span class="pill bad">мало баллов</span>'}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">Здесь появятся ваши попытки. Начните с уровня 1.</p>'}`;
  }

  /* ---------- Раздел специалиста по ПБ ---------- */
  function viewAdminLogin() {
    return `
      <section class="card narrow">
        <span class="eyebrow">Раздел специалиста по ПБ</span>
        <h1>Вход</h1>
        <p class="muted">Здесь можно посмотреть все вопросы с правильными ответами, изменить вопросы и теорию, настроить пороги баллов и посмотреть результаты работников.</p>
        <form id="admin-form" class="form">
          <label class="field"><span>Пароль</span><input id="admin-pass" type="password" required autocomplete="off"></label>
          <p class="hint">Демо-пароль: <b class="mono">1234</b></p>
          <button class="btn primary wide" type="submit">Войти</button>
        </form>
        ${me() ? '' : '<button class="link" data-act="to-onboard">← К регистрации работника</button>'}
      </section>`;
  }

  function viewAdmin() {
    const tabs = [['people', 'Работники'], ['questions', 'Вопросы и ответы'], ['theory', 'Теория'], ['settings', 'Пороги и баллы'], ['records', 'Записи и QR'], ['concept', 'Концепция']];
    const body = { people: adminPeople, questions: adminQuestions, theory: adminTheory, settings: adminSettings, records: adminRecords, concept: adminConcept }[ui.adminTab]();
    return `
      <div class="page-head"><div><span class="eyebrow">Раздел специалиста по ПБ</span><h1>Управление тренажёром</h1></div>
        <button class="btn ghost small" data-act="admin-logout">Выйти</button></div>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${ui.adminTab === k}" class="${ui.adminTab === k ? 'on' : ''}" data-act="admin-tab" data-tab="${k}">${l}</button>`).join('')}</div>
      ${body}`;
  }

  function adminPeople() {
    const rows = ratingRows();
    return `
      <p class="muted small">Вымышленные работники («демо») и все, кто зарегистрировался на этом устройстве.</p>
      <div class="table-wrap card flush"><table class="table">
        <thead><tr><th>#</th><th>Работник</th><th>Должность</th><th class="num">Уровень</th><th class="num">Баллы</th><th class="num">Бейджи</th><th>Запись</th></tr></thead>
        <tbody>${rows.map(r => {
          const rec = r.local ? st.records.find(x => x.profileId === r.id && x.status !== 'replaced') : null;
          return `<tr><td class="num">${r.rank}</td><td><b>${esc(r.fio)}</b> ${r.demo ? '<span class="pill soft">демо</span>' : '<span class="pill ok">на устройстве</span>'}<small class="block muted">${esc(r.dept || '')}</small></td><td>${posPill(r.pos)}</td><td class="num">${r.level}</td><td class="num">${r.points}</td><td class="num">${r.badges.length}</td><td>${rec ? `<span class="status ${recordStatus(rec).code}">${esc(rec.id)}</span>` : r.demo && r.level === 10 ? '<span class="muted small">демо</span>' : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>
      ${st.profiles.map(p => p.history.length ? `<details class="card details"><summary>История: ${esc(p.fio)} (${p.history.length})</summary>
        <table class="table"><tbody>${p.history.map(h => `<tr><td>${fmtDateTime(h.date)}</td><td>Уровень ${h.level}</td><td class="num">${h.score}/${h.max}</td><td>${h.passed ? 'пройден' : 'не пройден'}</td></tr>`).join('')}</tbody></table></details>` : '').join('')}`;
  }

  function adminQuestions() {
    const f = ui.qFilter, all = questions();
    const list = all.filter(q => (f.topic === 'all' || q.topic === f.topic) && (f.pos === 'any' || q.pos === f.pos) && (f.type === 'all' || q.type === f.type));
    const nTest = all.filter(q => q.type === 'test').length, nCase = all.length - nTest;
    if (ui.editQ) return adminEditQ();
    return `
      <div class="toolbar">
        <label class="field inline"><span>Тема</span><select id="qf-topic" data-filter="topic"><option value="all">Все</option>${Object.entries(D.TOPICS).filter(([k]) => k !== 'mix').map(([k, v]) => `<option value="${k}" ${f.topic === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field inline"><span>Должность</span><select id="qf-pos" data-filter="pos">${[['any', 'Все'], ['all', 'Общие для всех']].concat(Object.entries(D.POSITIONS).map(([k, v]) => [k, v.short])).map(([k, v]) => `<option value="${k}" ${f.pos === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field inline"><span>Тип</span><select id="qf-type" data-filter="type"><option value="all">Все</option><option value="test" ${f.type === 'test' ? 'selected' : ''}>Тесты</option><option value="case" ${f.type === 'case' ? 'selected' : ''}>Ситуации</option></select></label>
        <button class="btn primary small" data-act="q-new">+ Добавить вопрос</button>
      </div>
      <p class="muted small">Всего в банке: ${all.length} (${nTest} тестовых, ${nCase} ситуационных — ${Math.round(nCase * 100 / all.length)} %). Показано: ${list.length}. Правильный ответ отмечен зелёным.</p>
      <ol class="q-admin">${list.map(q => `
        <li class="card">
          <div class="q-tags"><span class="pill ${q.type === 'case' ? 'warn' : ''}">${q.type === 'case' ? 'Ситуация' : 'Тест'}</span><span class="pill soft">${esc(D.TOPICS[q.topic])}</span>${q.pos === 'all' ? '<span class="pill soft">все должности</span>' : posPill(q.pos)}<span class="mono muted small">${esc(q.id)}</span></div>
          <p class="q-text-sm">${esc(q.q)}</p>
          ${q.kind === 'order' ? `<ol class="answers">${q.steps.map(t => `<li class="ok">${esc(t)}</li>`).join('')}</ol>` : `<ul class="answers">${q.a.map((t, k) => `<li class="${k === q.c ? 'ok' : ''}">${esc(t)}</li>`).join('')}</ul>`}
          ${q.ex ? `<p class="muted small">Пояснение: ${esc(q.ex)}</p>` : ''}
          <div class="btn-row"><button class="btn ghost small" data-act="q-edit" data-id="${esc(q.id)}">Изменить</button><button class="btn ghost small danger" data-act="q-del" data-id="${esc(q.id)}">Удалить</button></div>
        </li>`).join('')}</ol>`;
  }

  function adminEditQ() {
    const q = ui.editQ, isOrder = q.kind === 'order';
    return `
      <form id="q-form" class="card form">
        <h2>${q.id ? 'Изменить вопрос' : 'Новый вопрос'}</h2>
        <div class="row3">
          <label class="field"><span>Тема</span><select id="qe-topic" name="topic">${Object.entries(D.TOPICS).filter(([k]) => k !== 'mix').map(([k, v]) => `<option value="${k}" ${q.topic === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label class="field"><span>Должность</span><select id="qe-pos" name="pos"><option value="all">Все должности</option>${Object.entries(D.POSITIONS).map(([k, v]) => `<option value="${k}" ${q.pos === k ? 'selected' : ''}>${esc(v.short)}</option>`).join('')}</select></label>
          <label class="field"><span>Тип</span><select id="qe-type" name="type" data-act-change="qtype"><option value="test" ${q.type === 'test' ? 'selected' : ''}>Тестовый вопрос</option><option value="case" ${q.type === 'case' && !isOrder ? 'selected' : ''}>Ситуация (выбор ответа)</option><option value="order" ${isOrder ? 'selected' : ''}>Ситуация (порядок действий)</option></select></label>
        </div>
        <label class="field"><span>Текст вопроса или ситуации</span><textarea id="qe-q" name="q" rows="3" required>${esc(q.q)}</textarea></label>
        ${isOrder
          ? `<label class="field"><span>Шаги в правильном порядке (каждый с новой строки)</span><textarea id="qe-steps" name="steps" rows="6" required>${esc((q.steps || []).join('\n'))}</textarea></label>`
          : `<label class="field"><span>Варианты ответа (каждый с новой строки)</span><textarea id="qe-a" name="a" rows="5" required>${esc((q.a || []).join('\n'))}</textarea></label>
             <label class="field"><span>Номер правильного варианта (1 — первый)</span><input id="qe-c" name="c" type="number" min="1" max="6" value="${(q.c || 0) + 1}" required></label>`}
        <label class="field"><span>Пояснение после ответа</span><textarea id="qe-ex" name="ex" rows="2">${esc(q.ex || '')}</textarea></label>
        <label class="field"><span>Иллюстрация</span><select id="qe-img" name="img"><option value="">Без иллюстрации</option>${Object.keys(D.ILL).map(k => `<option value="${k}" ${q.img === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <div class="btn-row"><button class="btn primary" type="submit">Сохранить</button><button class="btn ghost" type="button" data-act="q-cancel">Отмена</button></div>
      </form>`;
  }

  function adminTheory() {
    const key = ui.theoryKey;
    const [n, pos] = key.split('-');
    const th = theoryFor(Number(n), pos || 'operator');
    const keys = [];
    D.LEVELS.forEach(L => { if (L.n === 8) Object.keys(D.POSITIONS).forEach(p => keys.push(['8-' + p, `8. Профиль: ${D.POSITIONS[p].short}`])); else keys.push([String(L.n), `${L.n}. ${D.THEORY[L.n].title}`]); });
    return `
      <div class="toolbar"><label class="field inline"><span>Блок теории</span><select id="th-key" data-act-change="th-key">${keys.map(([k, l]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        ${st.content.theory && st.content.theory[key] ? '<button class="btn ghost small" data-act="th-reset">Вернуть исходный текст</button>' : ''}</div>
      <form id="th-form" class="form">
        <label class="field"><span>Название блока</span><input id="th-title" name="title" value="${esc(th.title)}"></label>
        ${th.cards.map((c, i) => `<fieldset class="card field"><legend>Карточка ${i + 1}</legend>
          <label class="field"><span>Заголовок</span><input id="th-h-${i}" name="h${i}" value="${esc(c.h)}"></label>
          <label class="field"><span>Пункты (каждый с новой строки)</span><textarea id="th-t-${i}" name="t${i}" rows="${c.t.length + 1}">${esc(c.t.join('\n'))}</textarea></label>
        </fieldset>`).join('')}
        <button class="btn primary" type="submit">Сохранить теорию</button>
      </form>`;
  }

  function adminSettings() {
    const s = settings();
    return `
      <form id="set-form" class="form">
        <div class="card"><h2>Баллы и здоровье</h2>
          <div class="row3">
            <label class="field"><span>За верный тест, баллов</span><input id="s-ptsTest" name="ptsTest" type="number" min="1" max="100" value="${s.ptsTest}"></label>
            <label class="field"><span>За верную ситуацию, баллов</span><input id="s-ptsCase" name="ptsCase" type="number" min="1" max="100" value="${s.ptsCase}"></label>
            <label class="field"><span>Штраф за ошибку, баллов</span><input id="s-penalty" name="penalty" type="number" min="0" max="100" value="${s.penalty}"></label>
            <label class="field"><span>Здоровье на ОПО (жизней)</span><input id="s-lives" name="lives" type="number" min="1" max="10" value="${s.lives}"></label>
            <label class="field"><span>Серия для восстановления жизни</span><input id="s-restore" name="restoreStreak" type="number" min="2" max="20" value="${s.restoreStreak}"></label>
            <label class="field"><span>Срок записи при общей проверке, мес.</span><input id="s-valid" name="validityMonths" type="number" min="1" max="60" value="${s.validityMonths}"></label>
          </div>
        </div>
        <div class="card flush table-wrap"><table class="table">
          <thead><tr><th>Уровень</th><th class="num">Тестов</th><th class="num">Ситуаций</th><th class="num">Максимум</th><th class="num">Порог перехода</th></tr></thead>
          <tbody>${D.LEVELS.map((L, i) => `<tr><td>${L.n}. ${esc(L.name)}</td>
            <td class="num"><input class="cell" id="s-t-${i}" name="t${i}" type="number" min="1" max="20" value="${s.counts[i][0]}"></td>
            <td class="num"><input class="cell" id="s-c-${i}" name="c${i}" type="number" min="0" max="10" value="${s.counts[i][1]}"></td>
            <td class="num">${levelMax(L.n)}</td>
            <td class="num"><input class="cell" id="s-th-${i}" name="th${i}" type="number" min="1" max="1000" value="${s.thresholds[i]}"></td></tr>`).join('')}</tbody>
        </table></div>
        <div class="btn-row"><button class="btn primary" type="submit">Сохранить настройки</button><button class="btn ghost" type="button" data-act="set-default">Вернуть по умолчанию</button></div>
      </form>
      <section class="card danger-zone">
        <h2>Сброс данных на устройстве</h2>
        <p class="muted">Удалит всех зарегистрированных здесь работников, их результаты, записи и правки контента.</p>
        ${ui.confirmReset ? `<div class="btn-row"><button class="btn danger" data-act="reset-all">Да, удалить всё</button><button class="btn ghost" data-act="reset-cancel">Отмена</button></div>` : `<button class="btn ghost danger" data-act="reset-ask">Сбросить все данные</button>`}
      </section>`;
  }

  function adminRecords() {
    const v = ui.verify.trim().toUpperCase();
    const found = v ? st.records.find(r => r.id.toUpperCase() === v || r.check === v) : null;
    return `
      <section class="card">
        <h2>Проверка записи</h2>
        <form id="verify-form" class="toolbar"><label class="field inline grow"><span>Номер записи или контрольный код</span><input id="verify-input" value="${esc(ui.verify)}" placeholder="ПБ-2026-…"></label><button class="btn primary small" type="submit">Проверить</button></form>
        ${v ? (found ? `<p><span class="status ${recordStatus(found).code}">${recordStatus(found).label}</span> ${esc(found.fio)}, ${esc(D.POSITIONS[found.pos].short)}, действительна: ${esc(untilText(found))}.</p>` : '<p class="note">Запись не найдена на этом устройстве.</p>') : ''}
      </section>
      <h2 class="section-title">Записи на этом устройстве</h2>
      ${st.records.length ? `<div class="table-wrap card flush"><table class="table">
        <thead><tr><th>Номер</th><th>Работник</th><th>Вид проверки</th><th>Дата</th><th>Действительна</th><th>Статус</th><th></th></tr></thead>
        <tbody>${st.records.map(r => { const s = recordStatus(r); return `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.fio)}<small class="block muted">${esc(D.POSITIONS[r.pos].short)}</small></td><td>${r.checkType === 'hazard' ? 'Работы повышенной опасности' : 'Общая'}</td><td>${fmtDate(r.date)}</td><td>${esc(untilText(r))}</td><td><span class="status ${s.code}">${s.label}</span></td>
          <td>${s.code === 'active' ? `<button class="btn ghost small" data-act="rec-used" data-id="${esc(r.id)}">Наряд-допуск выдан</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<p class="muted">Записей пока нет. Запись появляется, когда работник сдаёт финальный 10-й уровень.</p>'}
      <p class="muted small">Кнопка «Наряд-допуск выдан» закрывает запись: при подготовке к работам повышенной опасности она действует только до выдачи следующего наряда-допуска.</p>`;
  }

  function adminConcept() {
    const s = settings();
    return `
      <article class="card prose">
        <h2>1. Уровни и пороги</h2>
        <div class="table-wrap"><table class="table"><thead><tr><th>№</th><th>Уровень</th><th>Тема</th><th class="num">Заданий</th><th class="num">Порог / максимум</th></tr></thead>
          <tbody>${D.LEVELS.map(L => `<tr><td>${L.n}</td><td>${esc(L.name)}</td><td>${esc(L.final ? 'Финальный экзамен: все темы + профиль должности' : D.TOPICS[L.topic])}</td><td class="num">${s.counts[L.n - 1][0]} + ${s.counts[L.n - 1][1]}</td><td class="num">${threshold(L.n)} / ${levelMax(L.n)}</td></tr>`).join('')}</tbody></table></div>
        <p>Уровни открываются по порядку. В сумме можно набрать ${maxTotal()} баллов; в рейтинг идёт лучший результат по каждому пройденному уровню.</p>

        <h2>2. Здоровье на ОПО</h2>
        <ul><li>На каждую попытку уровня даётся ${s.lives} единицы здоровья.</li><li>Ошибка: −${s.penalty} баллов (не ниже нуля) и −1 здоровье.</li>
          <li>${s.restoreStreak} верных ответа подряд восстанавливают 1 здоровье (не выше максимума).</li><li>Здоровье 0 — попытка прекращается, уровень проходят заново, теорию можно повторить.</li></ul>

        <h2>3. Бейджи</h2>
        <ul>${D.BADGES.map(b => `<li><b>${esc(b.name)}</b> — ${esc(b.cond)}</li>`).join('')}</ul>

        <h2>4. Личный кабинет</h2>
        <ul><li>Профиль: ФИО, табельный номер, должность и её уровень опасности, подразделение, вид проверки.</li><li>Показатели: уровень, баллы, место в рейтинге, точность ответов.</li>
          <li>Запись для наряда-допуска с QR-кодом и статусом.</li><li>Бейджи: полученные и условия остальных.</li><li>История всех попыток.</li></ul>

        <h2>5. Содержание</h2>
        <p>Перед каждым уровнем — короткая теория в карточках со схемами. Задания: ~75 % тестовых и ~25 % ситуационных (в каждом уровне ${s.counts[0][0]} + ${s.counts[0][1]}, в финале ${s.counts[9][0]} + ${s.counts[9][1]}). Часть вопросов общая, часть — только для конкретной должности; уровень 8 целиком посвящён профилю должности.</p>
        <ul>${Object.entries(D.POSITIONS).map(([k, v]) => `<li><b>${esc(v.name)}</b> — опасность: ${v.riskLabel.toLowerCase()}. ${esc(v.profile)}.</li>`).join('')}</ul>

        <h2>6. Как появляется запись и QR-код</h2>
        <ol><li>Работник сдаёт финальный 10-й уровень.</li><li>Система формирует запись: номер, ФИО, табельный номер, должность, подразделение, уровень, баллы, дату, вид проверки, срок действия и контрольный код.</li>
          <li>Из текста записи строится QR-код, его показывают лицу, выдающему наряд-допуск.</li>
          <li>Срок: при общей проверке знаний — по нормам НПА (сейчас ${s.validityMonths} мес.); при подготовке к работам повышенной опасности — до выдачи следующего наряда-допуска (специалист отмечает выдачу во вкладке «Записи и QR»).</li></ol>

        <h2>7. Стиль и тон</h2>
        <p>Строгий промышленный стиль с дружелюбным, мотивирующим тоном: нефтяной сине-зелёный цвет, сигнальный оранжевый для акцентов, понятные схемы оборудования. Ошибки объясняются без упрёков. Нейтральная фоновая музыка, анимация поздравления при новом уровне и бейдже.</p>
      </article>`;
  }

  /* ---------- Поздравления ---------- */
  function showCelebration() {
    const c = ui.celebrate.shift();
    if (!c) return;
    Sound.sfx('win');
    const box = document.createElement('div');
    box.className = 'celebrate';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `<canvas></canvas><div class="celebrate-card">
      ${c.kind === 'level' ? `<span class="eyebrow">Новый уровень</span><div class="big-level">${c.n}</div><h2>${esc(D.LEVELS[c.n - 1].name)}</h2><p>${c.n === 10 ? 'Вы допущены! Запись с QR-кодом ждёт в личном кабинете.' : 'Так держать! Следующий уровень открыт.'}</p>`
        : `<span class="eyebrow">Новый бейдж</span>${badgeIcon(c.b, true)}<h2>${esc(c.b.name)}</h2><p>${esc(c.b.cond)}</p>`}
      <button class="btn primary" data-close>Продолжить</button></div>`;
    document.body.appendChild(box);
    confetti(box.querySelector('canvas'));
    box.querySelector('[data-close]').focus();
    box.addEventListener('click', e => { if (e.target.closest('[data-close]')) { box.remove(); showCelebration(); } });
  }
  function confetti(cv) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cv.getContext('2d'), W = cv.width = innerWidth, H = cv.height = innerHeight;
    const css = getComputedStyle(document.documentElement);
    const colors = ['--signal', '--brand', '--gold', '--ok'].map(v => css.getPropertyValue(v).trim() || '#f60');
    const parts = Array.from({ length: 140 }, () => ({ x: W / 2, y: H / 2.4, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -13 - 3, s: Math.random() * 6 + 4, r: Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)] }));
    let t = 0;
    (function frame() {
      if (!cv.isConnected || t++ > 220) return;
      ctx.clearRect(0, 0, W, H);
      parts.forEach(p => { p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += 0.1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
      requestAnimationFrame(frame);
    })();
  }

  /* ---------- Рендер ---------- */
  function render() {
    const p = me();
    if (!p && ui.view !== 'admin') { root.innerHTML = viewOnboard(); return; }
    if (ui.view === 'admin' && !p) { root.innerHTML = `<div class="solo">${ui.admin ? viewAdmin() : viewAdminLogin()}</div>`; return; }
    const views = { levels: viewLevels, level: viewLevelIntro, theory: viewTheory, quiz: viewQuiz, result: viewResult, rating: viewRating, cabinet: viewCabinet, admin: () => ui.admin ? viewAdmin() : viewAdminLogin() };
    root.innerHTML = shell((views[ui.view] || viewLevels)());
  }

  /* ---------- Действия ---------- */
  const actions = {
    nav(el) {
      if (ui.view === 'quiz' && ui.session) { ui.session = null; }
      go(el.dataset.v);
    },
    sound() {
      st.sound = !st.sound; save();
      if (st.sound) Sound.startMusic(); else Sound.stopMusic();
      render();
    },
    'pick-profile'(el) { st.currentId = el.dataset.id; save(); ui.view = 'levels'; render(); Sound.startMusic(); },
    'switch-profile'() { st.currentId = null; save(); ui.view = 'levels'; render(); },
    'to-onboard'() { ui.view = 'levels'; render(); },
    'open-level'(el) {
      const n = Number(el.dataset.n), p = me();
      if (!unlocked(p, n)) return;
      ui.levelN = n; ui.theoryIdx = 0; go('level');
    },
    'start-theory'() { ui.theoryIdx = 0; go('theory'); Sound.startMusic(); },
    'theory-next'() { ui.theoryIdx++; render(); },
    'theory-prev'() { ui.theoryIdx = Math.max(0, ui.theoryIdx - 1); render(); },
    'start-quiz'() { startQuiz(); },
    answer(el) {
      const S = ui.session; if (S.answered) return;
      S.pickIdx = Number(el.dataset.k);
      judge(S.items[S.i].opts[S.pickIdx].ok);
    },
    'seq-add'(el) { const S = ui.session; S.seq.push(Number(el.dataset.k)); render(); },
    'seq-reset'() { ui.session.seq = []; render(); },
    'seq-check'() { const S = ui.session; judge(S.seq.every((k, i) => k === i)); },
    next() {
      const S = ui.session;
      if (S.lives <= 0 || S.i === S.items.length - 1) return finishQuiz();
      S.i++; S.answered = false; S.pickIdx = null; S.seq = []; S.restored = false;
      render(); window.scrollTo(0, 0);
    },
    'quit-quiz'() { ui.session = null; go('level'); toast('Попытка прервана и не засчитана.'); },
    'rating-pos'(el) { ui.ratingPos = el.dataset.pos; render(); },
    'copy-record'() {
      const txt = document.getElementById('record-text');
      const done = () => toast('Текст записи скопирован');
      const fallback = () => { const r = document.createRange(); r.selectNodeContents(txt); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Текст выделен — скопируйте его'); };
      try { navigator.clipboard.writeText(txt.textContent).then(done, fallback); } catch (e) { fallback(); }
    },
    'admin-tab'(el) { ui.adminTab = el.dataset.tab; ui.editQ = null; render(); },
    'admin-logout'() { ui.admin = false; ui.editQ = null; go(me() ? 'levels' : 'admin'); },
    'q-new'() { ui.editQ = { id: '', topic: ui.qFilter.topic !== 'all' ? ui.qFilter.topic : 'general', pos: 'all', type: 'test', q: '', a: ['', '', '', ''], c: 0, ex: '' }; render(); },
    'q-edit'(el) { ui.editQ = JSON.parse(JSON.stringify(questions().find(q => q.id === el.dataset.id))); render(); },
    'q-cancel'() { ui.editQ = null; render(); },
    'q-del'(el) {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Точно удалить?'; return; }
      st.content.questions = questions().filter(q => q.id !== el.dataset.id); save(); toast('Вопрос удалён'); render();
    },
    'th-reset'() { delete st.content.theory[ui.theoryKey]; save(); toast('Исходный текст восстановлен'); render(); },
    'set-default'() { st.settings = null; save(); toast('Настройки по умолчанию'); render(); },
    'reset-ask'() { ui.confirmReset = true; render(); },
    'reset-cancel'() { ui.confirmReset = false; render(); },
    'reset-all'() { const sound = st.sound; st = blank(); st.sound = sound; save(); ui.confirmReset = false; ui.admin = false; toast('Данные удалены'); go('admin'); },
    'rec-used'(el) { const r = st.records.find(x => x.id === el.dataset.id); if (r) { r.status = 'used'; save(); toast('Запись закрыта: наряд-допуск выдан'); render(); } },
  };

  root.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });

  root.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.filter) { ui.qFilter[el.dataset.filter] = el.value; render(); }
    if (el.dataset.actChange === 'th-key') { ui.theoryKey = el.value; render(); }
    if (el.dataset.actChange === 'qtype') {
      const form = new FormData(document.getElementById('q-form'));
      const v = el.value;
      ui.editQ = Object.assign(ui.editQ, { topic: form.get('topic'), pos: form.get('pos'), q: form.get('q'), ex: form.get('ex'), img: form.get('img') || undefined, type: v === 'test' ? 'test' : 'case', kind: v === 'order' ? 'order' : undefined });
      if (v === 'order' && !ui.editQ.steps) ui.editQ.steps = ['', '', ''];
      if (v !== 'order' && !ui.editQ.a) { ui.editQ.a = ['', '', '', '']; ui.editQ.c = 0; }
      render();
    }
  });

  root.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, fd = new FormData(f);
    if (f.id === 'reg-form') {
      const fio = String(fd.get('fio')).trim();
      if (!fio) return;
      const p = { id: uid(), fio, tab: String(fd.get('tab')).trim(), dept: String(fd.get('dept')).trim(), pos: fd.get('pos'), checkType: fd.get('check'), created: new Date().toISOString(), levels: {}, history: [], badges: {}, stats: { correct: 0, wrong: 0, casesOk: 0, bestStreak: 0 } };
      st.profiles.push(p); st.currentId = p.id; save();
      ui.view = 'levels'; render(); Sound.startMusic();
      toast('Добро пожаловать! Начните с уровня 1.');
    }
    if (f.id === 'admin-form') {
      if (document.getElementById('admin-pass').value === ADMIN_PASSWORD) { ui.admin = true; ui.adminTab = 'questions'; render(); }
      else toast('Неверный пароль. Демо-пароль: 1234');
    }
    if (f.id === 'q-form') {
      const q = ui.editQ, type = fd.get('type');
      const out = { id: q.id || 'u' + uid(), topic: fd.get('topic'), pos: fd.get('pos'), type: type === 'test' ? 'test' : 'case', q: String(fd.get('q')).trim(), ex: String(fd.get('ex') || '').trim() };
      if (fd.get('img')) out.img = fd.get('img');
      if (type === 'order') {
        out.kind = 'order';
        out.steps = String(fd.get('steps')).split('\n').map(s => s.trim()).filter(Boolean);
        if (out.steps.length < 2) { toast('Нужно хотя бы 2 шага'); return; }
      } else {
        out.a = String(fd.get('a')).split('\n').map(s => s.trim()).filter(Boolean);
        out.c = Number(fd.get('c')) - 1;
        if (out.a.length < 2) { toast('Нужно хотя бы 2 варианта ответа'); return; }
        if (!(out.c >= 0 && out.c < out.a.length)) { toast('Номер правильного варианта вне списка'); return; }
      }
      const list = questions().slice();
      const i = list.findIndex(x => x.id === q.id);
      if (i >= 0) list[i] = out; else list.push(out);
      st.content.questions = list; save();
      ui.editQ = null; toast('Вопрос сохранён'); render();
    }
    if (f.id === 'th-form') {
      const [n, pos] = ui.theoryKey.split('-');
      const th = theoryFor(Number(n), pos || 'operator');
      st.content.theory = st.content.theory || {};
      st.content.theory[ui.theoryKey] = { title: String(fd.get('title')).trim(), cards: th.cards.map((c, i) => ({ h: String(fd.get('h' + i)).trim(), t: String(fd.get('t' + i)).split('\n').map(s => s.trim()).filter(Boolean) })) };
      save(); toast('Теория сохранена'); render();
    }
    if (f.id === 'set-form') {
      const num = k => Math.max(0, Number(fd.get(k)) || 0);
      const next = { ptsTest: num('ptsTest') || 10, ptsCase: num('ptsCase') || 20, penalty: num('penalty'), lives: num('lives') || 3, restoreStreak: num('restoreStreak') || 3, validityMonths: num('validityMonths') || 12,
        counts: D.LEVELS.map((L, i) => [Math.max(1, num('t' + i)), num('c' + i)]), thresholds: D.LEVELS.map((L, i) => Math.max(1, num('th' + i))) };
      st.settings = next; save(); toast('Настройки сохранены'); render();
    }
    if (f.id === 'verify-form') { ui.verify = document.getElementById('verify-input').value; render(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const c = document.querySelector('.celebrate'); if (c) { c.remove(); showCelebration(); } }
  });

  render();
})();
