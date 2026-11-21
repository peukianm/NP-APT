/* Privacy-safe Booking.com calendar view. Never fetch the private iCal URL in the browser. */
(function () {
  const root = document.getElementById('public-availability-calendar');
  if (!root) return;
  const repo = 'NP-APT';
  const monthLabel = root.querySelector('[data-month]');
  const grid = root.querySelector('[data-days]');
  const status = root.querySelector('[data-status]');
  const prev = root.querySelector('[data-prev]');
  const next = root.querySelector('[data-next]');
  const now = new Date();
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const firstMonth = new Date(localToday.getFullYear(), localToday.getMonth(), 1);
  let monthOffset = 0;
  let payload = null;
  let fresh = false;
  let blocked = new Set();
  let rateDays = null;

  function language() { return document.documentElement.lang === 'en' ? 'en' : 'el'; }
  function message(el, en) { return language() === 'en' ? en : el; }
  function iso(day) {
    return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
  }
  function cell(label, cls, title) {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = label;
    if (title) { span.title = title; span.setAttribute('aria-label', title); }
    return span;
  }
  function baseRate(date) {
    const amount = rateDays?.[date]?.baseTwoAdults;
    return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : null;
  }
  function nightlyPrice(amount) {
    if (amount === null) return message('Ν/Α', 'N/A');
    return new Intl.NumberFormat(language() === 'en' ? 'en-GB' : 'el-GR', {
      style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2
    }).format(amount);
  }
  async function loadRates() {
    let data;
    try {
      const response = await fetch('https://api.github.com/repos/peukianm/' + repo + '/contents/rates.json?ref=main&ts=' + Date.now(), {cache: 'no-store'});
      if (!response.ok) throw Error('No published rates');
      const file = await response.json();
      if (file.encoding !== 'base64' || typeof file.content !== 'string') throw Error('Invalid rates file');
      const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      const response = await fetch('https://raw.githubusercontent.com/peukianm/' + repo + '/main/rates.json?ts=' + Date.now(), {cache: 'no-store'});
      if (!response.ok) throw Error('No published rates');
      data = await response.json();
    }
    if (data.schemaVersion !== 1 || data.currency !== 'EUR' || data.status !== 'active' || !data.days || typeof data.days !== 'object' || Array.isArray(data.days)) throw Error('Rates not configured');
    rateDays = data.days;
    draw();
  }
  function draw() {
    const month = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + monthOffset, 1);
    monthLabel.textContent = new Intl.DateTimeFormat(language() === 'en' ? 'en-GB' : 'el-GR', { month: 'long', year: 'numeric' }).format(month);
    prev.disabled = monthOffset <= 0;
    next.disabled = monthOffset >= 7;
    grid.replaceChildren();
    const weekdays = language() === 'en' ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] : ['Δε','Τρ','Τε','Πε','Πα','Σα','Κυ'];
    weekdays.forEach(d => grid.appendChild(cell(d, 'avail-weekday')));
    const shift = (month.getDay() + 6) % 7;
    for (let k = 0; k < shift; k++) grid.appendChild(cell('', 'avail-empty'));
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const maxDate = new Date(localToday.getFullYear(), localToday.getMonth(), localToday.getDate() + 240);
    for (let dayNo = 1; dayNo <= count; dayNo++) {
      const day = new Date(month.getFullYear(), month.getMonth(), dayNo);
      const date = iso(day);
      const isOld = day < localToday;
      const isOutside = day >= maxDate;
      const reserved = fresh && blocked.has(date);
      const available = !isOld && !isOutside && fresh && !reserved;
      let cls = 'avail-day';
      let title = '';
      if (isOld) { cls += ' avail-past'; title = message('Παρελθούσα ημερομηνία', 'Past date'); }
      else if (!fresh || isOutside) { cls += ' avail-unknown'; title = message('Δεν υπάρχουν επιβεβαιωμένα στοιχεία', 'Status not verified'); }
      else if (reserved) { cls += ' avail-blocked'; title = message('Δεσμευμένη', 'Blocked'); }
      else { cls += ' avail-tentative'; title = message('Χωρίς γνωστή δέσμευση — επιβεβαίωση στην πλατφόρμα', 'No reported block — confirm on booking platform'); }
      const amount = available ? baseRate(date) : null;
      if (available) title += ' · ' + message('Βασική τιμή για 2 ενήλικες / νύχτα: ', 'Base rate for 2 adults / night: ') + nightlyPrice(amount);
      const dayCell = cell('', cls, date + ': ' + title);
      dayCell.dataset.date = date;
      dayCell.appendChild(cell(String(dayNo), 'avail-day-number'));
      if (available) dayCell.appendChild(cell(nightlyPrice(amount), 'avail-day-price'));
      grid.appendChild(dayCell);
    }
  }
  function showStatus() {
    if (!payload || !fresh) {
      status.textContent = message('Δεν υπάρχουν πρόσφατα επιβεβαιωμένα δεδομένα ημερολογίου. Ελέγξτε στο Booking.com ή στο Airbnb.', 'No recent verified calendar data. Check Booking.com or Airbnb.');
      return;
    }
    const updated = new Date(payload.lastUpdated);
    const stamp = new Intl.DateTimeFormat(language() === 'en' ? 'en-GB' : 'el-GR',
      {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Athens'}).format(updated);
    status.textContent = message('Τελευταίος συγχρονισμός: ', 'Last sync: ') + stamp;
  }
  prev.addEventListener('click', () => { monthOffset = Math.max(0, monthOffset - 1); draw(); });
  next.addEventListener('click', () => { monthOffset = Math.min(7, monthOffset + 1); draw(); });
  document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', () => { draw(); showStatus(); }));
  draw();
  showStatus();
  loadRates().catch(() => { rateDays = null; draw(); });
  fetch('https://raw.githubusercontent.com/peukianm/' + repo + '/main/availability.json', {cache: 'no-store'})
    .then(response => { if (!response.ok) throw Error('No published calendar'); return response.json(); })
    .then(data => {
      if (data.schemaVersion !== 1 || !Array.isArray(data.blockedDates) || typeof data.lastUpdated !== 'string') throw Error('Invalid data');
      payload = data;
      const stamp = new Date(data.lastUpdated);
      fresh = data.source === 'Booking.com + Airbnb iCal' && Number.isFinite(stamp.getTime()) && Date.now() - stamp.getTime() < 36 * 60 * 60 * 1000 && stamp.getTime() < Date.now() + 10 * 60 * 1000;
      blocked = new Set(data.blockedDates.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)));
      draw();
      showStatus();
    })
    .catch(() => { fresh = false; draw(); showStatus(); });
})();

