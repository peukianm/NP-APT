/* Two-step, non-binding booking inquiry: estimate -> book -> verified email.
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
let captchaToken='',captchaWidgetId=null;
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
  next.disabled=true;next.setAttribute("aria-disabled","true");details.hidden=true;
  status.textContent='';
  captchaToken='';send.disabled=true;
  if(captchaWidgetId!==null&&window.turnstile)try{window.turnstile.reset(captchaWidgetId);}catch(e){}
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
  if(data.schemaVersion!==1||data.currency!=='EUR'||data.status!=='active'||!data.days||typeof data.days!=='object')throw Error('NO_PRICING');
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
  if(amount===null){say('Πληροφορίες σχετικά με την τιμολόγηση δεν είναι διαθέσιμες για τις συγκεκριμένες ημερομηνίες.','Pricing information is not available for the selected dates.');return null;}
  return {nights,guest,amount,fingerprint:[start.value,end.value,adults.value,children.value,guest.list.join(',')].join('|')};
}
function displayOffer(offer){
  const {nights,amount,guest}=offer;
  summary.textContent=tr('Σύνολο διαμονής: '+money(amount)+' · '+nights.nights+' διανυκτερεύσεις · '+guest.a+' ενήλικες · '+guest.kids+' παιδιά. Η κράτηση επιβεβαιώνεται από τον οικοδεσπότη.','Stay total: '+money(amount)+' · '+nights.nights+' nights · '+guest.a+' adults · '+guest.kids+' children. The host must confirm the booking.');
  summary.hidden=false;next.disabled=false;next.setAttribute("aria-disabled","false");
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
    if(e&&e.message==='NO_PRICING'){say('Πληροφορίες σχετικά με την τιμολόγηση δεν είναι διαθέσιμες για τις συγκεκριμένες ημερομηνίες.','Pricing information is not available for the selected dates.');}
    else{say('Ο υπολογισμός δεν ολοκληρώθηκε. Έλεγξε αν έχουν δημοσιευτεί οι τιμές και αν το ημερολόγιο είναι ενημερωμένο.','Cannot calculate right now. Check published rates and calendar freshness.');}
  }finally{calculate.disabled=false;}
});
next.addEventListener('click',()=>{
  if(!active||next.disabled)return;
  details.hidden=false;next.hidden=true;status.textContent='';
  prepareCaptcha();
  if(dialog&&typeof dialog.showModal==='function')dialog.showModal();
  else details.scrollIntoView({behavior:'smooth',block:'nearest'});
});
// Email delivery requires a deployed server endpoint with Gmail OAuth / Apps Script authorization.
// Never show the success dialog on mere button click or on a failed request.
const dialog=document.getElementById('booking-contact-dialog');
const closeDialog=dialog?.querySelector('[data-close-booking-dialog]');
if(closeDialog)closeDialog.addEventListener('click',()=>{
  dialog.close();
  const first=details.querySelector('[name="firstname"]');
  if(first)first.focus({preventScroll:true});
  details.scrollIntoView({behavior:'smooth',block:'nearest'});
});
const emailEndpoint=typeof window.TOGETHER_HOME_BOOKING_EMAIL_ENDPOINT==='string'
  ? window.TOGETHER_HOME_BOOKING_EMAIL_ENDPOINT.trim() : '';
const turnstileSiteKey=typeof window.TOGETHER_HOME_TURNSTILE_SITE_KEY==='string'
  ? window.TOGETHER_HOME_TURNSTILE_SITE_KEY.trim() : '';
const emailReady=/^https:\/\//.test(emailEndpoint)&&Boolean(turnstileSiteKey);
send.disabled=true;
let captchaHolder=null;
function prepareCaptcha(){
  if(!emailReady)return;
  if(!captchaHolder){captchaHolder=document.createElement('div');captchaHolder.className='direct-captcha';details.insertBefore(captchaHolder,send);}
  const render=()=>{
    if(!window.turnstile||captchaWidgetId!==null||details.hidden)return;
    captchaWidgetId=window.turnstile.render(captchaHolder,{
      sitekey:turnstileSiteKey,
      callback:token=>{captchaToken=token;send.disabled=false;},
      'expired-callback':()=>{captchaToken='';send.disabled=true;},
      'error-callback':()=>{captchaToken='';send.disabled=true;say('Δεν ολοκληρώθηκε ο έλεγχος ασφαλείας. Δοκίμασε ξανά.','Security verification failed. Please try again.');}
    });
  };
  if(window.turnstile){render();return;}
  let sdk=document.querySelector('[data-booking-turnstile-sdk]');
  if(!sdk){sdk=document.createElement('script');sdk.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';sdk.async=true;sdk.dataset.bookingTurnstileSdk='';document.head.appendChild(sdk);}
  sdk.addEventListener('load',render,{once:true});
}
if(emailReady){
  const note=form.querySelector('.direct-clarifier.lang-el');
  if(note)note.textContent='Με την υποβολή θα σταλεί email στον οικοδεσπότη. Το κατάλυμα θα επικοινωνήσει μαζί σας για την ολοκλήρωση της κράτησης.';
  const noteEnglish=form.querySelector('.direct-clarifier.lang-en');
  if(noteEnglish)noteEnglish.textContent='Submitting sends an email to the host. The property will contact you to finalize the booking.';
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(send.disabled||!emailReady||!captchaToken){say('Η αποστολή αιτημάτων μέσω email δεν έχει ενεργοποιηθεί ακόμη. Παρακαλούμε επικοινωνήστε απευθείας μαζί μας.','Email requests have not been activated yet. Please contact the property directly.');return;}
  if(!active||next.disabled||details.hidden||!form.reportValidity())return;
  const guest=validGuests(),s=stay();
  if(!guest||!s)return;
  const fp=[start.value,end.value,adults.value,children.value,guest.list.join(',')].join('|');
  if(fp!==active.fingerprint){reset();say('Τα στοιχεία άλλαξαν. Υπολόγισε ξανά το κόστος.','Details changed. Please calculate again.');return;}
  const mobile=form.elements.mobile.value.replace(/[\s()\-]/g,'');
  if(!/^\+?[0-9]{10,15}$/.test(mobile)){say('Συμπλήρωσε έγκυρο κινητό τηλέφωνο.','Enter a valid mobile number.');return;}
  send.disabled=true;
  say('Ελέγχουμε ξανά τη διαθεσιμότητα και υποβάλλουμε το αίτημα…','Rechecking availability and submitting your request…');
  try{
    const latest=await getOffer();
    if(!latest)return;
    if(latest.amount!==active.amount){active=latest;details.hidden=true;displayOffer(latest);say('Η τιμή άλλαξε. Επιβεβαίωσε ξανά το νέο ποσό.','The price has changed. Please review the new total.');return;}
    const payload={
      property,firstName:form.elements.firstname.value.trim(),lastName:form.elements.lastname.value.trim(),
      mobile,checkin:start.value,checkout:end.value,nights:s.nights,
      adults:guest.a,children:guest.kids,childAges:guest.list,quotedTotal:latest.amount,
      currency:'EUR',website:location.origin,turnstileToken:captchaToken
    };
    const response=await fetch(emailEndpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),mode:'cors',cache:'no-store'
    });
    if(!response.ok)throw Error('Email service rejected request');
    const result=await response.json();
    if(result.success!==true)throw Error('Email not confirmed');
    status.textContent='';
    say('Το αίτημά σας στάλθηκε επιτυχώς. Θα επικοινωνήσουμε μαζί σας από το κατάλυμα για την ολοκλήρωση της κράτησης.','Your request was sent successfully. The property will contact you to finalize the booking.');
    active=null;next.disabled=true;details.hidden=true;
  }catch(error){
    say('Δεν επιβεβαιώθηκε η αποστολή του email. Το αίτημα ΔΕΝ έχει καταχωριστεί. Δοκιμάστε ξανά ή επικοινωνήστε μαζί μας.','Email delivery could not be confirmed. Your request was NOT recorded. Please try again or contact us.');
  }finally{
    captchaToken='';send.disabled=true;
    if(captchaWidgetId!==null&&window.turnstile)try{window.turnstile.reset(captchaWidgetId);}catch(e){}
  }
});
})();
