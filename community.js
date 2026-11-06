/* ══════════════════════════════════════════════════════════
   Qryptonics — community signup
   Works with no backend: without an endpoint the form composes a
   joining request in the visitor's mail client and copies it to the
   clipboard, so no third party ever sees the data. Set FORM_ENDPOINT
   to POST instead — see README for the CSP change that requires.
   ══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var FORM_ENDPOINT = '';           // e.g. 'https://forms.example.com/x/abc123'
  var INBOX = 'hello@qryptonics.com';

  var form = document.getElementById('join');
  if (!form) return;

  var status = document.getElementById('form-status');
  var done = document.getElementById('form-done');

  function esc(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fieldOf(input) { return input.closest('.field'); }

  function setBad(input, bad) {
    var f = fieldOf(input);
    if (f) f.classList.toggle('is-bad', bad);
    input.setAttribute('aria-invalid', String(bad));
  }

  /* Validation runs on submit, then live only on fields already flagged,
     so nobody gets shouted at while they are still typing. */
  function validate(showAll) {
    var bad = [];

    ['name', 'email', 'country', 'role', 'level'].forEach(function (id) {
      var el = form.elements[id];
      var empty = !String(el.value || '').trim();
      if (showAll || fieldOf(el).classList.contains('is-bad')) setBad(el, empty);
      if (empty) bad.push(el);
    });

    var email = form.elements.email;
    if (String(email.value).trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) {
      if (showAll || fieldOf(email).classList.contains('is-bad')) setBad(email, true);
      bad.push(email);
    }

    var interests = form.querySelectorAll('input[name="interest"]:checked');
    var iField = document.getElementById('interest-field');
    if (showAll || iField.classList.contains('is-bad')) iField.classList.toggle('is-bad', !interests.length);
    if (!interests.length) bad.push(form.querySelector('input[name="interest"]'));

    var consent = form.elements.consent;
    if (showAll || fieldOf(consent).classList.contains('is-bad')) setBad(consent, !consent.checked);
    if (!consent.checked) bad.push(consent);

    return bad;
  }

  form.addEventListener('input', function (e) {
    if (e.target.name) validate(false);
  });
  form.addEventListener('change', function (e) {
    if (e.target.name) validate(false);
  });

  function collect() {
    var d = {};
    ['name', 'email', 'country', 'city', 'affiliation', 'role', 'level', 'goal'].forEach(function (k) {
      var el = form.elements[k];
      // maxlength only governs typing; enforce it on whatever value arrives
      d[k] = String(el.value || '').trim().slice(0, el.maxLength > 0 ? el.maxLength : 200);
    });
    d.interests = [].map.call(form.querySelectorAll('input[name="interest"]:checked'),
      function (c) { return c.value; });
    d.updates = form.elements.updates.checked;
    return d;
  }

  function asText(d) {
    var t = 'Community joining request\n\n';
    t += 'Name        : ' + d.name + '\n';
    t += 'Email       : ' + d.email + '\n';
    t += 'Country     : ' + d.country + '\n';
    if (d.city) t += 'City        : ' + d.city + '\n';
    if (d.affiliation) t += 'Affiliation : ' + d.affiliation + '\n';
    t += 'Role        : ' + d.role + '\n';
    t += 'Experience  : ' + d.level + '\n';
    t += 'Interests   : ' + d.interests.join(', ') + '\n';
    t += 'Newsletter  : ' + (d.updates ? 'yes' : 'no') + '\n';
    if (d.goal) t += '\nWhat they want from it:\n' + d.goal + '\n';
    t += '\nConsent given on this device at the time of sending.\n';
    return t;
  }

  function say(msg, ok) {
    status.textContent = msg;
    status.className = 'form__status is-on ' + (ok ? 'is-ok' : 'is-err');
  }

  function succeed(d) {
    form.hidden = true;
    done.hidden = false;
    done.querySelector('[data-name]').textContent = d.name.split(' ')[0] || 'there';
    done.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var bad = validate(true);
    if (bad.length) {
      say('Check the highlighted fields. ' + bad.length + ' still need attention.', false);
      bad[0].focus();
      return;
    }

    var d = collect();

    if (FORM_ENDPOINT) {
      say('Sending…', true);
      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d)
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        succeed(d);
      }).catch(function () {
        say('That did not go through. Email ' + INBOX + ' and we will add you by hand.', false);
      });
      return;
    }

    /* No endpoint configured: hand the request to the visitor's own mail
       client. Nothing is transmitted anywhere until they press send. */
    var body = asText(d);
    var href = 'mailto:' + INBOX +
      '?subject=' + encodeURIComponent('Community — ' + d.name) +
      '&body=' + encodeURIComponent(body);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(body).catch(function () { /* clipboard blocked, mail still opens */ });
    }
    window.location.href = href;
    succeed(d);
  });

  /* Mirror the count of selected interests for screen readers. */
  var counter = document.getElementById('interest-count');
  form.addEventListener('change', function (e) {
    if (e.target.name !== 'interest') return;
    var n = form.querySelectorAll('input[name="interest"]:checked').length;
    counter.textContent = n ? n + ' selected' : '';
  });
})();
