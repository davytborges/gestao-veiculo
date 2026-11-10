import {initializeApp,getApps,getApp} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {getFirestore,doc,getDoc,getDocFromServer,onSnapshot,setDoc} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
const cfg={apiKey:'AIzaSyDoZly1sMrvNtS91isAiWnR5YNdw5_1FiQ',authDomain:'minhas-recargas-byd.firebaseapp.com',projectId:'minhas-recargas-byd',storageBucket:'minhas-recargas-byd.firebasestorage.app',messagingSenderId:'141721087925',appId:'1:141721087925:web:975c09f90de7c9012773fc'};
const app=getApps().length?getApp():initializeApp(cfg),auth=getAuth(app),db=getFirestore(app),$=id=>document.getElementById(id);
const brl=n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),fmt=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2}),num=v=>Number(String(v??'').trim().replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.')),today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const duration=h=>{const mins=Math.round(Number(h||0)*60);return Math.floor(mins/60)+'h'+String(mins%60).padStart(2,'0')+'min'};
// Históricos do Excel guardam custo em R$, sem medição de kWh. Conversão equivalente com tarifa de R$ 1,20/kWh.
const kwhExibicao=r=>r.source==='Excel 2026'&&Number.isFinite(r.energyCostOverride)?Number(r.energyCostOverride)/1.20:Number(r.kwh||0);
const initial=()=>({rides:[],expenses:[],withdrawals:[],settings:{tariff:1.185,perKm:0.45,fuelPrice:6}});let state=initial(),ready=false,ref=null,unsubscribe=null,writing=false,homePeriod='7',homeSelectedDate=today();
const status=(s)=>{$('saveStatus').textContent=s};const newId=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random();
for(const id of ['rideDate','cashDate'])$(id).value=today();$('filterMonth').value=today().slice(0,7);$('filterYear').value=today().slice(0,4);$('dateFrom').value=today().slice(0,7)+'-01';$('dateTo').value=today();
function fields(){for(const k of ['tariff','perKm','fuelPrice'])$(k).value=String(state.settings[k]).replace('.',',')}
function permitted(){if(!ready){alert('Entre com Google e aguarde a sincronização antes de salvar.');return false}return true}
async function save(){if(!permitted())return false;const was=JSON.stringify(state);writing=true;status('Salvando na nuvem…');try{await setDoc(ref,{...state,updatedAt:new Date().toISOString()});status('Sincronizado ✓');return true}catch(e){status('Falha ao salvar: '+e.message);alert('Falha ao salvar na nuvem. Verifique sua internet.');return false}finally{writing=false}}
function safe(v){return Number.isFinite(v)&&v>=0&&v<=1e8}

const paidFromGains=x=>x?.kind==='expense'&&x.bucket==='ganhos';
const operationalCashExpenses=(begin,end)=>(state.withdrawals||[]).filter(x=>paidFromGains(x)&&(!begin||x.date>=begin)&&(!end||x.date<=end));

function render(){const month=$('filterMonth').value||today().slice(0,7),mode=$('periodMode').value,from=$('dateFrom').value,to=$('dateTo').value,year=$('filterYear').value;const include=d=>mode==='range'?(!!from&&!!to&&from<=to&&d>=from&&d<=to):mode==='year'?d.slice(0,4)===year:d.slice(0,7)===month;
 renderCash();const rides=state.rides.filter(r=>include(r.date)),exp=state.expenses.filter(e=>include(e.date)),sum=k=>rides.reduce((a,r)=>a+Number(r[k]||0),0),revenue=dailyRevenue(rides),km=sum('km'),hours=sum('hours'),kwh=rides.reduce((a,r)=>a+kwhExibicao(r),0),liters=sum('liters'),costEnergy=rides.reduce((a,r)=>a+(Number.isFinite(r.energyCostOverride)?r.energyCostOverride:r.kwh*(r.tariff??state.settings.tariff)),0),reserve=rides.reduce((a,r)=>a+r.km*(r.perKm??state.settings.perKm),0),expenses=exp.reduce((a,e)=>a+e.value,0)+operationalCashExpenses().filter(x=>include(x.date)).reduce((a,x)=>a+Number(x.value||0),0),profit=revenue-costEnergy-reserve-expenses;
 $('revenue').textContent=brl(revenue);$('profit').textContent=brl(profit);$('distance').textContent=fmt(km)+' km / '+duration(hours);$('energy').textContent=fmt(kwh)+' kWh';$('costEnergy').textContent=brl(costEnergy);$('reserve').textContent=brl(reserve);$('expenses').textContent=brl(expenses);$('ratios').textContent=(km?brl(profit/km):'—')+' · '+(hours?brl(profit/hours):'—');$('detail').textContent=`${rides.length} lançamento(s) de corrida e ${exp.length} despesa(s) antiga(s) no período. Gasolina consumida: ${fmt(liters)} L (informativo; abastecimentos são registrados como despesa).`;
 function list(id,items,type){$(id).replaceChildren();if(!items.length){const p=document.createElement('p');p.className='hint';p.textContent='Nenhum lançamento.';$(id).append(p)}for(const r of [...items].map((record,index)=>({record,index})).sort((a,b)=>b.record.date.localeCompare(a.record.date)||(type==='ride'?b.index-a.index:0)).map(x=>x.record)){const div=document.createElement('div');div.className='record';const left=document.createElement('div'),right=document.createElement('div'),title=document.createElement('strong'),small=document.createElement('small'),button=document.createElement('button');title.textContent=r.date.split('-').reverse().join('/');small.textContent=type==='ride'?`${fmt(r.km)} km · ${duration(r.hours)} · ${fmt(kwhExibicao(r))+' kWh'} · Uber ${earningsLabel(r.uber)} · 99 ${earningsLabel(r.n99)}${r.other?' · Outros '+brl(r.other):''}${r.bonus?' · Bônus '+brl(r.bonus):''}`:`${r.category} · ${r.note||'Sem observação'}`;left.append(title,small);const price=document.createElement('strong');price.textContent=type==='ride'?(latestRideIds().has(r.id)?brl(revenueOfDate(r.date)):''):brl(r.value);const edit=document.createElement('button');edit.type='button';edit.textContent='Editar';edit.className='secondary';edit.onclick=()=>{show('inicio');openHomeEditor(type,r.id)};right.append(price,edit);button.textContent='Excluir';button.className='danger';button.onclick=async()=>{if(!confirm('Excluir este registro?'))return;const key=type==='ride'?'rides':'expenses',old=state[key];state[key]=old.filter(x=>x.id!==r.id);if(!await save())state[key]=old;render()};right.append(button);div.append(left,right);$(id).append(div)}}
 list('rides',state.rides,'ride');const byday=new Map();const daysRevenue=dayRevenueMap(rides);for(const r of rides){const x=byday.get(r.date)||{rev:0,km:0,kwh:0,hours:0,energy:0,reserve:0,expenses:0};x.rev=daysRevenue.get(r.date)?.rev||0;x.km+=Number(r.km||0);x.kwh+=kwhExibicao(r);x.hours+=Number(r.hours||0);x.energy+=Number.isFinite(r.energyCostOverride)?r.energyCostOverride:Number(r.kwh||0)*Number(r.tariff??state.settings.tariff);x.reserve+=Number(r.km||0)*Number(r.perKm??state.settings.perKm);byday.set(r.date,x)}for(const e of [...exp,...operationalCashExpenses().filter(x=>include(x.date))]){const x=byday.get(e.date)||{rev:0,km:0,kwh:0,hours:0,energy:0,reserve:0,expenses:0};x.expenses+=Number(e.value||0);byday.set(e.date,x)}$('days').replaceChildren();for(const [d,v] of [...byday].sort((a,b)=>b[0].localeCompare(a[0]))){if(!v.km&&!v.rev)continue;const profit=v.rev-v.energy-v.reserve-v.expenses;const p=document.createElement('div');p.className='record';p.textContent=`${d.split('-').reverse().join('/')} · ${brl(profit)} · ${fmt(v.km)} km · ${fmt(v.kwh)} kWh · ${duration(v.hours)} · ${v.km?brl(profit/v.km)+'/km':'—/km'}`;$('days').append(p)}if(!$('days').children.length)$('days').textContent='Nenhuma corrida neste período.';renderHome();}

function computeCash(){const sums={energia:0,reserva:0,ganhos:0};sums.ganhos=dailyRevenue(state.rides);for(const r of state.rides){const energy=Number.isFinite(r.energyCostOverride)?r.energyCostOverride:Number(r.kwh||0)*Number(r.tariff??state.settings.tariff),reserve=Number(r.km||0)*Number(r.perKm??state.settings.perKm);sums.energia+=energy;sums.reserva+=reserve;sums.ganhos-=energy+reserve;}sums.ganhos-=(state.expenses||[]).reduce((a,e)=>a+Number(e.value||0),0);for(const x of (state.withdrawals||[]))sums[x.bucket]=(sums[x.bucket]||0)-Number(x.value||0);return sums}
function renderCash(){
 const b=computeCash();$('cashEnergy').textContent=brl(b.energia);$('cashProfit').textContent=brl(b.ganhos);$('cashReserve').textContent=brl(b.reserva);$('cashTotal').textContent=brl(b.energia+b.ganhos+b.reserva);
 $('cashNote').textContent='Cada movimentação diminui apenas o saldo selecionado. Despesas pagas com Ganhos disponíveis também entram no lucro líquido; custos pagos com Energia ou Reserva já foram provisionados pelas corridas.';
 const el=$('cashHistory');el.replaceChildren();const rows=[...(state.withdrawals||[])].sort((a,b)=>b.date.localeCompare(a.date));if(!rows.length){const p=document.createElement('p');p.className='hint';p.textContent='Nenhuma movimentação registrada.';el.append(p)}
 for(const x of rows){const d=document.createElement('div');d.className='record';const label=document.createElement('div');const kind=x.kind==='expense'?'Despesa':'Retirada';label.textContent=x.date.split('-').reverse().join('/')+' · '+kind+(x.kind==='expense'&&x.category?' / '+x.category:'')+' · '+({energia:'Energia',ganhos:'Ganhos',reserva:'Reserva do carro'}[x.bucket]||x.bucket)+' · '+(x.description||'');const right=document.createElement('div');right.textContent=brl(x.value)+' ';const del=document.createElement('button');del.textContent='Excluir';del.className='danger';del.onclick=async()=>{if(!confirm('Excluir esta movimentação? O valor retornará ao saldo correspondente.'))return;const old=state.withdrawals;state.withdrawals=old.filter(a=>a.id!==x.id);if(!await save())state.withdrawals=old;render()};right.append(del);d.append(label,right);el.append(d)}
}
function updateCashTypeUI(){const expense=$('cashType').value==='expense';$('cashExpenseCategoryWrap').hidden=!expense;$('cashSubmit').textContent=expense?'− Registrar despesa':'− Registrar retirada';$('cashAccountingHint').hidden=!expense;}
$('cashType').onchange=updateCashTypeUI;updateCashTypeUI();
$('cashForm').onsubmit=async e=>{e.preventDefault();if(!permitted())return;const value=num($('cashValue').value),bucket=$('cashCategory').value,description=$('cashDescription').value.trim(),date=$('cashDate').value,kind=$('cashType').value,category=kind==='expense'?$('cashExpenseCategory').value:null;
 if(!safe(value)||value<=0||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||description.length<2||!['energia','ganhos','reserva'].includes(bucket)||!['expense','withdrawal'].includes(kind))return alert('Informe data, valor, descrição e origem válidos.');
 const b=computeCash();if(value>b[bucket]+0.00001)return alert('Valor maior que o saldo disponível desta categoria.');
 const x={id:newId(),date,value,bucket,description,kind,...(category?{category}:{})};state.withdrawals.push(x);
 if(!await save())state.withdrawals.pop();else{$('cashValue').value='';$('cashDescription').value=''}render()
};
// v32: início responsivo e edição sem excluir o lançamento.
const homeFields={
 ride:[['date','Data','date'],['km','Km rodados','number'],['kwh','Consumo elétrico (kWh)','number'],['hours','Tempo trabalhado (horas)','number'],['liters','Gasolina usada (litros)','number'],['uber','Uber acumulado do dia (R$) — obrigatório','number'],['n99','99 acumulado do dia (R$) — obrigatório','number']],
 expense:[['date','Data','date'],['category','Categoria','text'],['value','Valor (R$)','number'],['note','Descrição','text']],
 charge:[['date','Data','date'],['kwh','Energia consumida (kWh)','number'],['tariff','Tarifa (R$/kWh)','number'],['location','Local','text']]
};
let editing=null;
const sumHome=(arr,key)=>arr.reduce((a,r)=>a+Number(r[key]||0),0);
const revenueHome=r=>Number(r.uber||0)+Number(r.n99||0)+Number(r.other||0)+Number(r.bonus||0);
const energyHome=r=>Number.isFinite(r.energyCostOverride)?r.energyCostOverride:Number(r.kwh||0)*Number(r.tariff??state.settings.tariff);
const reserveHome=r=>Number(r.km||0)*Number(r.perKm??state.settings.perKm);
// Uber e 99 são totais acumulados por aplicativo, NÃO valores de cada turno.
// A ordem original no array é a ordem de cadastro. Editar não muda a prioridade.
// Campo null significa "não atualizar"; zero é uma atualização explícita.
function dayRevenueMap(rides){
 const byDate=new Map();
 for(const r of rides){
  let d=byDate.get(r.date);
  if(!d){d={uber:0,n99:0,other:0,bonus:0,latestId:null};byDate.set(r.date,d)}
  if(r.uber!==null&&r.uber!==undefined&&r.uber!==''&&Number.isFinite(Number(r.uber)))d.uber=Number(r.uber);
  if(r.n99!==null&&r.n99!==undefined&&r.n99!==''&&Number.isFinite(Number(r.n99)))d.n99=Number(r.n99);
  d.other+=Number(r.other||0);d.bonus+=Number(r.bonus||0);
  d.latestId=r.id;
 }
 for(const d of byDate.values())d.rev=d.uber+d.n99+d.other+d.bonus;
 return byDate;
}
const dailyRevenue=rides=>[...dayRevenueMap(rides).values()].reduce((total,d)=>total+d.rev,0);
const revenueOfDate=(date)=>dayRevenueMap(state.rides).get(date)?.rev||0;
const latestRideIds=()=>new Set([...dayRevenueMap(state.rides).values()].map(d=>d.latestId));
const earningsLabel=v=>v===null||v===undefined?'—':brl(Number(v));

function homeTotals(begin,end){const rides=state.rides.filter(r=>r.date>=begin&&r.date<=end),expenses=state.expenses.filter(x=>x.date>=begin&&x.date<=end);const rev=dailyRevenue(rides),energy=rides.reduce((a,r)=>a+energyHome(r),0),reserve=rides.reduce((a,r)=>a+reserveHome(r),0),km=sumHome(rides,'km'),kwh=rides.reduce((a,r)=>a+kwhExibicao(r),0),hours=sumHome(rides,'hours'),expense=sumHome(expenses,'value')+operationalCashExpenses(begin,end).reduce((a,x)=>a+Number(x.value||0),0);return{rev,energy,reserve,km,kwh,hours,expense,profit:rev-energy-reserve-expense}}
function dateISO(d){return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function offsetISO(d,n){const q=new Date(d.getFullYear(),d.getMonth(),d.getDate()+n,12);return dateISO(q)}
// Comparativo por DIAS COM CORRIDAS, nunca por dias corridos do calendário.
// Os períodos não se sobrepõem e cada lançamento do mesmo dia entra na soma.
function homeWorkingPeriods(amount){
 const n=[7,15,30].includes(Number(amount))?Number(amount):7;
 const days=[...new Set(state.rides.map(r=>r.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=today()))].sort();
 return {n,current:days.slice(-n),previous:days.slice(-2*n,-n)};
}
function homeWorkingTotals(dates){
 const set=new Set(dates),rides=state.rides.filter(r=>set.has(r.date));
 const rev=dailyRevenue(rides);
 const energy=rides.reduce((a,r)=>a+energyHome(r),0);
 const reserve=rides.reduce((a,r)=>a+reserveHome(r),0);
 const km=sumHome(rides,'km'),hours=sumHome(rides,'hours');
 const expenses=(state.expenses||[]).filter(e=>set.has(e.date)).reduce((a,e)=>a+Number(e.value||0),0)
  +(state.withdrawals||[]).filter(e=>paidFromGains(e)&&set.has(e.date)).reduce((a,e)=>a+Number(e.value||0),0);
 return {rev,energy,reserve,km,hours,expenses,profit:rev-energy-reserve-expenses};
}
function briefDates(days){if(!days.length)return 'sem registros';const fmtDate=d=>d.slice(8)+'/'+d.slice(5,7);return fmtDate(days[0])+' a '+fmtDate(days[days.length-1]);}
function comparisonValue(id,value,prior){const node=$(id);if(!node)return;if(prior===0){node.textContent=value===0?'Sem variação':'Sem base anterior';node.className='';return}const rate=(value-prior)/Math.abs(prior)*100;node.textContent=(rate>0?'▲ ':rate<0?'▼ ':'= ')+new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Math.abs(rate))+'%';node.className=rate>0?'good':rate<0?'bad':''}
function svgNode(tag,attrs,textValue){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs||{}))n.setAttribute(k,v);if(textValue!=null)n.textContent=String(textValue);return n}

// v47: desempenho por dias com corridas, dois graficos independentes e mesmas cores.
let performancePeriod='15';
const performanceMoney=n=>Number.isFinite(n)?brl(n):'—';
const performanceGradient=(v,lower,upper)=>{
 if(v<lower)return '#f05252';
 if(v>upper)return '#4de0b0';
 const mid=(lower+upper)/2;
 const mix=(a,b,t)=>Math.round(a+(b-a)*Math.max(0,Math.min(1,t)));
 const blend=(a,b,t)=>`rgb(${mix(a[0],b[0],t)},${mix(a[1],b[1],t)},${mix(a[2],b[2],t)})`;
 return v<=mid?blend([240,82,82],[245,201,76],(v-lower)/(mid-lower)):
  blend([245,201,76],[77,224,176],(v-mid)/(upper-mid));
};
function performanceColor(v){return performanceGradient(v,1,1.5)}
function performanceHourColor(v){return performanceGradient(v,20,30)}
function renderPerformance(){
 const chartKm=$('perfChartKm'),chartHour=$('perfChartHour');
 if(!chartKm||!chartHour)return;
 const grouped=new Map();
 for(const r of state.rides){
  if(typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))continue;
  let d=grouped.get(r.date);
  if(!d){d={date:r.date,km:0,hours:0,profit:0,entries:0};grouped.set(r.date,d)}
  d.km+=Number(r.km||0);
  d.hours+=Number(r.hours||0);
  d.profit-=energyHome(r)+reserveHome(r);
  d.entries++;
 }
 const revenueByDay=dayRevenueMap(state.rides);
 for(const d of grouped.values())d.profit+=revenueByDay.get(d.date)?.rev||0;
 const allRows=[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const rows=performancePeriod==='all'?allRows:allRows.slice(-Number(performancePeriod));
 const caption=performancePeriod==='all'?'Todo o período com corridas':`Últimos ${performancePeriod} dias com corridas`;
 $('perfCaption').textContent=caption;
 const points=rows.map((d,i)=>({
  index:i,date:d.date,entries:d.entries,km:d.km,hours:d.hours,profit:d.profit,
  kmRate:d.km>0?d.profit/d.km:null,
  hourRate:d.hours>0?d.profit/d.hours:null
 }));
 const validKm=points.filter(p=>Number.isFinite(p.kmRate));
 const validHour=points.filter(p=>Number.isFinite(p.hourRate));
 const sum=(arr,k)=>arr.reduce((a,x)=>a+x[k],0);
 const avgKm=validKm.length&&sum(validKm,'km')>0?sum(validKm,'profit')/sum(validKm,'km'):null;
 $('perfAvgKm').textContent=avgKm===null?'—':performanceMoney(avgKm)+'/km';
 $('perfAvgKm').style.color=avgKm===null?'':performanceColor(avgKm);
 const avgHour=validHour.length&&sum(validHour,'hours')>0?sum(validHour,'profit')/sum(validHour,'hours'):null;
 $('perfAvgHour').textContent=avgHour===null?'—':performanceMoney(avgHour)+'/h';
 $('perfAvgHour').style.color=avgHour===null?'':performanceHourColor(avgHour);
 const fmtDate=s=>s.split('-').reverse().join('/');
 const numeric=n=>Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 function drawOne(key){
  const isKm=key==='km',chart=isKm?chartKm:chartHour;
  const tooltip=$(isKm?'perfTooltipKm':'perfTooltipHour'),plot=$(isKm?'perfPlotKm':'perfPlotHour');
  const field=isKm?'kmRate':'hourRate',getColor=isKm?performanceColor:performanceHourColor;
  chart.replaceChildren();tooltip.hidden=true;
  const left=58,right=680,top=27,bottom=240;
  const x=i=>points.length===1?(left+right)/2:left+i*(right-left)/Math.max(1,points.length-1);
  const vals=points.map(p=>p[field]).filter(Number.isFinite);
  if(!vals.length){
   chart.append(svgNode('text',{x:360,y:150,fill:'#aec5d7','text-anchor':'middle','font-size':15},'Nenhum lançamento com '+(isKm?'quilometragem':'horas')+' neste período.'));
   return;
  }
  const low=Math.min(...vals),high=Math.max(...vals),padding=Math.max((high-low)*.16,Math.abs(high)*.08, isKm?.05:1);
  const axis={min:Math.min(0,low-padding),max:high+padding};
  if(axis.max<=axis.min)axis.max=axis.min+1;
  const y=v=>bottom-(v-axis.min)/(axis.max-axis.min)*(bottom-top);
  for(let i=0;i<5;i++){
   const yy=top+i*(bottom-top)/4;
   chart.append(svgNode('line',{x1:left,x2:right,y1:yy,y2:yy,stroke:'#345168','stroke-width':1}));
   chart.append(svgNode('text',{x:left-10,y:yy+4,fill:'#afc3d2','font-size':11,'text-anchor':'end'},numeric(axis.max-i*(axis.max-axis.min)/4)));
  }
  const maxLabels=9,step=Math.max(1,Math.ceil(points.length/maxLabels));
  points.forEach((p,i)=>{
   if(i%step===0||i===points.length-1){
    const label=points.length>30?fmtDate(p.date).slice(0,5):String(i+1);
    chart.append(svgNode('text',{x:x(i),y:268,fill:'#b6cad7','font-size':points.length>30?9:11,'text-anchor':'middle'},label));
   }
  });
  chart.append(svgNode('text',{x:365,y:295,fill:'#b6cad7','font-size':11,'text-anchor':'middle'},'Dias com corridas (do mais antigo ao mais recente)'));
  const lines=svgNode('g',{}),dots=svgNode('g',{});chart.append(lines,dots);
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i];if(!Number.isFinite(a[field])||!Number.isFinite(b[field]))continue;
   // Segmentos curtos reproduzem o degrade entre as bolinhas.
   const chunks=24;
   for(let k=0;k<chunks;k++){
    const t=k/chunks,u=(k+1)/chunks,v=a[field]+(b[field]-a[field])*t,w=a[field]+(b[field]-a[field])*u;
    lines.append(svgNode('line',{
     x1:x(i-1)+(x(i)-x(i-1))*t,y1:y(v),x2:x(i-1)+(x(i)-x(i-1))*u,y2:y(w),
     stroke:getColor((v+w)/2),'stroke-width':2.8,'stroke-linecap':'round'
    }));
   }
  }
  const hideTip=()=>{tooltip.hidden=true};
  const showTip=p=>{
   const value=p[field];if(!Number.isFinite(value))return;
   const small=document.createElement('small');
   small.textContent=`${fmtDate(p.date)} · ${p.entries} ${p.entries===1?'lançamento':'lançamentos'} · ${isKm?'Lucro/km':'Lucro/hora'}`;
   const strong=document.createElement('strong');strong.textContent=performanceMoney(value)+(isKm?'/km':'/h');
   tooltip.replaceChildren(small,strong);
   tooltip.style.setProperty('--tip-color',getColor(value));tooltip.hidden=false;
   const box=plot.getBoundingClientRect(),pnt=chart.createSVGPoint();pnt.x=x(p.index);pnt.y=y(value);
   const matrix=chart.getScreenCTM();if(!matrix)return;
   const screen=pnt.matrixTransform(matrix),px=screen.x-box.left,py=screen.y-box.top;
   tooltip.style.left=Math.max(4,Math.min(box.width-tooltip.offsetWidth-4,px-tooltip.offsetWidth/2))+'px';
   tooltip.style.top=Math.max(4,Math.min(box.height-tooltip.offsetHeight-4,py-tooltip.offsetHeight-12))+'px';
  };
  points.forEach(p=>{
   const value=p[field];if(!Number.isFinite(value))return;
   const cx=x(p.index),cy=y(value),radius=points.length>45?3.2:4.6;
   dots.append(svgNode('circle',{cx,cy,r:radius,fill:getColor(value),stroke:'#0b2032','stroke-width':1.3,'pointer-events':'none'}));
   const hit=svgNode('circle',{cx,cy,r:points.length>45?8:14,fill:'transparent',role:'button',tabindex:0,class:'perf-dot',
    'aria-label':`${fmtDate(p.date)}: ${performanceMoney(value)} ${isKm?'por km':'por hora'}`});
   hit.addEventListener('pointerenter',()=>showTip(p));
   hit.addEventListener('pointerleave',hideTip);
   hit.addEventListener('focus',()=>showTip(p));
   hit.addEventListener('blur',hideTip);
   hit.addEventListener('click',e=>{e.stopPropagation();showTip(p)});
   hit.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showTip(p)}else if(e.key==='Escape')hideTip()});
   dots.append(hit);
  });
  chart.addEventListener('pointerleave',hideTip,{once:true});
 }
 drawOne('km');drawOne('hour');
}
for(const button of document.querySelectorAll('[data-performance-period]')){
 button.addEventListener('click',()=>{
  performancePeriod=button.dataset.performancePeriod;
  for(const item of document.querySelectorAll('[data-performance-period]')){
   const selected=item===button;item.classList.toggle('selected',selected);item.setAttribute('aria-pressed',String(selected));
  }
  renderPerformance();
 });
}

function renderEfficiency(){
 const chart=$('homeEfficiencyChart');if(!chart)return;
 chart.replaceChildren();
 // Um ponto por dia com quilometragem. Exibe os últimos 15 dias com dados,
 // não os últimos 15 dias do calendário (evita espaços vazios no gráfico).
 const byDay=new Map();
 for(const r of state.rides){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||''))continue;
  const km=Number(r.km||0),kwh=kwhExibicao(r),energy=energyHome(r);
  if(!Number.isFinite(km)||km<=0)continue;
  const day=byDay.get(r.date)||{date:r.date,km:0,kwh:0,energy:0};
  day.km+=km;
  day.kwh+=Number.isFinite(kwh)?kwh:0;
  day.energy+=Number.isFinite(energy)?energy:0;
  byDay.set(r.date,day);
 }
 const points=[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-15)
  .map(p=>({...p,ratio:p.kwh/p.km*100}));
 if(!points.length){
  chart.append(svgNode('text',{x:320,y:110,'text-anchor':'middle',fill:'#a9bfd0','font-size':15},'Nenhuma corrida com quilometragem registrada.'));
  $('effAverage').textContent='—';$('effCost').textContent='—';$('effKmKwh').textContent='—';
  return;
 }
 const ratios=points.map(p=>p.ratio);
 const lo=Math.max(0,Math.min(...ratios)-2),hi=Math.max(lo+4,Math.max(...ratios)+2);
 const x=i=>points.length===1?324:44+i*(561/(points.length-1));
 const y=v=>169-(v-lo)/(hi-lo)*130;
 for(let k=0;k<4;k++){
  const val=lo+(hi-lo)*k/3,cy=y(val);
  chart.append(svgNode('line',{x1:43,x2:605,y1:cy,y2:cy,stroke:'#31546a','stroke-width':1}));
  chart.append(svgNode('text',{x:2,y:cy+4,fill:'#9bb8ca','font-size':12},fmt(val)));
 }
 const step=Math.max(1,Math.ceil(points.length/6));
 points.forEach((p,i)=>{
  if(i%step!==0&&i!==points.length-1)return;
  chart.append(svgNode('text',{x:x(i),y:196,'text-anchor':'middle',fill:'#b9cfe0','font-size':12},p.date.slice(8)+'/'+p.date.slice(5,7)));
 });
 if(points.length>1)chart.append(svgNode('polyline',{
  points:points.map((p,i)=>`${x(i)},${y(p.ratio)}`).join(' '),
  fill:'none',stroke:'#4de0b0','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'
 }));
 points.forEach((p,i)=>{
  const marker=svgNode('circle',{cx:x(i),cy:y(p.ratio),r:4,fill:'#4de0b0',stroke:'#fff','stroke-width':1});
  marker.append(svgNode('title',{},`${p.date.split('-').reverse().join('/')} · ${fmt(p.ratio)} kWh/100 km`));
  chart.append(marker);
 });
 // Os cartões acompanham exatamente os dias exibidos no gráfico.
 const km=points.reduce((a,p)=>a+p.km,0),kwh=points.reduce((a,p)=>a+p.kwh,0),energy=points.reduce((a,p)=>a+p.energy,0);
 $('effAverage').textContent=km?fmt(kwh/km*100)+' kWh/100 km':'—';
 $('effCost').textContent=km?brl(energy/km)+'/km':'—';
 $('effKmKwh').textContent=kwh?fmt(km/kwh)+' km/kWh':'—';
}
function renderHome(){if(!$('homeRevenue'))return;const date=homeSelectedDate,day=homeTotals(date,date);$('homeDateCaption').textContent=(date===today()?'Hoje':'Dia selecionado')+' · '+date.split('-').reverse().join('/');$('homeRevenue').textContent=brl(day.rev);$('homeProfit').textContent=brl(day.profit);$('homeKm').textContent=fmt(day.km)+' km';$('homeKwh').textContent=fmt(day.kwh)+' kWh';$('homeTime').textContent=duration(day.hours);$('homeEnergyCost').textContent=brl(day.energy);$('homeGrossHour').textContent=day.hours>0?brl(day.rev/day.hours)+'/h':'—';$('homeGrossKm').textContent=day.km>0?brl(day.rev/day.km)+'/km':'—';$('homeHour').textContent=day.hours>0?brl(day.profit/day.hours)+'/h':'—';$('homeHour').style.color=day.hours>0?performanceHourColor(day.profit/day.hours):'';$('homePerKm').textContent=day.km>0?brl(day.profit/day.km)+'/km':'—';$('homePerKm').style.color=day.km>0?performanceColor(day.profit/day.km):'';
 const periods=homeWorkingPeriods(homePeriod),a=homeWorkingTotals(periods.current),b=homeWorkingTotals(periods.previous);
 const complete=periods.current.length===periods.n&&periods.previous.length===periods.n;
 $('cmpHour').textContent=a.hours?brl(a.profit/a.hours):'—';$('cmpHour').style.color=a.hours?performanceHourColor(a.profit/a.hours):'';
 $('cmpKm').textContent=a.km?brl(a.profit/a.km):'—';$('cmpKm').style.color=a.km?performanceColor(a.profit/a.km):'';
 $('cmpRevenue').textContent=brl(a.rev);
 if(complete){
  comparisonValue('cmpHourChange',a.hours?a.profit/a.hours:0,b.hours?b.profit/b.hours:0);
  comparisonValue('cmpKmChange',a.km?a.profit/a.km:0,b.km?b.profit/b.km:0);
  comparisonValue('cmpRevenueChange',a.rev,b.rev);
 }else{
  for(const id of ['cmpHourChange','cmpKmChange','cmpRevenueChange']){$(id).textContent='Sem base anterior completa';$(id).className='';}
 }
 $('cmpCaption').textContent=`${periods.current.length} de ${periods.n} dias com corridas (${briefDates(periods.current)}) × ${periods.previous.length} dias anteriores (${briefDates(periods.previous)}). Dias sem corridas não entram. ${complete?'Comparação entre períodos equivalentes.':'A variação será exibida quando houver dois períodos completos.'}`;
renderPerformance();renderEfficiency();renderHomeRecent()}
function homeChargeRows(){try{return window.BYDLocal?.get()?.records||[]}catch{return []}}
function renderHomeRecent(){const el=$('homeRecentList');if(!el)return;const type=$('homeRecentType').value,items=type==='ride'?state.rides:type==='expense'?state.expenses:homeChargeRows();el.replaceChildren();if(!ready){const p=document.createElement('p');p.className='hint';p.textContent='Conecte sua conta e aguarde a sincronização.';el.append(p);return}if(!items.length){const p=document.createElement('p');p.className='hint';p.textContent='Nenhum lançamento cadastrado nesta categoria.';el.append(p);return}
 const newest=type==='ride'?latestRideIds():new Set();
 for(const r of [...items].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8)){const line=document.createElement('div');line.className='home-recent-item';const detail=document.createElement('div'),head=document.createElement('b'),info=document.createElement('small'),actions=document.createElement('div');actions.className='home-recent-buttons';head.textContent=r.date.split('-').reverse().join('/')+' · '+(type==='ride'?'Corrida':type==='expense'?'Despesa':'Recarga');
 if(type==='ride')info.textContent=`${fmt(r.km)} km · ${fmt(kwhExibicao(r))} kWh · ${duration(r.hours)} · Uber ${earningsLabel(r.uber)} · 99 ${earningsLabel(r.n99)}${newest.has(r.id)?' · Faturamento do dia '+brl(revenueOfDate(r.date)):''}`;
 else if(type==='expense')info.textContent=`${r.category} · ${r.note||''} · ${brl(r.value)}`;
 else info.textContent=`${r.location||'Casa'} · ${fmt(r.kwh)} kWh · ${brl(r.kwh*r.tariff)}`;
 const edit=document.createElement('button');edit.textContent='✎ Editar';edit.className='secondary';edit.onclick=()=>openHomeEditor(type,r.id);const remove=document.createElement('button');remove.textContent='Excluir';remove.className='danger';remove.onclick=()=>deleteHomeRecord(type,r.id);actions.append(edit,remove);detail.append(head,info);line.append(detail,actions);el.append(line)}
}
function getHomeItem(type,id){const items=type==='ride'?state.rides:type==='expense'?state.expenses:homeChargeRows();return items.find(x=>x.id===id)}
function closeHomeEditor(){$('homeEditOverlay').hidden=true;editing=null;$('homeEditStatus').textContent=''}
function openHomeEditor(type,id){if(!ready)return alert('Aguarde a sincronização do Firebase.');const item=getHomeItem(type,id);if(!item)return alert('Lançamento não encontrado. Atualize a página.');editing={type,id,old:{...item}};$('homeEditHeading').textContent='Editar '+({ride:'corrida',expense:'despesa',charge:'recarga'}[type]);const fields=$('homeEditFields');fields.replaceChildren();for(const [key,label,kind]of homeFields[type]){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.name=key;input.type=kind==='date'?'date':kind==='number'?'text':'text';if(kind==='number')input.inputMode='decimal';const locked=type==='ride'&&key==='kwh'&&item.source==='Excel 2026'&&Number.isFinite(item.energyCostOverride);input.value=kind==='number'?(type==='ride'&&['uber','n99'].includes(key)&&item[key]==null?'':String(locked?kwhExibicao(item):item[key]??0).replace('.',',')):String(item[key]??'');input.readOnly=locked;input.required=true;wrap.append(input);fields.append(wrap)}$('homeEditStatus').textContent=type==='ride'&&item.source==='Excel 2026'&&Number.isFinite(item.energyCostOverride)?'O consumo histórico em kWh é estimado pelo custo original e não pode ser editado aqui.':'';$('homeEditOverlay').hidden=false;fields.querySelector('input')?.focus()}
async function deleteHomeRecord(type,id){if(!permitted())return;if(!confirm('Excluir definitivamente este lançamento?'))return;try{if(type==='charge'){if(!window.BYDCloud?.deleteRecord)throw Error('Recargas ainda não sincronizadas.');await window.BYDCloud.deleteRecord(id);renderHome();return}const k=type==='ride'?'rides':'expenses',before=state[k];state[k]=before.filter(r=>r.id!==id);if(!await save())state[k]=before;render()}catch(e){alert('Falha ao excluir: '+(e.message||e))}}
$('homeEditClose').onclick=closeHomeEditor;$('homeEditCancel').onclick=closeHomeEditor;
$('homeEditOverlay').addEventListener('click',e=>{if(e.target===$('homeEditOverlay'))closeHomeEditor()});
$('homeSelectedDate').value=homeSelectedDate;
$('homeSelectedDate').addEventListener('change',e=>{
 const next=e.target.value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(next))return;
 homeSelectedDate=next;
 renderHome();
});
$('homeTodayButton').addEventListener('click',()=>{homeSelectedDate=today();$('homeSelectedDate').value=homeSelectedDate;renderHome()});
$('homeRecentType').onchange=renderHomeRecent;
for(const button of document.querySelectorAll('[data-home-period]'))button.onclick=()=>{homePeriod=button.dataset.homePeriod;for(const b of document.querySelectorAll('[data-home-period]'))b.classList.toggle('selected',b===button);renderHome()};
$('homeEditForm').onsubmit=async e=>{e.preventDefault();if(!editing||!permitted())return;const{type,id,old}=editing;const updated={...old};for(const[key,,kind]of homeFields[type]){const input=$('homeEditForm').elements.namedItem(key);if(!input||input.readOnly)continue;updated[key]=kind==='number'?(input.value.trim()===''?NaN:num(input.value)):input.value.trim()}
 const nums=homeFields[type].filter(f=>f[2]==='number').map(f=>f[0]);if(!/^\d{4}-\d{2}-\d{2}$/.test(updated.date)||nums.some(k=>!safe(updated[k]))||(type==='expense'&&updated.value<=0)||(type==='charge'&&(updated.kwh<=0||updated.tariff<=0))){$('homeEditStatus').textContent='Verifique data e valores informados.';return}
 if(type==='ride'&&old.source==='Excel 2026'&&Number.isFinite(old.energyCostOverride))updated.kwh=old.kwh;
 const button=$('homeEditSubmit');button.disabled=true;$('homeEditStatus').textContent='Salvando no Firebase…';try{if(type==='charge'){if(!window.BYDCloud?.updateRecord)throw Error('Módulo de edição de recargas indisponível.');await window.BYDCloud.updateRecord(updated)}else{const key=type==='ride'?'rides':'expenses',idx=state[key].findIndex(x=>x.id===id);if(idx<0)throw Error('Lançamento não encontrado.');state[key][idx]=updated;if(!await save()){state[key][idx]=old;throw Error('O Firebase não confirmou a alteração.')}}closeHomeEditor();render();renderHome()}catch(err){$('homeEditStatus').textContent='Erro ao salvar: '+(err.message||err)}finally{button.disabled=false}};
window.BYDHomeRefresh=()=>renderHome();
$('logoutMain').onclick=async()=>{if(!confirm('Desconectar sua conta Google deste dispositivo?'))return;const {signOut}=await import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js');await signOut(auth)};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>show(b.dataset.tab);
function show(name){for(const s of document.querySelectorAll('main > section'))s.hidden=s.id!==name;for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===name);history.replaceState(null,'',location.pathname+'#'+name);if(name==='inicio')renderHome();window.scrollTo({top:0,left:0,behavior:'instant'})}const start=location.hash.slice(1);show(['inicio','corridas','recargas','resumo','ajustes','caixa'].includes(start)?start:'inicio');window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(['inicio','corridas','recargas','resumo','ajustes','caixa'].includes(h))show(h)});
$('rideForm').onsubmit=async e=>{e.preventDefault();if(!permitted())return;const r={id:newId(),createdAt:new Date().toISOString(),date:$('rideDate').value,hours:num($('rideHours').value),km:num($('rideKm').value),kwh:num($('rideKwh').value),liters:num($('rideLiters').value||0),uber:$('rideUber').value.trim()===''?NaN:num($('rideUber').value),n99:$('ride99').value.trim()===''?NaN:num($('ride99').value),tariff:state.settings.tariff,perKm:state.settings.perKm};if(!r.date||!['hours','km','kwh','liters'].every(k=>safe(r[k]))||!safe(r.uber)||!safe(r.n99))return alert('Informe todos os dados da corrida, incluindo Uber e 99 (digite 0 quando não houver ganhos).');state.rides.push(r);if(await save()){for(const id of ['rideHours','rideKm','rideKwh','rideUber','ride99'])$(id).value='';$('msg').textContent='Corrida salva na nuvem!'}else state.rides.pop();render()};
$('saveSettings').onclick=async()=>{if(!permitted())return;const next={tariff:num($('tariff').value),perKm:num($('perKm').value),fuelPrice:num($('fuelPrice').value)};if(!Object.values(next).every(safe)||next.tariff<=0)return alert('Valores inválidos.');const old=state.settings;state.settings=next;if(!await save())state.settings=old;render()};
function updatePeriod(){const m=$('periodMode').value;$('monthFilter').hidden=m!=='month';$('rangeFilter').hidden=m!=='range';$('yearFilter').hidden=m!=='year';render()}$('periodMode').onchange=updatePeriod;for(const id of ['filterMonth','dateFrom','dateTo','filterYear'])$(id).onchange=render;updatePeriod();
function dl(n,c,t){const u=URL.createObjectURL(new Blob([c],{type:t})),a=document.createElement('a');a.href=u;a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000)}
const unusedExportCSV=()=>{const rows=[['Data','Horas','Km','kWh','Litros','Uber','99','Outros ganhos','Bônus','Custo energia histórico'],...state.rides.map(r=>[r.date,r.hours,r.km,kwhExibicao(r),r.liters,r.uber,r.n99,r.other||0,r.bonus||0,r.energyCostOverride??''])];dl('corridas-byd.csv','\uFEFF'+rows.map(r=>r.join(';')).join('\r\n'),'text/csv;charset=utf-8')};

const fullRecargasRef=()=>doc(db,'usuarios',auth.currentUser.uid,'dados','estado');
$('exportAll').onclick=async()=>{
 if(!permitted())return;
 try{
  $('backupInfo').textContent='Preparando backup completo…';
  const snap=await getDoc(fullRecargasRef());
  const backup={type:'byd-king-full-backup-v1',exportedAt:new Date().toISOString(),corridas:{rides:state.rides,expenses:state.expenses,withdrawals:state.withdrawals||[],settings:state.settings},recargas:snap.exists()?snap.data():{records:[],tariff:1.185,closeDay:14,closings:{}}};
  dl('byd-king-backup-'+today()+'.json',JSON.stringify(backup,null,2),'application/json');
  $('backupInfo').textContent='Backup completo exportado. Guarde o arquivo em local seguro.';
 }catch(e){$('backupInfo').textContent='Falha ao exportar: '+e.message}
};
$('importAll').onclick=()=>{if(permitted())$('backupAllFile').click()};
$('backupAllFile').onchange=async e=>{
 const f=e.target.files?.[0];if(!f)return;
 try{
  if(f.size>8_000_000)throw Error('Arquivo muito grande');
  const backup=JSON.parse(await f.text());
  if(backup.type!=='byd-king-full-backup-v1'||!backup.corridas||!backup.recargas||!Array.isArray(backup.corridas.rides)||!Array.isArray(backup.corridas.expenses)||!Array.isArray(backup.recargas.records))throw Error('Formato de backup incompatível');
  const validEntries=(items)=>items.length<=30000&&items.every(x=>x&&typeof x.id==='string'&&x.id.length<150&&/^\d{4}-\d{2}-\d{2}$/.test(x.date));
  if(!validEntries(backup.corridas.rides)||!validEntries(backup.corridas.expenses)||!validEntries(backup.recargas.records))throw Error('Lançamentos inválidos');
  const snap=await getDoc(fullRecargasRef()),currentR=snap.exists()?snap.data():{records:[],tariff:1.185,closeDay:14,closings:{}};
  const merge=(current,incoming)=>{const ids=new Set(current.map(x=>x.id));return [...current,...incoming.filter(x=>!ids.has(x.id))]};
  const mergedR={...currentR,records:merge(currentR.records||[],backup.recargas.records)};
  const mergedC={...state,rides:merge(state.rides,backup.corridas.rides),expenses:merge(state.expenses,backup.corridas.expenses),withdrawals:merge(state.withdrawals||[],backup.corridas.withdrawals||[])};
  const addedR=mergedR.records.length-(currentR.records||[]).length,addedC=mergedC.rides.length-state.rides.length,addedE=mergedC.expenses.length-state.expenses.length;
  if(!confirm(`Importar ${addedC} corrida(s), ${addedE} despesa(s) e ${addedR} recarga(s)?\nRegistros existentes serão preservados. Configurações atuais não serão sobrescritas.`))return;
  $('backupInfo').textContent='Importando dados na nuvem…';
  await setDoc(fullRecargasRef(),mergedR);
  await setDoc(ref,{...mergedC,updatedAt:new Date().toISOString()});
  $('backupInfo').textContent='Importação concluída e sincronizada.';
 }catch(err){$('backupInfo').textContent='Erro na importação: '+err.message;alert('Não foi possível importar: '+err.message)}finally{e.target.value=''}
};
$('googleLogin').onclick=async()=>{try{await setPersistence(auth,browserLocalPersistence);await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){status('Erro de login: '+e.message)}};
onAuthStateChanged(auth,user=>{window.BYDAuthSession={resolved:true,user:user||null};window.dispatchEvent(new CustomEvent('byd-auth-change',{detail:{user:user||null}}));document.documentElement.classList.remove('byd-authenticated');ready=false;if(unsubscribe){unsubscribe();unsubscribe=null}state=initial();fields();render();if(!user){$('googleLogin').hidden=false;$('authStatus').textContent='Não conectado';status('Entre com Google para salvar corridas e movimentações do Caixa.');return} $('googleLogin').hidden=true;document.documentElement.classList.add('byd-authenticated');$('authStatus').textContent='Conectado: '+user.email;status('Carregando dados da nuvem…');ref=doc(db,'usuarios',user.uid,'dados','corridas');const account=user.uid,docRef=ref;
const applySnapshot=snap=>{if(auth.currentUser?.uid!==account)return;const data=snap.data();state=data?{rides:Array.isArray(data.rides)?data.rides:[],expenses:Array.isArray(data.expenses)?data.expenses:[],withdrawals:Array.isArray(data.withdrawals)?data.withdrawals:[],settings:data.settings||initial().settings}:initial();ready=true;fields();status('Sincronizado ✓');render()};
getDocFromServer(docRef).then(snap=>applySnapshot(snap)).catch(e=>{if(auth.currentUser?.uid===account&&!ready)status('Não foi possível carregar do servidor: '+e.message)});
unsubscribe=onSnapshot(docRef,{includeMetadataChanges:true},snap=>{if(snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;applySnapshot(snap)},e=>{if(auth.currentUser?.uid===account)status('Erro ao sincronizar: '+e.message)})},e=>{window.BYDAuthSession={resolved:true,user:null};window.dispatchEvent(new CustomEvent('byd-auth-change',{detail:{user:null}}));document.documentElement.classList.remove('byd-authenticated');$('authStatus').textContent='Falha na autenticação';status('Erro de autenticação: '+e.message)});
fields();render();window.addEventListener('load',()=>window.scrollTo(0,0));
