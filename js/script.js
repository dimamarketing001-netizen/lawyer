(function () {
  'use strict';

  var PHONE = '+7 (921) 117-62-38';
  var PHONE_HREF = 'tel:+79211176238';
  var AVATAR = 'assets/img/avatar.jpg';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Режим работы. Часы считаем по одному поясу, а не по часам посетителя:
  // иначе клиенту из Владивостока покажет «на связи», когда в офисе ночь.
  var SCHEDULE = { fromHour: 9, toHour: 19, tzOffset: 3 }; // МСК

  function isWorkingNow() {
    var now = new Date();
    var office = new Date(now.getTime() + (SCHEDULE.tzOffset * 60 + now.getTimezoneOffset()) * 60000);
    var day = office.getDay();
    if (day === 0 || day === 6) return false;
    var hour = office.getHours();
    return hour >= SCHEDULE.fromHour && hour < SCHEDULE.toHour;
  }

  /* =======================================================
     НАСТРОЙКИ ПЕРЕД ЗАПУСКОМ РЕКЛАМЫ
     ======================================================= */

  // Номер счётчика Яндекс.Метрики. Пока 0 — цели не отправляются.
  var YM_ID = 0;

  // Уведомления о заявках других посетителей.
  // Включать ТОЛЬКО когда ACTIVITY приходит с бэкенда с реальными обращениями:
  // выдуманная активность — недостоверная реклама, и её замечают.
  var SHOW_ACTIVITY = false;

  // Формат: [{ city: 'Санкт-Петербург', topic: 'долги', minutesAgo: 6 }]
  // Заполнять с сервера, обезличенно — без имён и телефонов.
  var ACTIVITY = [];

  // Ссылка на площадку с отзывами (Яндекс.Карты, 2ГИС, Отзовик).
  var REVIEWS_LINK = '';

  // Специалист. Заполнить по документам: статус бывшего судьи — проверяемый факт,
  // и в рекламе он должен подтверждаться (ст. 5 ФЗ «О рекламе»).
  var LAWYER = {
    name:   'Державина Виктория Александровна',
    short:  'Виктории Александровны',  // родительный падеж
    first:  'Виктория',
    court:  '',      // напр. 'Кировский районный суд Санкт-Петербурга'
    period: '',      // напр. '2008–2021'
    years:  20,
    photo:  'assets/img/lawyer.jpg'
  };

  // Отзывы. Пустой массив — блок скрывается целиком.
  // ВНИМАНИЕ: тексты ниже написаны как образец, их нужно заменить настоящими.
  var REVIEWS = [
    {
      tag: 'Долги и приставы',
      text: 'Со счёта списали всю зарплату по старому долгу, о котором я даже не знал. Объяснили, что это судебный приказ и его ещё можно отменить.',
      result: 'Приказ отменён, деньги вернули на счёт',
      who: 'Сергей',
      city: 'Санкт-Петербург'
    },
    {
      tag: 'Работа и зарплата',
      text: 'Уволили задним числом и не отдали расчёт за два месяца. Сказали честно: суд выиграем, но быстро не будет. Так и вышло.',
      result: 'Задолженность по зарплате взыскана через суд',
      who: 'Марина',
      city: 'Москва'
    },
    {
      tag: 'Развод и семья',
      text: 'Боялась, что останусь без квартиры и с ребёнком на руках. На консультации разложили по полочкам, что делится, а что нет.',
      result: 'Заключено соглашение без суда',
      who: 'Ольга',
      city: 'Екатеринбург'
    }
  ];

  /* =======================================================
     Аналитика и UTM
     ======================================================= */

  // Метки рекламной кампании живут в сессии и уезжают вместе с заявкой —
  // иначе непонятно, какое объявление принесло клиента.
  var UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','yclid','gclid'];

  var campaign = (function () {
    var saved = {};
    try { saved = JSON.parse(sessionStorage.getItem('campaign') || '{}'); } catch (e) {}

    var params = new URLSearchParams(window.location.search);
    var fresh = false;
    UTM_KEYS.forEach(function (key) {
      var value = params.get(key);
      if (value) { saved[key] = value; fresh = true; }
    });

    if (!saved.referrer && document.referrer) saved.referrer = document.referrer;
    if (!saved.landing) saved.landing = window.location.pathname;

    if (fresh || !saved.saved_at) {
      saved.saved_at = new Date().toISOString();
      try { sessionStorage.setItem('campaign', JSON.stringify(saved)); } catch (e) {}
    }
    return saved;
  })();

  function track(goal, params) {
    if (YM_ID && window.ym) {
      try { window.ym(YM_ID, 'reachGoal', goal, params); } catch (e) {}
    }
    if (window.gtag) {
      try { window.gtag('event', goal, params || {}); } catch (e) {}
    }
    if (window.dataLayer) {
      try { window.dataLayer.push(Object.assign({ event: goal }, params || {})); } catch (e) {}
    }
  }

  /* =======================================================
     Отправка заявки
     ======================================================= */
  var LEAD_ENDPOINT = 'api/submit.php';
  var PENDING_KEY = 'lead_pending';

  function postLead(lead) {
    return fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead),
      keepalive: true
    }).then(function (res) {
      if (!res.ok) throw new Error('http_' + res.status);
      return res;
    });
  }

  // Если запрос не ушёл (сеть отвалилась, вкладку закрыли) — заявка
  // остаётся в браузере и уходит при следующем открытии сайта.
  function stashLead(lead) {
    try {
      var stash = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      stash.push(lead);
      localStorage.setItem(PENDING_KEY, JSON.stringify(stash.slice(-5)));
    } catch (e) {}
  }

  function sendLead(lead) {
    var sent = false;
    function send() {
      if (sent) return;
      sent = true;
      postLead(lead).catch(function (err) {
        // Заявка не ушла: откладываем её до следующего визита и помечаем
        // в аналитике, иначе потеря видна только по пустому leads.log
        stashLead(lead);
        track('lead_send_failed', { reason: String(err && err.message || err) });
        if (window.console) console.warn('Заявка не отправлена:', err);
      });
    }

    // ClientID Метрики помогает связать заявку с визитом в отчётах.
    // Если счётчик заблокирован, колбэк не вызовется никогда — поэтому
    // ждём его не дольше секунды и отправляем заявку без ClientID.
    if (YM_ID && window.ym) {
      try {
        setTimeout(send, 1000);
        window.ym(YM_ID, 'getClientID', function (id) {
          lead.yandex_client_id = id;
          send();
        });
        return;
      } catch (e) {}
    }
    send();
  }

  (function flushPendingLeads() {
    var stash;
    try { stash = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) { return; }
    if (!stash || !stash.length) return;

    try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
    stash.forEach(function (lead) { sendLead(lead); });
  })();

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* =======================================================
     Шапка
     ======================================================= */
  var header = $('#header');
  if (header) {
    var syncHeader = function () { header.classList.toggle('is-stuck', window.scrollY > 40); };
    syncHeader();
    window.addEventListener('scroll', syncHeader, { passive: true });
  }

  /* =======================================================
     Появление блоков
     ======================================================= */
  var reveals = $$('[data-reveal]');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { revealObserver.observe(el); });
  }

  /* =======================================================
     Данные специалиста
     ======================================================= */
  (function fillLawyer() {
    $$('[data-lawyer]').forEach(function (el) {
      var value = LAWYER[el.getAttribute('data-lawyer')];
      if (value !== undefined && value !== '') el.textContent = value;
    });

    // Суд и период дописываются, только если заполнены, — иначе висячие запятые
    var extra = [LAWYER.court, LAWYER.period].filter(Boolean).join(', ');
    var credentials = $('[data-lawyer-credentials]');
    if (credentials && extra) credentials.textContent = ', ' + extra;

    var courtLine = $('[data-lawyer-court-line]');
    if (courtLine && LAWYER.period) courtLine.textContent = 'федеральный суд, ' + LAWYER.period;

    var photo = $('[data-lawyer-photo]');
    if (photo && LAWYER.photo) {
      photo.innerHTML = '<img src="' + esc(LAWYER.photo) + '" alt="' + esc(LAWYER.name) + '">';
      photo.classList.add('is-filled');
    }
  })();

  /* =======================================================
     Калькулятор сроков — личная дата вместо абстрактной срочности
     ======================================================= */
  (function deadlineCalc() {
    var form = $('[data-dl-form]');
    if (!form) return;

    var input = $('[data-dl-input]');
    var result = $('[data-dl-result]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      input.classList.remove('has-error');

      if (!input.value) { input.classList.add('has-error'); input.focus(); return; }

      var target = new Date(input.value + 'T00:00:00');
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var days = Math.round((target - today) / 86400000);

      var heading, text;

      if (days < 0) {
        heading = 'Дата уже прошла';
        text = 'Не всё потеряно: часть сроков восстанавливается, если причина пропуска уважительная. ' +
               '<strong>Чем раньше обратитесь, тем больше шансов.</strong>';
      } else if (days === 0) {
        heading = 'Это сегодня';
        text = 'Звоните прямо сейчас — объясним, как себя вести и чего <strong>не делать</strong> ни в коем случае.';
      } else if (days <= 3) {
        heading = days === 1 ? 'Остался 1 день' : 'Осталось ' + days + ' дня';
        text = 'Времени в обрез. Успеваем разобрать документы и подсказать, что заявить. ' +
               '<strong>Откладывать нельзя.</strong>';
      } else if (days <= 14) {
        heading = 'Осталось ' + days + ' ' + plural(days, 'день', 'дня', 'дней');
        text = 'Этого хватает, чтобы изучить материалы, подготовить возражения и заявить ходатайства — ' +
               '<strong>если начать на этой неделе.</strong>';
      } else {
        heading = 'Осталось ' + days + ' ' + plural(days, 'день', 'дня', 'дней');
        text = 'Запас есть, и это лучший момент: можно спокойно собрать доказательства, ' +
               'а не латать позицию в последний вечер.';
      }

      result.innerHTML =
        '<span class="dlcalc__days' + (days <= 3 ? ' dlcalc__days--urgent' : '') + '">' + esc(heading) + '</span>' +
        '<p class="dlcalc__text">' + text + '</p>' +
        '<button class="btn btn--ink" type="button" data-dl-cta>Разобрать дело до этой даты</button>';
      result.hidden = false;

      track('deadline_calc', { days: days });

      $('[data-dl-cta]', result).addEventListener('click', function () {
        pendingDate = input.value;
        track('chat_open', { from: 'deadline_calc' });
        openSheet();
      });
    });
  })();

  function plural(n, one, few, many) {
    var mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  // Дата из калькулятора, которую чат подхватит вместе с заявкой
  var pendingDate = '';

  /* =======================================================
     Отзывы
     ======================================================= */
  (function renderReviews() {
    var section = $('#proof');
    var holder = $('[data-reviews]');
    if (!section || !holder || !REVIEWS.length) return;

    section.hidden = false;

    holder.innerHTML = REVIEWS.map(function (r) {
      return '<article class="review">' +
        '<p class="review__tag">' + esc(r.tag) + '</p>' +
        '<p class="review__text">' + esc(r.text) + '</p>' +
        (r.result
          ? '<p class="review__result">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><polyline points="4,12 10,18 20,6"/></svg>' +
              esc(r.result) +
            '</p>'
          : '') +
        '<footer class="review__foot">' +
          '<span class="review__who">' + esc(r.who) + '</span>' +
          '<span>' + esc(r.city) + '</span>' +
        '</footer>' +
      '</article>';
    }).join('');

    var link = $('[data-reviews-link]');
    if (link) {
      if (REVIEWS_LINK) {
        link.href = REVIEWS_LINK;
        link.target = '_blank';
        link.rel = 'noopener';
      } else {
        link.hidden = true;
      }
    }
  })();

  /* =======================================================
     FAQ
     ======================================================= */
  var faqItems = $$('.faq__item');
  faqItems.forEach(function (item) {
    var trigger = $('.faq__q', item);
    var panel = $('.faq__a', item);
    trigger.addEventListener('click', function () {
      var willOpen = trigger.getAttribute('aria-expanded') !== 'true';
      faqItems.forEach(function (other) {
        $('.faq__q', other).setAttribute('aria-expanded', 'false');
        $('.faq__a', other).style.maxHeight = null;
      });
      if (willOpen) {
        trigger.setAttribute('aria-expanded', 'true');
        panel.style.maxHeight = panel.scrollHeight + 'px';
      }
    });
  });
  window.addEventListener('resize', function () {
    $$('.faq__q[aria-expanded="true"]').forEach(function (trigger) {
      var panel = $('.faq__a', trigger.parentElement);
      panel.style.maxHeight = panel.scrollHeight + 'px';
    });
  });

  /* =======================================================
     ЧАТ
     ======================================================= */
  var TOPICS = [
    'Развод и семья', 'Полиция и уголовное дело', 'Долги, приставы, банки',
    'Работа и зарплата', 'ДТП и страховая', 'Квартира и ЖКХ',
    'Наследство', 'Обманули с покупкой', 'Бизнес и контрагенты', 'Другое'
  ];

  var SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><line x1="21" y1="3" x2="10" y2="14"/><polygon points="21,3 14.5,21 10,14 3,9.5"/></svg>';

  function Chat(root) {
    this.root = root;
    this.data = {};
    this.step = 0;
    this.render();
    this.start();
  }

  Chat.prototype.render = function () {
    var working = isWorkingNow();
    this.root.innerHTML =
      '<div class="chat__head">' +
        '<img class="chat__avatar" src="' + AVATAR + '" alt="" width="42" height="42">' +
        '<div class="chat__who">' +
          '<p class="chat__name">Дежурный юрист</p>' +
          '<p class="chat__status' + (working ? '' : ' chat__status--off') + '">' +
            (working ? 'на связи — ответит за 15 минут' : 'примем заявку — ответим с 09:00') +
          '</p>' +
        '</div>' +
      '</div>' +
      '<div class="chat__progress"><div class="chat__progress-bar" data-progress></div></div>' +
      '<div class="chat__log" data-log></div>' +
      '<div class="chat__foot" data-foot></div>';

    this.log = $('[data-log]', this.root);
    this.foot = $('[data-foot]', this.root);
    this.progress = $('[data-progress]', this.root);
  };

  Chat.prototype.scrollDown = function () {
    var log = this.log;
    requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; });
  };

  Chat.prototype.setProgress = function (pct) {
    this.progress.style.width = pct + '%';
  };

  Chat.prototype.addBot = function (html) {
    var el = document.createElement('div');
    el.className = 'msg msg--bot';
    el.innerHTML = '<img class="msg__avatar" src="' + AVATAR + '" alt="" width="28" height="28">' +
                   '<div class="msg__bubble">' + html + '</div>';
    this.log.appendChild(el);
    this.scrollDown();
  };

  Chat.prototype.addUser = function (text) {
    var el = document.createElement('div');
    el.className = 'msg msg--user';
    el.innerHTML = '<div class="msg__bubble">' + esc(text) + '</div>';
    this.log.appendChild(el);
    this.scrollDown();
  };

  // Длинное сообщение печатается дольше короткого — иначе видно, что это скрипт
  function typingTime(html) {
    var chars = String(html).replace(/<[^>]*>/g, '').length;
    return Math.min(2600, 400 + chars * 24) + Math.random() * 220;
  }

  Chat.prototype.typing = function (done, html) {
    var el = document.createElement('div');
    el.className = 'msg msg--bot';
    el.innerHTML = '<img class="msg__avatar" src="' + AVATAR + '" alt="" width="28" height="28">' +
      '<div class="msg__bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
    this.log.appendChild(el);
    this.scrollDown();
    setTimeout(function () { el.remove(); done(); }, reduceMotion ? 100 : typingTime(html));
  };

  Chat.prototype.say = function (html, then) {
    var self = this;
    this.foot.innerHTML = '';
    // пауза «прочитал ваш ответ» до того, как появятся точки
    var read = reduceMotion ? 0 : 280 + Math.random() * 260;
    setTimeout(function () {
      self.typing(function () {
        self.addBot(html);
        if (then) then();
      }, html);
    }, read);
  };

  Chat.prototype.start = function () {
    var self = this;
    this.setProgress(8);
    this.addBot('Здравствуйте! Это дежурный юрист «Юрист для людей».');
    setTimeout(function () {
      self.say('Расскажите, что у вас произошло — выберите тему или опишите своими словами.', function () {
        self.askTopic();
      });
    }, reduceMotion ? 60 : 550);
  };

  Chat.prototype.askTopic = function () {
    var self = this;
    var chips = TOPICS.map(function (t) {
      return '<button class="chip" type="button" data-chip="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
    this.foot.innerHTML =
      '<div class="chat__chips">' + chips + '</div>' +
      '<button class="chat__fast" type="button" data-fast>Некогда писать — перезвоните мне</button>';

    $$('[data-chip]', this.foot).forEach(function (btn) {
      btn.addEventListener('click', function () {
        self.pickTopic(btn.getAttribute('data-chip'));
      });
    });

    // Быстрый путь для нетерпеливых: сразу телефон, тему выясним в разговоре
    $('[data-fast]', this.foot).addEventListener('click', function () {
      track('chat_fastpath');
      self.data.topic = 'Заказ обратного звонка';
      self.addUser('Некогда писать — перезвоните мне');
      self.setProgress(40);
      self.say('Конечно. Сначала выберите регион и город — затем оставьте номер.', function () {
        self.askRegion(function () {
          self.say('Теперь оставьте номер — перезвоним в течение 15 минут.', function () {
            self.fastPhone();
          });
        });
      });
    });
  };

  // Укороченная ветка: один шаг — телефон вместе с согласием
  Chat.prototype.fastPhone = function () {
    var self = this;
    this.askInput({
      placeholder: '+7 (___) ___-__-__',
      type: 'tel',
      inputmode: 'tel',
      autocomplete: 'tel',
      consent: true,
      validate: function (v) {
        return v.replace(/\D/g, '').length < 10 ? 'Проверьте номер — кажется, не хватает цифр' : null;
      },
      onSubmit: function (value) {
        self.data.phone = value;
        self.data.name = self.data.name || 'Без имени';
        self.addUser(value);
        track('chat_phone');
        self.submit();
      }
    });
  };

  Chat.prototype.pickTopic = function (topic) {
    var self = this;
    this.data.topic = topic;
    this.addUser(topic);
    this.setProgress(35);
    track('chat_topic', { topic: topic });
    this.saveDraft();
    this.say('Понял, записал. Как к вам обращаться?', function () { self.askName(); });
  };

  // Незаконченный разговор запоминаем, чтобы предложить продолжить
  Chat.prototype.saveDraft = function () {
    try {
      localStorage.setItem('chat_draft', JSON.stringify({
        topic: this.data.topic || '',
        name: this.data.name || '',
        at: Date.now()
      }));
    } catch (e) {}
  };

  Chat.prototype.askInput = function (opts) {
    var self = this;
    var multiline = opts.multiline;
    var field = multiline
      ? '<textarea class="chat__input" data-input placeholder="' + esc(opts.placeholder) + '"></textarea>'
      : '<input class="chat__input" data-input type="' + (opts.type || 'text') + '" ' +
        (opts.inputmode ? 'inputmode="' + opts.inputmode + '" ' : '') +
        (opts.autocomplete ? 'autocomplete="' + opts.autocomplete + '" ' : '') +
        'placeholder="' + esc(opts.placeholder) + '">';

    // Согласие живёт на шаге с телефоном: отправка номера и есть подтверждение,
    // отдельная кнопка «отправить» после этого — лишний клик.
    var consentBlock = opts.consent
      ? '<label class="chat__consent" data-consent-label>' +
          '<input type="checkbox" data-consent>' +
          '<span>Согласен на обработку персональных данных и ознакомлен с ' +
            '<a href="/privacy" class="link" target="_blank" rel="noopener">политикой обработки данных</a></span>' +
        '</label>'
      : '';

    this.foot.innerHTML =
      '<form class="chat__form" data-form novalidate>' +
        '<div class="chat__row">' + field +
          '<button class="chat__send" type="submit" aria-label="Отправить">' + SEND_ICON + '</button>' +
        '</div>' +
        '<p class="chat__error" data-error hidden></p>' +
        consentBlock +
        (opts.skip ? '<button class="chat__skip" type="button" data-skip>' + esc(opts.skip) + '</button>' : '') +
      '</form>';

    var form = $('[data-form]', this.foot);
    var input = $('[data-input]', this.foot);
    var error = $('[data-error]', this.foot);
    var consentBox = $('[data-consent]', this.foot);
    var consentLabel = $('[data-consent-label]', this.foot);

    if (consentBox) {
      consentBox.addEventListener('change', function () {
        consentLabel.classList.remove('has-error');
      });
    }

    // фокус только когда чат уже виден — иначе страница дёргается при загрузке
    if (opts.focus !== false && self.root.closest('.sheet')) {
      setTimeout(function () { input.focus(); }, 260);
    }

    input.addEventListener('input', function () {
      input.classList.remove('has-error');
      error.hidden = true;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = input.value.trim();
      var problem = opts.validate ? opts.validate(value) : null;
      if (problem) {
        input.classList.add('has-error');
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      if (consentBox && !consentBox.checked) {
        consentLabel.classList.add('has-error');
        return;
      }
      opts.onSubmit(value);
    });

    if (opts.skip) {
      $('[data-skip]', this.foot).addEventListener('click', function () { opts.onSkip(); });
    }
  };

  Chat.prototype.askSelect = function (opts) {
    var self = this;
    var options = (opts.options || []).map(function (item) {
      return '<option value="' + esc(item) + '">' + esc(item) + '</option>';
    }).join('');

    this.foot.innerHTML =
      '<form class="chat__form" data-form novalidate>' +
        '<div class="chat__row">' +
          '<select class="chat__input" data-input aria-label="' + esc(opts.placeholder) + '">' +
            '<option value="" selected disabled>' + esc(opts.placeholder) + '</option>' +
            options +
          '</select>' +
          '<button class="chat__send" type="submit" aria-label="Продолжить">' + SEND_ICON + '</button>' +
        '</div>' +
        '<p class="chat__error" data-error hidden></p>' +
      '</form>';

    var form = $('[data-form]', this.foot);
    var input = $('[data-input]', this.foot);
    var error = $('[data-error]', this.foot);

    input.addEventListener('change', function () {
      input.classList.remove('has-error');
      error.hidden = true;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = input.value;
      if (!value) {
        input.classList.add('has-error');
        error.textContent = opts.error || 'Выберите значение из списка';
        error.hidden = false;
        return;
      }
      opts.onSubmit(value);
    });
  };

  Chat.prototype.askRegion = function (done) {
    var self = this;
    var locations = window.RUSSIA_LOCATIONS || {};
    var regions = Object.keys(locations);

    this.askSelect({
      placeholder: 'Выберите регион',
      options: regions,
      error: 'Выберите регион из списка',
      onSubmit: function (value) {
        self.data.region = value;
        self.data.city = '';
        self.addUser(value);
        self.setProgress(60);

        var cities = locations[value] || [];

        // Для городов федерального значения отдельный выбор города не нужен.
        // Если у субъекта нет отдельного списка городов, сохраняем сам субъект как город.
        if (cities.length === 0) {
          self.data.city = value.replace(/^г\.\s*/, '');
          self.setProgress(70);
          if (done) done();
          return;
        }

        self.say('Теперь выберите город в регионе «' + esc(value) + '».', function () {
          self.askCity(done);
        });
      }
    });
  };

  Chat.prototype.askCity = function (done) {
    var self = this;
    var locations = window.RUSSIA_LOCATIONS || {};
    var cities = locations[this.data.region] || [];

    this.askSelect({
      placeholder: 'Выберите город',
      options: cities,
      error: 'Выберите город из списка',
      onSubmit: function (value) {
        self.data.city = value;
        self.addUser(value);
        self.setProgress(70);
        if (done) done();
      }
    });
  };

  Chat.prototype.askName = function () {
    var self = this;
    this.askInput({
      placeholder: 'Ваше имя',
      autocomplete: 'given-name',
      validate: function (v) { return v.length < 2 ? 'Напишите, как к вам обращаться' : null; },
      onSubmit: function (value) {
        self.data.name = value;
        self.addUser(value);
        self.setProgress(50);
        self.saveDraft();
        self.say('Приятно познакомиться, ' + esc(value) + '. Сначала уточним регион и город — так мы направим обращение нужному юристу.', function () {
          self.askRegion(function () {
            self.say('Спасибо. На какой номер перезвонить?<br>Звоним один раз, без рассылок.', function () {
              self.askPhone();
            });
          });
        });
      }
    });
  };

  Chat.prototype.askPhone = function () {
    var self = this;
    this.askInput({
      placeholder: '+7 (___) ___-__-__',
      type: 'tel',
      inputmode: 'tel',
      autocomplete: 'tel',
      consent: true,
      validate: function (v) {
        var digits = v.replace(/\D/g, '');
        return digits.length < 10 ? 'Проверьте номер — кажется, не хватает цифр' : null;
      },
      onSubmit: function (value) {
        self.data.phone = value;
        self.addUser(value);
        track('chat_phone');
        self.submit();
      }
    });
  };

  Chat.prototype.submit = function () {
    var self = this;

    var lead = {
      topic: this.data.topic,
      name: this.data.name,
      region: this.data.region || '',
      city: this.data.city || '',
      phone: this.data.phone,
      deadline: pendingDate || '',
      campaign: campaign,
      page: window.location.href
    };

    // заявка ушла — напоминать о незаконченном разговоре больше не нужно
    try { localStorage.removeItem('chat_draft'); } catch (e) {}

    sendLead(lead);
    track('lead', { topic: lead.topic });

    this.setProgress(100);
    var when = isWorkingNow()
      ? 'в течение 15 минут'
      : 'в начале рабочего дня, с 09:00';
    this.say('Заявка у юриста. Перезвоним на ' + esc(this.data.phone) + ' ' + when + '.', function () {
      self.foot.innerHTML =
        '<div class="chat__done">' +
          '<div class="chat__done-icon">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="4,12 10,18 20,6"/></svg>' +
          '</div>' +
          '<h3>Готово, ' + esc(self.data.name) + '</h3>' +
          '<p>Если ждать неудобно — позвоните сами, юрист ответит сразу.</p>' +
          '<a class="btn btn--ink btn--block" href="' + PHONE_HREF + '">' + PHONE + '</a>' +
        '</div>';
      self.scrollDown();
    });
  };

  /* Создаём чаты */
  var chats = {};
  $$('[data-chat]').forEach(function (el) { chats[el.id] = new Chat(el); });

  /* =======================================================
     ШТОРКА
     ======================================================= */
  var sheet = $('#chat-sheet');
  var lastFocused = null;

  function openSheet(topic) {
    if (!sheet) return;
    lastFocused = document.activeElement;
    sheet.hidden = false;
    document.body.classList.add('is-locked');
    // форсируем рефлоу, чтобы сработал transition
    void sheet.offsetWidth;
    sheet.classList.add('is-open');

    var chat = chats['chat-modal'];
    if (chat && topic && !chat.data.topic) {
      chat.pickTopic(topic);
    }
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    setTimeout(function () { sheet.hidden = true; }, reduceMotion ? 0 : 380);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  $$('[data-open-chat]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      track('chat_open', { from: btn.className || 'unknown' });
      openSheet();
    });
  });

  /* Цели по остальным точкам контакта */
  $$('a[href^="tel:"]').forEach(function (a) {
    a.addEventListener('click', function () { track('phone_click'); });
  });
  $$('[data-track]').forEach(function (el) {
    el.addEventListener('click', function () { track(el.getAttribute('data-track')); });
  });
  $$('[data-close-chat]').forEach(function (btn) {
    btn.addEventListener('click', closeSheet);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheet && !sheet.hidden) closeSheet();
  });

  /* Карточки направлений → чат с выбранной темой */
  $$('.topic').forEach(function (card) {
    card.addEventListener('click', function () {
      var topic = card.getAttribute('data-topic');
      var hero = chats['chat-hero'];
      var heroVisible = hero && hero.root.offsetParent !== null;

      if (heroVisible && !hero.data.topic) {
        hero.root.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        hero.pickTopic(topic);
      } else {
        openSheet(topic);
      }
    });
  });

  /* =======================================================
     ТОСТЫ
     ======================================================= */
  var toastsRoot = $('#toasts');

  function showToast(opts) {
    if (!toastsRoot) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML =
      '<img class="toast__icon" src="' + AVATAR + '" alt="" width="38" height="38">' +
      '<div class="toast__body">' +
        '<p class="toast__title">' + esc(opts.title) + '</p>' +
        '<p class="toast__text">' + esc(opts.text) + '</p>' +
        '<button class="toast__action" type="button" data-toast-action>' + esc(opts.action) + '</button>' +
      '</div>' +
      '<button class="toast__close" type="button" aria-label="Закрыть">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>' +
      '</button>';

    toastsRoot.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-shown'); });

    function hide() {
      el.classList.add('is-hiding');
      setTimeout(function () { el.remove(); }, 400);
    }

    $('[data-toast-action]', el).addEventListener('click', function () { hide(); openSheet(); });
    $('.toast__close', el).addEventListener('click', hide);
    setTimeout(hide, opts.life || 12000);
  }

  function once(key) {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
      return true;
    } catch (e) { return true; }
  }

  function sheetIsOpen() { return sheet && !sheet.hidden; }

  /* -------------------------------------------------------
     Очередь уведомлений.
     Ограничения не дают сайту превратиться в спам: не больше
     трёх за сессию, минимум 30 секунд между ними, ничего
     поверх открытого чата.
     ------------------------------------------------------- */
  var MAX_TOASTS = 3;
  var MIN_GAP = 30000;
  var shownCount = 0;
  var lastShownAt = 0;
  var queue = [];

  function enqueue(key, builder) {
    queue.push({ key: key, builder: builder });
    drain();
  }

  function drain() {
    if (!queue.length || shownCount >= MAX_TOASTS || sheetIsOpen()) return;

    var wait = MIN_GAP - (Date.now() - lastShownAt);
    if (lastShownAt && wait > 0) { setTimeout(drain, wait); return; }

    var item = queue.shift();
    if (!once(item.key)) { drain(); return; }

    var opts = item.builder();
    if (!opts) { drain(); return; }

    shownCount++;
    lastShownAt = Date.now();
    showToast(opts);
  }

  /* 1) Юрист на связи — статус, а не выдуманная активность */
  setTimeout(function () {
    enqueue('toast_online', function () {
      return {
        title: 'Юрист на связи',
        text: 'Разберём вашу ситуацию за 15 минут — бесплатно и без обязательств.',
        action: 'Описать ситуацию'
      };
    });
  }, 20000);

  /* 2) Прочитал половину страницы, но не написал */
  var midFired = false;
  window.addEventListener('scroll', function () {
    if (midFired) return;
    var depth = (window.scrollY + window.innerHeight) / document.body.scrollHeight;
    if (depth < 0.55) return;
    midFired = true;
    enqueue('toast_mid', function () {
      return {
        title: 'Не нашли свой случай?',
        text: 'Опишите ситуацию своими словами — скажем, с чего начать именно вам.',
        action: 'Задать вопрос'
      };
    });
  }, { passive: true });

  /* 3) Замер на странице: 45 секунд без действий */
  var idleTimer;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (sheetIsOpen()) return;
      enqueue('toast_idle', function () {
        return {
          title: 'Остались вопросы?',
          text: 'Напишите в двух словах, что случилось. Ответим, даже если помощь в итоге не понадобится.',
          action: 'Написать юристу'
        };
      });
    }, 45000);
  }
  ['scroll', 'mousemove', 'keydown', 'touchstart', 'click'].forEach(function (evt) {
    window.addEventListener(evt, resetIdle, { passive: true });
  });
  resetIdle();

  /* 4) Незаконченный разговор — самый тёплый контакт из всех */
  (function resumeDraft() {
    var draft;
    try { draft = JSON.parse(localStorage.getItem('chat_draft') || 'null'); } catch (e) {}
    if (!draft || !draft.topic) return;

    // через неделю напоминание уже неуместно
    if (Date.now() - draft.at > 7 * 86400000) {
      try { localStorage.removeItem('chat_draft'); } catch (e) {}
      return;
    }

    setTimeout(function () {
      enqueue('toast_resume', function () {
        return {
          title: draft.name ? draft.name + ', вы не закончили' : 'Вы не закончили разговор',
          text: 'Мы остановились на теме «' + draft.topic + '». Продолжим — это займёт полминуты.',
          action: 'Продолжить'
        };
      });
    }, 8000);
  })();

  /* 5) Реальная активность по заявкам.
        Включается только вместе с данными из CRM — см. SHOW_ACTIVITY. */
  if (SHOW_ACTIVITY && ACTIVITY.length) {
    setTimeout(function () {
      enqueue('toast_activity', function () {
        var item = ACTIVITY[0];
        if (!item) return null;
        var when = item.minutesAgo != null
          ? item.minutesAgo + ' ' + plural(item.minutesAgo, 'минуту', 'минуты', 'минут') + ' назад'
          : 'только что';
        return {
          title: 'Новое обращение',
          text: item.city + ' · ' + item.topic + ' · ' + when,
          action: 'Тоже описать ситуацию'
        };
      });
    }, 34000);
  }

  /* 6) Попытка уйти со страницы (десктоп) */
  document.addEventListener('mouseout', function (e) {
    if (e.clientY > 0 || e.relatedTarget) return;
    if (window.innerWidth < 900 || sheetIsOpen()) return;
    if (!once('exit_intent')) return;
    track('exit_intent');
    openSheet();
  });

})();
