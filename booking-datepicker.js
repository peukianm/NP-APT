/* Accessible, dependency-free date picker for the booking date fields. */
(function(){
  function init(){
    const form=document.getElementById('home-date-form')||document.getElementById('date-search-form');
    if(!form)return;
    const start=form.querySelector('[name="checkin"]');
    const end=form.querySelector('[name="checkout"]');
    if(!start||!end)return;
    const picker=document.createElement('div');
    picker.className='booking-date-popup';
    picker.setAttribute('role','dialog');
    picker.setAttribute('aria-label','Choose date');
    picker.hidden=true;
    picker.innerHTML='<div class="bdp-heading"><button type="button" class="bdp-prev" aria-label="Previous month">‹</button><strong class="bdp-month"></strong><button type="button" class="bdp-next" aria-label="Next month">›</button><button type="button" class="bdp-close" aria-label="Close calendar">×</button></div><div class="bdp-days" role="grid"></div>';
    document.body.appendChild(picker);
    const prev=picker.querySelector('.bdp-prev'),next=picker.querySelector('.bdp-next');
    const closeBtn=picker.querySelector('.bdp-close');
    const monthName=picker.querySelector('.bdp-month'),grid=picker.querySelector('.bdp-days');
    let field=null,month=new Date(),prior=null;
    function english(){return document.documentElement.lang==='en'}
    function text(el,en){return english()?en:el}
    function today(){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
    function parse(s){
      const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
      if(!m)return null;
      const d=new Date(+m[3],+m[2]-1,+m[1]);
      return d.getFullYear()===+m[3]&&d.getMonth()===+m[2]-1&&d.getDate()===+m[1]?d:null;
    }
    function display(d){return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear()}
    function minimum(){
      const d=today();
      if(field===end){
        const s=parse(start.value);
        if(s){const next=new Date(s.getFullYear(),s.getMonth(),s.getDate()+1);if(next>d)return next;}
      }
      return d;
    }
    function appendDay(label,kind,disabled,callback,title){
      const node=document.createElement('button');
      node.type='button';node.className='bdp-day '+kind;
      node.textContent=label;node.disabled=disabled;
      if(title)node.setAttribute('aria-label',title);
      if(callback)node.addEventListener('click',callback);
      grid.appendChild(node);
    }
    function render(){
      if(!field)return;
      const min=minimum();monthName.textContent=new Intl.DateTimeFormat(english()?'en-GB':'el-GR',{month:'long',year:'numeric'}).format(month);
      const first=new Date(month.getFullYear(),month.getMonth(),1);
      const minMonth=new Date(min.getFullYear(),min.getMonth(),1);
      const maxMonth=new Date(today().getFullYear()+2,today().getMonth(),1);
      prev.disabled=first<=minMonth;
      next.disabled=first>=maxMonth;
      grid.replaceChildren();
      const weekdays=english()?['Mo','Tu','We','Th','Fr','Sa','Su']:['Δε','Τρ','Τε','Πε','Πα','Σα','Κυ'];
      for(const name of weekdays){const cell=document.createElement('span');cell.className='bdp-weekday';cell.textContent=name;grid.appendChild(cell);}
      const offset=(first.getDay()+6)%7;
      for(let i=0;i<offset;i++){const cell=document.createElement('span');cell.className='bdp-empty';grid.appendChild(cell);}
      const selected=parse(field.value);
      const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
      for(let d=1;d<=count;d++){
        const date=new Date(month.getFullYear(),month.getMonth(),d);
        appendDay(String(d),selected&&selected.getTime()===date.getTime()?'bdp-selected':'',date<min||date.getFullYear()>today().getFullYear()+2,()=>choose(date),display(date));
      }
    }
    function position(){
      if(picker.hidden||!field)return;
      const r=field.getBoundingClientRect();
      const w=Math.min(336,window.innerWidth-16);
      const left=Math.min(window.innerWidth-w-8,Math.max(8,r.left));
      picker.style.width=w+'px';picker.style.left=left+'px';
      const h=picker.offsetHeight||340;
      const below=window.innerHeight-r.bottom;
      picker.style.top=(below>=h+8||r.top<h+8?Math.min(window.innerHeight-h-8,r.bottom+7):Math.max(8,r.top-h-7))+'px';
    }
    function close(restore){if(picker.hidden)return;picker.hidden=true;picker.style.display='none';if(restore&&prior&&prior.focus)prior.focus();field=null}
    function open(input){
      if(!picker.hidden&&field===input){close(false);return;}
      field=input;prior=input;
      const min=minimum(), selected=parse(input.value);
      const reference=selected&&selected>=min?selected:min;
      month=new Date(reference.getFullYear(),reference.getMonth(),1);
      picker.hidden=false;picker.style.display='block';render();position();
      closeBtn.focus({preventScroll:true});
    }
    function choose(date){
      const current=field;
      current.value=display(date);
      current.dispatchEvent(new Event('input',{bubbles:true}));
      current.dispatchEvent(new Event('change',{bubbles:true}));
      close(false);
      if(current===start){
        const checkout=parse(end.value);
        if(checkout&&checkout<=date){end.value='';end.dispatchEvent(new Event('input',{bubbles:true}));}
        open(end);
      }else{
        current.focus({preventScroll:true});
      }
    }
    for(const input of [start,end]){
      input.readOnly=true;
      input.classList.add('calendar-date-input');
      input.setAttribute('aria-haspopup','dialog');
      input.setAttribute('aria-label',input===start?text('Επιλογή ημερομηνίας άφιξης','Select check-in date'):text('Επιλογή ημερομηνίας αναχώρησης','Select check-out date'));
      input.addEventListener('click',()=>open(input));
      input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){e.preventDefault();open(input);}});
    }
    prev.addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);render();position()});
    next.addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);render();position()});
    closeBtn.addEventListener('click',()=>close(true));
    document.addEventListener('pointerdown',e=>{if(!picker.hidden&&!picker.contains(e.target)&&e.target!==start&&e.target!==end)close(false)});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!picker.hidden){e.preventDefault();close(true)}});
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,true);
    const switchers=document.querySelectorAll('.lang-switch button, #el, #en');
    switchers.forEach(b=>b.addEventListener('click',()=>{if(!picker.hidden){render();position()}}));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
