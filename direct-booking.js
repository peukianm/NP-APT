/* Two-step, non-binding booking inquiry: estimate -> book -> WhatsApp.
 * Never treats iCal as live inventory or claims that email was sent. */
(function(){
'use strict';
const form=document.getElementById('direct-request-form');
const dates=document.getElementById('date-search-form');
if(!form||!dates)return;
const property=form.dataset.property;
const repo=property==='NP-Apt'?'NP-APT':'GP-APT';
const maxAdults=repo==='NP-APT'?3:4;
const maxChildren=repo==='NP-APT'?2:3;
const maxTotal=4;
const start=dates.querySelector('[name="checkin"]'),end=dates.querySelector('[name="checkout"]');
const adults=form.elements.adults,children=form.elements.children;
const agesContainer=form.querySelector('[data-child-ages]');
const calculate=form.querySelector('[data-calculate-cost]');
const next=form.querySelector('[data-next-booking]');
const summary=form.querySelector('[data-quote-result]');
const details=form.querySelector('[data-guest-details]');
const estimate=form.querySelector('[data-direct-estimate]');
const status=form.querySelector('[data-direct-status]');
const send=form.querySelector('button[type="submit"]');
const en=()=>document.documentElement.lang==='en';
const tr=(el,english)=>en()?english:el;
const money=x=>new Intl.NumberFormat(en()?'en-GB':'el-GR',{style:'currency',currency:'EUR'}).format(x);
const iso=d=>d.toISOString().slice(0,10);
const today=()=>{const d=new Date();return new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));};
let active=null;
function say(el,english){status.textContent=tr(el,english);}
function parse(v){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v||'').trim());if(!m)return null;
  const d=new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1])));
  return d.getUTCFullYear()===Number(m[3])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[1])?d:null;
}
function stay(){
  const a=parse(start.value),b=parse(end.value);
  if(!a||!b||a<today()||b<=a)return null;
  const nights=(b.getTime()-a.getTime())/86400000;
  return nights>=1&&nights<=59?{a,b,nights}:null;
}
function ages(){return [...agesContainer.querySelectorAll('[data-child-age]')].map(el=>el.value===''?NaN:Number(el.value));}
function validGuests(){
  const a=Number(adults.value),kids=Number(children.value),list=ages();
  if(!Number.isInteger(a)||!Number.isInteger(kids)||a<1||a>maxAdults||kids<0||kids>maxChildren||a+kids>maxTotal)return null;
  if(list.length!==kids||list.some(x=>!Number.isInteger(x)||x<0||x>17))return null;
  return {a,kids,list};
}
function renderAges(){
  const count=Number(children.value),previous=ages();
  agesContainer.replaceChildren();
  for(let i=0;i<count;i++){
    const label=document.createElement('label'),name=document.createElement('span'),input=document.createElement('input');
    name.textContent=tr('Ηλικία παιδιού ','Age of child ')+(i+1)+' *';
    input.type='number';input.name='childAge'+(i+1);input.min='0';input.max='17';input.step='1';input.inputMode='numeric';input.required=true;input.dataset.childAge='';
    if(Number.isInteger(previous[i]))input.value=String(previous[i]);
    input.addEventListener('input',reset);
    label.append(name,input);agesContainer.appendChild(label);
  }
}
function reset(){
  active=null;
  summary.hidden=true;summary.textContent='';
  next.hidden=true;details.hidden=true;
  status.textContent='';
  estimate.textContent=tr('Επίλεξε ημερομηνίες και επισκέπτες και πάτησε «Υπολογισμός κόστους».','Choose dates and guests, then press Calculate cost.');
}
async function json(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok)throw Error('Fetch failed');
  return res.json();
}
async function currentRates(){
  let data=null;
  try{
    const entry=await json('https://api.github.com/repos/peukianm/'+repo+'/contents/rates.json?ref=main&ts='+Date.now());
    const bytes=Uint8Array.from(atob(entry.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
    data=JSON.parse(new TextDecoder().decode(bytes));
  }catch(e){
    data=await json('https://raw.githubusercontent.com/peukianm/'+repo+'/main/rates.json?ts='+Date.now());
  }
  if(data.schemaVersion!==1||data.currency!=='EUR'||data.status!=='active'||!data.days||typeof data.days!=='object')throw Error('Rates not configured');
  return data;
}
async function currentAvailability(){
  const data=await json('https://raw.githubusercontent.com/peukianm/'+repo+'/main/availability.json?ts='+Date.now());
  const stamp=Date.parse(data.lastUpdated);
  if(data.schemaVersion!==1||data.source!=='Booking.com + Airbnb iCal'||!Array.isArray(data.blockedDates)||!Number.isFinite(stamp)||Date.now()-stamp>36*3600000||stamp>Date.now()+600000)throw Error('Calendar not current');
  return data;
}
function price(stayInfo,guest,rateData){
  let totalCents=0;
  for(let t=stayInfo.a.getTime();t<stayInfo.b.getTime();t+=86400000){
    const day=iso(new Date(t)),base=rateData.days[day]?.baseTwoAdults;
    if(typeof base!=='number'||!Number.isFinite(base)||base<0)return null;
    const multiplier=guest.a===1?.9:guest.a===2?1:guest.a===3?1.16:1.22;
    const nightlyCents=Math.round(base*multiplier*100)+guest.list.filter(x=>x>=12).length*900;
    totalCents+=nightlyCents;
  }
  return totalCents/100;
}
function ensureNoBlocked(stayInfo,cal){
  const horizon=Number(cal.horizonDays)||240;
  if(stayInfo.b>new Date(today().getTime()+horizon*86400000))throw Error('Dates beyond calendar horizon');
  const blocks=new Set(cal.blockedDates);
  for(let t=stayInfo.a.getTime();t<stayInfo.b.getTime();t+=86400000){
    if(blocks.has(iso(new Date(t))))throw Error('Blocked date');
  }
}
async function getOffer(){
  const nights=stay(),guest=validGuests();
  if(!nights){say('Επίλεξε έγκυρες ημερομηνίες (dd/mm/yyyy) με αναχώρηση μετά την άφιξη.','Select valid dates (dd/mm/yyyy), with check-out after check-in.');return null;}
  if(!guest){say('Έλεγξε αριθμό ενηλίκων/παιδιών, τη συνολική χωρητικότητα (4) και τις ηλικίες των παιδιών.','Check the guest limits (4 total) and enter every child’s age.');return null;}
  const [rateData,calendar]=await Promise.all([currentRates(),currentAvailability()]);
  ensureNoBlocked(nights,calendar);
  const amount=price(nights,guest,rateData);
  if(amount===null){say('Δεν έχει οριστεί τιμή για όλες τις ημερομηνίες. Επικοινώνησε μαζί μας για προσφορά.','Prices are not available for every selected date. Contact us for a quote.');return null;}
  return {nights,guest,amount,fingerprint:[start.value,end.value,adults.value,children.value,guest.list.join(',')].join('|')};
}
function displayOffer(offer){
  const {nights,amount,guest}=offer;
  summary.textContent=tr('Σύνολο διαμονής: '+money(amount)+' · '+nights.nights+' διανυκτερεύσεις · '+guest.a+' ενήλικες · '+guest.kids+' παιδιά. Η κράτηση επιβεβαιώνεται από τον οικοδεσπότη.','Stay total: '+money(amount)+' · '+nights.nights+' nights · '+guest.a+' adults · '+guest.kids+' children. The host must confirm the booking.');
  summary.hidden=false;next.hidden=false;
  estimate.textContent=tr('Ενδεικτική τιμή μέσω site, χωρίς αυτόματη δέσμευση ημερομηνιών.','Indicative website rate; dates are not automatically reserved.');
  summary.scrollIntoView({behavior:'smooth',block:'nearest'});
}
for(const element of [start,end])for(const event of ['input','change'])element.addEventListener(event,reset);
adults.addEventListener('change',reset);
children.addEventListener('change',()=>{renderAges();reset();});
renderAges();reset();
calculate.addEventListener('click',async()=>{
  reset();calculate.disabled=true;say('Ελέγχουμε διαθεσιμότητα και τιμές…','Checking availability and rates…');
  try{
    const offer=await getOffer();
    if(offer){active=offer;status.textContent='';displayOffer(offer);}
  }catch(e){
    say('Ο υπολογισμός δεν ολοκληρώθηκε. Έλεγξε αν έχουν δημοσιευτεί οι τιμές και αν το ημερολόγιο είναι ενημερωμένο.','Cannot calculate right now. Check published rates and calendar freshness.');
  }finally{calculate.disabled=false;}
});
next.addEventListener('click',()=>{
  if(!active)return;
  details.hidden=false;next.hidden=true;status.textContent='';
  const first=details.querySelector('[name="firstname"]');if(first)first.focus({preventScroll:true});
  details.scrollIntoView({behavior:'smooth',block:'nearest'});
});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!active){say('Πάτησε πρώτα «Υπολογισμός κόστους».','Calculate the cost first.');return;}
  if(!form.reportValidity())return;
  const guest=validGuests(),s=stay();
  if(!guest||!s){reset();return;}
  const fingerprint=[start.value,end.value,adults.value,children.value,guest.list.join(',')].join('|');
  if(fingerprint!==active.fingerprint){reset();say('Τα στοιχεία άλλαξαν. Υπολόγισε ξανά το κόστος.','Details changed. Calculate the cost again.');return;}
  const mobile=form.elements.mobile.value.replace(/[\s()\-]/g,'');
  if(!/^\+?[0-9]{10,15}$/.test(mobile)){say('Συμπλήρωσε έγκυρο κινητό 10–15 ψηφίων.','Enter a valid mobile number, 10–15 digits.');return;}
  send.disabled=true;say('Επανελέγχουμε την τιμή και τη διαθεσιμότητα…','Rechecking price and availability…');
  try{
    const latest=await getOffer();
    if(!latest)return;
    if(latest.amount!==active.amount){active=latest;details.hidden=true;displayOffer(latest);say('Η τιμή άλλαξε. Έλεγξε το νέο ποσό και πάτησε ξανά «Κράτηση».','The price has changed. Review the new total and press Book now again.');return;}
    const lines=[
      'ΑΙΤΗΜΑ ΚΡΑΤΗΣΗΣ / BOOKING REQUEST (NOT CONFIRMED)',
      'Κατάλυμα / Property: '+property,
      'Ονοματεπώνυμο / Guest: '+form.elements.firstname.value.trim()+' '+form.elements.lastname.value.trim(),
      'Κινητό / Mobile: '+mobile,
      'Άφιξη / Check-in: '+start.value,
      'Αναχώρηση / Check-out: '+end.value,
      'Διανυκτερεύσεις / Nights: '+s.nights,
      'Ενήλικες / Adults: '+guest.a,
      'Παιδιά / Children: '+guest.kids,
      'Ηλικίες παιδιών / Ages: '+(guest.list.join(', ')||'-'),
      'Συνολικό ενδεικτικό ποσό / Indicative total: '+latest.amount.toFixed(2)+' EUR',
      'Παρακαλώ επιβεβαιώστε διαθεσιμότητα, τιμή και τρόπο πληρωμής.',
      'Please confirm availability, rate and payment method.'
    ];
    const url='https://wa.me/306974483266?text='+encodeURIComponent(lines.join('\n'));
    say('Άνοιγμα WhatsApp: πάτησε «Αποστολή» για να σταλεί το αίτημα. Δεν έχει γίνει ακόμη κράτηση ή αποστολή email.','Opening WhatsApp: press Send to submit your request. No confirmed booking or email has been sent.');
    window.location.assign(url);
  }catch(e){
    say('Δεν είναι δυνατή η επαλήθευση. Η αίτηση δεν στάλθηκε. Δοκίμασε ξανά αργότερα.','Could not verify your request. Nothing was sent. Please retry.');
  }finally{send.disabled=false;}
});
})();
