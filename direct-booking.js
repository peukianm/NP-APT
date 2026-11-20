/* Direct booking request: no backend, no false reservation confirmation.
   Calendar is indicative; guest must press Send in WhatsApp to contact host. */
(function(){
  'use strict';
  const form=document.getElementById('direct-request-form');
  const dates=document.getElementById('date-search-form');
  if(!form||!dates)return;
  const property=form.dataset.property;
  const capacity=property==='NP-Apt'?3:4;
  const source='https://raw.githubusercontent.com/peukianm/'+(property==='NP-Apt'?'NP-APT':'GP-APT')+'/main/availability.json';
  const start=dates.querySelector('[name="checkin"]');
  const end=dates.querySelector('[name="checkout"]');
  const adults=form.querySelector('[name="adults"]');
  const children=form.querySelector('[name="children"]');
  const message=form.querySelector('[data-direct-status]');
  const estimate=form.querySelector('[data-direct-estimate]');
  let calendar=null,checkedAt=0;
  const en=()=>document.documentElement.lang==='en';
  const tr=(el,eng)=>en()?eng:el;
  const say=(el,eng)=>{message.textContent=tr(el,eng)};
  function parse(v){
    const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v||'').trim());
    if(!m)return null;
    const d=new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));
    if(d.getUTCFullYear()!==+m[3]||d.getUTCMonth()!==+m[2]-1||d.getUTCDate()!==+m[1])return null;
    return d;
  }
  const iso=d=>d.toISOString().slice(0,10);
  const today=()=>{const d=new Date();return new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))};
  function datesValid(){
    const a=parse(start.value),b=parse(end.value);
    if(!a||!b||a<today()||b<=a)return null;
    const nights=Math.round((b-a)/86400000);
    if(nights>59)return null;
    return {a,b,nights};
  }
  function updateEstimate(){
    const r=datesValid();
    estimate.textContent=r?tr(r.nights+' διανυκτερεύσεις · Οι απευθείας κρατήσεις προσφέρονται σε καλύτερες τιμές από τις πλατφόρμες. Η τελική προσφορά επιβεβαιώνεται από τον οικοδεσπότη.',r.nights+' nights · Direct bookings offer better rates than booking platforms. The host will confirm the final quote.'):tr('Επίλεξε ημερομηνίες για να εμφανιστεί η διάρκεια διαμονής.','Select dates to see your stay length.');
  }
  async function loadCalendar(){
    const response=await fetch(source+'?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw Error('Calendar unavailable');
    const data=await response.json();
    if(data.schemaVersion!==1||data.source!=='Booking.com + Airbnb iCal'||!Array.isArray(data.blockedDates))throw Error('Calendar data invalid');
    const stamp=Date.parse(data.lastUpdated);
    if(!Number.isFinite(stamp)||Date.now()-stamp>=36*3600000||stamp>Date.now()+600000)throw Error('Calendar outdated');
    calendar=data;checkedAt=Date.now();
    return data;
  }
  function clearStatus(){message.textContent='';updateEstimate()}
  start.addEventListener('change',clearStatus);
  end.addEventListener('change',clearStatus);
  start.addEventListener('input',clearStatus);
  end.addEventListener('input',clearStatus);
  for(const el of [adults,children])el.addEventListener('change',()=>{
    const total=Number(adults.value)+Number(children.value);
    const target=dates.querySelector('[name="guests"]');
    if(target&&total>0&&total<=capacity){target.value=String(total);target.dispatchEvent(new Event('change',{bubbles:true}))}
    updateEstimate();
  });
  updateEstimate();
  loadCalendar().catch(()=>{});
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(!form.reportValidity())return;
    const r=datesValid();
    if(!r){say('Επίλεξε έγκυρες ημερομηνίες άφιξης και αναχώρησης στο πεδίο ακριβώς από πάνω.','Choose valid check-in and check-out dates above.');return;}
    const adultsNo=Number(adults.value),kids=Number(children.value);
    if(!Number.isInteger(adultsNo)||!Number.isInteger(kids)||adultsNo<1||kids<0||adultsNo+kids>capacity){
      say('Το κατάλυμα δέχεται έως '+capacity+' άτομα συνολικά.','This property accommodates up to '+capacity+' guests in total.');return;
    }
    const mobile=form.querySelector('[name="mobile"]').value.replace(/[\s()\-]/g,'');
    if(!/^\+?[0-9]{10,15}$/.test(mobile)){say('Συμπλήρωσε έγκυρο κινητό τηλέφωνο με 10–15 ψηφία.','Enter a valid mobile number with 10–15 digits.');return;}
    const submit=form.querySelector('[type="submit"]');
    submit.disabled=true;
    say('Ελέγχουμε τις γνωστές δεσμεύσεις του ημερολογίου…','Checking reported calendar blocks…');
    try{
      const data=await loadCalendar();
      const horizon=Number(data.horizonDays)||240;
      const last=new Date(today().getTime()+horizon*86400000);
      if(r.b>last)throw Error('Beyond the available calendar horizon');
      const blocks=new Set(data.blockedDates);
      for(let t=r.a.getTime();t<r.b.getTime();t+=86400000){
        if(blocks.has(iso(new Date(t)))){
          say('Μία ή περισσότερες επιλεγμένες νύχτες εμφανίζονται δεσμευμένες. Διάλεξε άλλες ημερομηνίες.','One or more selected nights are shown as blocked. Choose different dates.');
          return;
        }
      }
      const first=form.querySelector('[name="firstname"]').value.trim();
      const lastName=form.querySelector('[name="lastname"]').value.trim();
      const lines=[
        'DIRECT BOOKING REQUEST / ΑΙΤΗΜΑ ΑΠΕΥΘΕΙΑΣ ΚΡΑΤΗΣΗΣ',
        'Property / Κατάλυμα: '+property,
        'Guest / Ονοματεπώνυμο: '+first+' '+lastName,
        'Mobile / Κινητό: '+mobile,
        'Check-in / Άφιξη: '+start.value,
        'Check-out / Αναχώρηση: '+end.value,
        'Nights / Διανυκτερεύσεις: '+r.nights,
        'Adults / Ενήλικες: '+adultsNo,
        'Children / Παιδιά: '+kids,
        'Request: Please confirm availability and send your better direct-booking rate.',
        'Αίτημα: Επιβεβαίωση διαθεσιμότητας και αποστολή καλύτερης τιμής μέσω του site.',
        'Status / Κατάσταση: NOT CONFIRMED – payment instructions after host approval.'
      ];
      const url='https://wa.me/306974483266?text='+encodeURIComponent(lines.join('\n'));
      say('Το WhatsApp θα ανοίξει με το αίτημά σου. Πάτησε «Αποστολή» μέσα στο WhatsApp. Η κράτηση ΔΕΝ έχει επιβεβαιωθεί.','WhatsApp will open with your request. Press Send in WhatsApp. Your booking is NOT confirmed.');
      window.location.assign(url);
    }catch(error){
      say('Δεν μπορέσαμε να επιβεβαιώσουμε πρόσφατα δεδομένα διαθεσιμότητας. Επικοινώνησε μαζί μας στο 6974483266 πριν στείλεις αίτημα.','We could not verify recent availability data. Contact us at +30 6974483266 before requesting a stay.');
    }finally{submit.disabled=false;}
  });
})();
