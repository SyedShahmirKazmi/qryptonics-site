/* ══════════════════════════════════════════════════════════
   Reading tools for blog posts.

   A slim strip on the right edge opens a panel on hover, focus or
   tap: text size, line spacing, line width, font, contrast, term
   explanations, contents, progress and a few actions. Settings are
   kept per browser in localStorage and applied as data attributes
   on <html>, which the stylesheet reads, so nothing inline is
   parsed and the strict CSP holds.

   Loaded in <head> without defer so saved settings apply before the
   first paint; the panel itself is built once the DOM is ready.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'qx-reader';
  var root = document.documentElement;
  var DEF = { fs: 2, lh: 1, mw: 1, ff: 'sans', hc: 0, terms: 1 };
  var SIZES = ['Small', 'Medium', 'Large', 'Larger', 'Largest'];
  var CHOICES = {
    lh: { label: 'Line spacing', opts: [['Normal', 0], ['Relaxed', 1], ['Loose', 2]] },
    mw: { label: 'Line width', opts: [['Narrow', 0], ['Comfortable', 1], ['Full', 2]] },
    ff: { label: 'Font', opts: [['Sans', 'sans'], ['Serif', 'serif'], ['Spaced', 'spaced']] },
    hc: { label: 'Contrast', opts: [['Normal', 0], ['High', 1]] }
  };

  var s = load();
  apply();

  function valid(k, v) {
    if (k === 'fs') return v === +v && v >= 0 && v < SIZES.length;
    if (k === 'terms') return v === 0 || v === 1;
    return CHOICES[k].opts.some(function (o) { return o[1] === v; });
  }
  function load() {
    var o = {}, saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    for (var k in DEF) o[k] = valid(k, saved[k]) ? saved[k] : DEF[k];
    return o;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function apply() {
    for (var k in s) root.setAttribute('data-rd-' + k, s[k]);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, label) {
    var b = el('button', 'rd__btn', text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function group(title) {
    var g = el('div', 'rd__g');
    g.setAttribute('role', 'group');
    var id = 'rd-' + title.toLowerCase().replace(/\W+/g, '-');
    var h = el('p', 'rd__label', title);
    h.id = id;
    g.setAttribute('aria-labelledby', id);
    g.appendChild(h);
    return g;
  }

  function build() {
    var article = document.querySelector('.prose--post');
    if (!article) return;

    var rd = el('aside', 'rd');
    rd.setAttribute('aria-label', 'Reading tools');

    var strip = el('button', 'rd__strip');
    strip.type = 'button';
    strip.setAttribute('aria-expanded', 'false');
    strip.setAttribute('aria-controls', 'rd-panel');
    strip.setAttribute('aria-label', 'Reading tools: text size, spacing, contrast and contents');
    var bar = el('span', 'rd__bar');
    var fill = el('span', 'rd__fill');
    bar.appendChild(fill);
    bar.setAttribute('aria-hidden', 'true');
    strip.appendChild(bar);

    var panel = el('div', 'rd__panel');
    panel.id = 'rd-panel';

    var head = el('div', 'rd__head');
    head.appendChild(el('p', 'rd__title', 'Reading tools'));
    var prog = el('p', 'rd__prog');
    head.appendChild(prog);
    panel.appendChild(head);

    /* text size */
    var gs = group('Text size');
    var row = el('div', 'rd__size');
    var dec = button('A−', 'Smaller text');
    var val = el('output', 'rd__val');
    var inc = button('A+', 'Larger text');
    dec.classList.add('rd__btn--sm');
    inc.classList.add('rd__btn--lg');
    row.appendChild(dec); row.appendChild(val); row.appendChild(inc);
    gs.appendChild(row);
    panel.appendChild(gs);
    dec.addEventListener('click', function () { set('fs', Math.max(0, s.fs - 1)); });
    inc.addEventListener('click', function () { set('fs', Math.min(SIZES.length - 1, s.fs + 1)); });

    /* segmented choices */
    var segs = {};
    Object.keys(CHOICES).forEach(function (k) {
      var g = group(CHOICES[k].label);
      var seg = el('div', 'rd__seg');
      segs[k] = CHOICES[k].opts.map(function (o) {
        var b = button(o[0]);
        b.addEventListener('click', function () { set(k, o[1]); });
        seg.appendChild(b);
        return [b, o[1]];
      });
      g.appendChild(seg);
      panel.appendChild(g);
    });

    /* term explanations */
    var terms = [].slice.call(article.querySelectorAll('.term'));
    var termBtn = null;
    if (terms.length) {
      var gt = group('Explain terms');
      termBtn = button('');
      termBtn.classList.add('rd__btn--wide');
      termBtn.addEventListener('click', function () { set('terms', s.terms ? 0 : 1); });
      gt.appendChild(termBtn);
      var hint = el('p', 'rd__hint', 'Dotted words show a short explanation on hover or tap.');
      gt.appendChild(hint);
      panel.appendChild(gt);
    }

    /* contents */
    var heads = [].slice.call(article.querySelectorAll('h2[id]'))
      .filter(function (h) { return !h.closest('.post-tldr'); });
    var tocLinks = [];
    if (heads.length) {
      var gc = group('Contents');
      var list = el('ol', 'rd__toc');
      heads.forEach(function (h) {
        var li = el('li');
        var a = el('a', null, h.textContent);
        a.href = '#' + h.id;
        a.addEventListener('click', close);
        li.appendChild(a);
        list.appendChild(li);
        tocLinks.push(a);
      });
      gc.appendChild(list);
      panel.appendChild(gc);
    }

    /* actions */
    var ga = group('Actions');
    var acts = el('div', 'rd__acts');
    var copy = button('Copy link');
    var print = button('Print');
    var top = button('Back to top');
    var reset = button('Reset');
    [copy, print, top, reset].forEach(function (b) { acts.appendChild(b); });
    ga.appendChild(acts);
    panel.appendChild(ga);

    copy.addEventListener('click', function () {
      var url = location.href.split('#')[0];
      var done = function (ok) {
        copy.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(function () { copy.textContent = 'Copy link'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
      } else { done(false); }
    });
    print.addEventListener('click', function () { close(); window.print(); });
    top.addEventListener('click', function () { close(); window.scrollTo(0, 0); });
    reset.addEventListener('click', function () {
      for (var k in DEF) s[k] = DEF[k];
      apply(); save(); sync();
    });

    rd.appendChild(strip);
    rd.appendChild(panel);
    document.body.insertBefore(rd, document.getElementById('main'));

    /* ── open / close ─────────────────────────────────────
       Hover opens it in CSS. Everything else is this one class:
       a click or tap toggles it, keyboard focus opens it, and it
       closes on Escape, a tap outside, or focus leaving the tools.
       Pointer focus is ignored so a tapped button cannot hold the
       panel open after the user has moved on. */
    var suppress = false;
    function open() { rd.classList.add('is-open'); strip.setAttribute('aria-expanded', 'true'); }
    function close() {
      rd.classList.remove('is-open');
      strip.setAttribute('aria-expanded', 'false');
      if (rd.contains(document.activeElement)) document.activeElement.blur();
    }
    strip.addEventListener('click', function () {
      rd.classList.contains('is-open') ? close() : open();
    });
    rd.addEventListener('focusin', function (e) {
      if (suppress) { suppress = false; return; }
      if (e.target.matches && e.target.matches(':focus-visible')) open();
    });
    rd.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !rd.contains(e.relatedTarget)) close();
    });
    document.addEventListener('click', function (e) {
      if (rd.classList.contains('is-open') && !rd.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && (rd.classList.contains('is-open') || rd.contains(document.activeElement))) {
        close();
        if (document.activeElement !== strip) {
          suppress = true;        /* hand focus back without reopening */
          strip.focus();
        }
      }
    });

    function set(k, v) { s[k] = v; apply(); save(); sync(); }

    function sync() {
      val.textContent = SIZES[s.fs];
      dec.disabled = s.fs === 0;
      inc.disabled = s.fs === SIZES.length - 1;
      Object.keys(segs).forEach(function (k) {
        segs[k].forEach(function (pair) { pair[0].setAttribute('aria-pressed', String(pair[1] === s[k])); });
      });
      if (termBtn) {
        termBtn.textContent = s.terms ? 'On' : 'Off';
        termBtn.setAttribute('aria-pressed', String(!!s.terms));
        /* The tooltip engine reads data-tip on hover, so parking the
           text in another attribute switches explanations off. */
        terms.forEach(function (t) {
          if (s.terms) {
            if (t.hasAttribute('data-tip-off')) t.setAttribute('data-tip', t.getAttribute('data-tip-off'));
            t.removeAttribute('data-tip-off');
            t.tabIndex = 0;
          } else {
            if (t.hasAttribute('data-tip')) t.setAttribute('data-tip-off', t.getAttribute('data-tip'));
            t.removeAttribute('data-tip');
            t.removeAttribute('tabindex');
          }
        });
      }
      progress();
    }

    /* ── progress: the strip fills as you read ───────────── */
    var words = (article.textContent.match(/\S+/g) || []).length;
    var allLinks = tocLinks.concat([].slice.call(document.querySelectorAll('.post-toc a')));
    var ticking = false;
    function progress() {
      var r = article.getBoundingClientRect();
      var span = r.height - window.innerHeight * 0.6;
      var p = span > 0 ? (window.innerHeight * 0.4 - r.top) / span : 1;
      p = Math.max(0, Math.min(1, p));
      fill.style.setProperty('--rd-p', p.toFixed(3));
      var left = Math.ceil(words * (1 - p) / 220);
      prog.textContent = Math.round(p * 100) + '%' + (left > 0 ? ' · ' + left + ' min left' : ' · done');

      /* current section: the last heading above 40% of the viewport,
         marked in both contents lists */
      var current = null;
      for (var i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top < window.innerHeight * 0.4) current = heads[i].id;
      }
      allLinks.forEach(function (a) {
        if (current && a.getAttribute('href') === '#' + current) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; progress(); });
    }, { passive: true });
    window.addEventListener('resize', progress);

    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
