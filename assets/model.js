// Shared math engine + state · localStorage persistence
const MONTHS = ['Jul','Aug','Sep','Oct','Nov','Dec'];
const VERTICALS = ['hr','msp','acc','leg'];
const VLABELS = {hr:'HR / Recruiting',msp:'MSP / IT',acc:'Accounting',leg:'Legal'};
const VMIX = {hr:0.40,msp:0.20,acc:0.20,leg:0.20};

// Per-vertical lifts (master approximation flag — see Section 2.2)
const VERTICAL_LIFTS = {
  hr: {emRp:1.8,liReply:2.5,cycleDays:0.85},
  msp:{emRp:0.7,liReply:0.5,cycleDays:1.0},
  acc:{emRp:1.0,liReply:1.1,cycleDays:1.1},
  leg:{emRp:0.8,liReply:1.1,cycleDays:1.4}
};

const TIME_PER_TOUCH = {email:6,linkedin:12,warm:35,conference:240};
const ENG_THROUGHPUT = 1.75;
const ENG_HOURS_PER_DEAL = 50;
const PHASES_DEFAULT = 'phase0';

// Default drivers (persistable to localStorage)
const DEFAULTS = {
  karinaHrs:35,emTw:200,liTw:60,wmIn:4,cfEv:3,
  emRp:6,lusin:1,rm:30,mp:25,pc:60,
  hrFee:30,mspFee:28,accFee:22,legFee:60,rec:2.5,
  engN:2,engCost:12,sdrCost:4,tools:2,overhead:3.5,draw:5,
  scenario:'real'
};

const SCENARIOS = {
  bear: {karinaHrs:25,emTw:100,liTw:30,wmIn:2,cfEv:0,emRp:5,lusin:1,rm:25,mp:20,pc:50,hrFee:25,mspFee:22,accFee:18,legFee:45,rec:2,engN:1,engCost:11,sdrCost:4,tools:1.5,overhead:3,draw:3},
  real: {karinaHrs:35,emTw:200,liTw:60,wmIn:4,cfEv:3,emRp:6,lusin:1,rm:30,mp:25,pc:60,hrFee:30,mspFee:28,accFee:22,legFee:60,rec:2.5,engN:2,engCost:12,sdrCost:4,tools:2,overhead:3.5,draw:5},
  bull: {karinaHrs:40,emTw:300,liTw:80,wmIn:6,cfEv:5,emRp:6,lusin:5,rm:40,mp:35,pc:70,hrFee:42,mspFee:38,accFee:30,legFee:90,rec:4,engN:4,engCost:13,sdrCost:5,tools:3,overhead:4,draw:6}
};

let state = loadState();

function loadState(){
  try {
    const s = JSON.parse(localStorage.getItem('aiintegcom_state'));
    return Object.assign({},DEFAULTS,s||{});
  } catch(e){ return Object.assign({},DEFAULTS); }
}
function saveState(){ localStorage.setItem('aiintegcom_state',JSON.stringify(state)); }

function getInputs(){
  const d = {};
  for(const k in DEFAULTS) d[k] = state[k];
  // convert to USD where needed
  d.hrFee = d.hrFee*1000; d.mspFee = d.mspFee*1000; d.accFee = d.accFee*1000; d.legFee = d.legFee*1000;
  d.rec = d.rec*1000; d.engCost = d.engCost*1000; d.sdrCost = d.sdrCost*1000;
  d.tools = d.tools*1000; d.overhead = d.overhead*1000; d.draw = d.draw*1000;
  return d;
}

function karinaCapacity(d){
  const weekly = d.karinaHrs*60;
  const emailMin = d.emTw*TIME_PER_TOUCH.email;
  const liMin = d.liTw*TIME_PER_TOUCH.linkedin;
  const warmMin = (d.wmIn*TIME_PER_TOUCH.warm)/4.33;
  const confMin = (d.cfEv*TIME_PER_TOUCH.conference)/26;
  const used = emailMin+liMin+warmMin+confMin;
  return {weekly,used,emailMin,liMin,warmMin,confMin,pct:used/weekly};
}

function engineerCapacity(d){
  const monthlyCap = d.engN*ENG_THROUGHPUT;
  return {monthlyCap,periodCap:monthlyCap*6};
}

function cohortFunnel(d,vertical,overrideKey,overrideVal){
  const v = (k) => overrideKey===k ? overrideVal : d[k];
  const periodWeeks = 26;
  const dedup = 0.85;
  const verticalShare = vertical==='all' ? 1 : VMIX[vertical];
  const lifts = vertical==='all' ? {emRp:1,liReply:1,cycleDays:1} : VERTICAL_LIFTS[vertical];
  const emReplyEff = Math.min(50,v('emRp')*v('lusin')*lifts.emRp);
  const liReply = Math.min(60,30*lifts.liReply);
  const ramp = [0.5,0.8,1,1,1,1];
  const emAct = ramp.map(r => v('emTw')*4.33*r*verticalShare);
  const liAct = ramp.map(r => v('liTw')*4.33*r*verticalShare);
  const wmAct = ramp.map(r => v('wmIn')*verticalShare*r);
  const cfEv = v('cfEv');
  const cfAct = [0,cfEv/3,cfEv/3,0,cfEv/3,0].map(e => e*80*verticalShare);
  const cycleColdMo = (60*lifts.cycleDays)/30;
  const cycleWarmMo = (30*lifts.cycleDays)/30;
  const emConv = (emReplyEff/100)*(v('rm')/100)*(v('mp')/100)*(v('pc')/100);
  const liConv = (0.45)*(liReply/100)*(v('rm')/100)*(v('mp')/100)*(v('pc')/100);
  const wmConv = 0.80*0.50*0.75;
  const cfConv = 0.54*0.35*0.70;
  const closes = Array(6).fill(0).map(() => ({em:0,li:0,wm:0,cf:0,total:0}));
  for(let i=0;i<6;i++){
    const mEm = i+Math.round(cycleColdMo);
    const mLi = i+Math.round(cycleColdMo);
    const mWm = i+Math.round(cycleWarmMo);
    const mCf = i+Math.round(cycleWarmMo);
    if(mEm<6) closes[mEm].em += emAct[i]*emConv;
    if(mLi<6) closes[mLi].li += liAct[i]*liConv;
    if(mWm<6) closes[mWm].wm += wmAct[i]*wmConv;
    if(mCf<6) closes[mCf].cf += cfAct[i]*cfConv;
  }
  closes.forEach(c => {c.em*=dedup;c.li*=dedup;c.wm*=dedup;c.cf*=dedup;c.total=c.em+c.li+c.wm+c.cf});
  return {closes,emReplyEff,liReply};
}

function calcAll(d,overrideKey,overrideVal){
  const verticalData = {};
  VERTICALS.forEach(v => verticalData[v] = cohortFunnel(d,v,overrideKey,overrideVal));
  const preGate = Array(6).fill(0).map((_,i) => VERTICALS.reduce((s,v) => s+verticalData[v].closes[i].total,0));
  const engCap = (overrideKey==='engN' ? overrideVal : d.engN)*ENG_THROUGHPUT;
  const gated = preGate.map(c => Math.min(c,engCap));
  const verticalCloses = {};
  VERTICALS.forEach(v => verticalCloses[v] = Array(6).fill(0));
  for(let i=0;i<6;i++){
    const scale = preGate[i]>0 ? gated[i]/preGate[i] : 0;
    VERTICALS.forEach(v => verticalCloses[v][i] = verticalData[v].closes[i].total*scale);
  }
  const fees = {hr:d.hrFee,msp:d.mspFee,acc:d.accFee,leg:d.legFee};
  const monthly = Array(6).fill(0).map((_,i) => {
    const closes = gated[i];
    const l1Booked = VERTICALS.reduce((s,v) => s+verticalCloses[v][i]*fees[v],0);
    let l1Recognized = 0, l1Billed = 0;
    for(let j=0;j<=i;j++){
      const ma = i-j;
      const cj = gated[j];
      const af = cj>0 ? VERTICALS.reduce((s,v) => s+verticalCloses[v][j]*fees[v],0)/cj : 0;
      const recR = ma===0?0.3:ma===1?0.4:ma===2?0.3:0;
      const billR = ma===0?0.3:ma===1?0.4:ma===3?0.3:0;
      l1Recognized += cj*af*recR;
      l1Billed += cj*af*billR;
    }
    let l2Active = 0;
    for(let j=0;j<=i-2;j++){
      const ms = i-2-j;
      const ramp = ms===0?0.5:1;
      const ret = Math.pow(1-0.03,Math.max(0,ms));
      l2Active += gated[j]*ramp*ret;
    }
    const l2Recognized = l2Active*d.rec;
    const cogsPerDeal = ENG_HOURS_PER_DEAL*(d.engCost/160);
    const cogs = closes*cogsPerDeal;
    const confCost = (d.cfEv*24000)/6;
    const fixedCost = d.engN*d.engCost+d.sdrCost+d.overhead+d.draw;
    const revenue = l1Recognized+l2Recognized;
    const gm = revenue-cogs;
    const contribution = gm-confCost-d.tools;
    const ebitda = contribution-fixedCost;
    const cashIn = l1Billed+l2Recognized;
    const cashOut = cogs+confCost+d.tools+fixedCost;
    const cashFlow = cashIn-cashOut;
    return {month:MONTHS[i],closes,l1Booked,l1Recognized,l1Billed,l2Active,l2Recognized,
      revenue,cogs,confCost,fixedCost,gm,contribution,ebitda,cashIn,cashOut,cashFlow};
  });
  let cumE=0,cumC=0;
  monthly.forEach(m => {cumE+=m.ebitda;m.cumEbitda=cumE;cumC+=m.cashFlow;m.cumCash=cumC});
  return {monthly,verticalCloses,preGate,gated,engCap,verticalData};
}

function fmtFull(v){return(v<0?'-':'')+'$'+Math.abs(Math.round(v)).toLocaleString('en-US')}
function fmtK(v){const a=Math.abs(Math.round(v));return(v<0?'-':'')+'$'+(a>=1000?(a/1000).toFixed(0)+'K':a.toString())}
function fmtN(v,p){return v===0?'—':v.toFixed(p||1)}

// Calc CAC/LTV
function calcUnitEconomics(d,result){
  const totalCloses = result.monthly.reduce((s,m) => s+m.closes,0);
  const blendedAvgFee = VERTICALS.reduce((s,v) => s+VMIX[v]*({hr:d.hrFee,msp:d.mspFee,acc:d.accFee,leg:d.legFee}[v]),0);
  const lifetimeRev = 10000+blendedAvgFee+(d.rec*36*0.5);
  const ltv = lifetimeRev*0.55;
  const totalSDRCost = d.sdrCost*6;
  const totalToolsCost = d.tools*6;
  const totalConfCost = d.cfEv*24000;
  const totalCAC = totalCloses>0 ? (totalSDRCost+totalToolsCost+totalConfCost)/totalCloses : 0;
  const ratio = totalCAC>0 ? ltv/totalCAC : 0;
  const y1GM = blendedAvgFee*0.55;
  const monthlyGM = y1GM/12;
  const payback = monthlyGM>0 ? totalCAC/monthlyGM : 99;
  return {ltv,blendedCAC:totalCAC,ratio,payback,blendedAvgFee,totalCloses};
}

function updateHeaderKPIs(){
  const d = getInputs();
  const result = calcAll(d);
  const ue = calcUnitEconomics(d,result);
  const beE = result.monthly.findIndex(m => m.ebitda>=0);
  const beC = result.monthly.findIndex(m => m.cumCash>=0);
  document.getElementById('hkpi-ltv').textContent = fmtK(ue.ltv);
  document.getElementById('hkpi-cac').textContent = fmtK(ue.blendedCAC);
  document.getElementById('hkpi-ratio').textContent = ue.ratio.toFixed(1)+'×';
  document.getElementById('hkpi-be').textContent = beE>=0 ? MONTHS[beE] : '—';
  document.getElementById('hkpi-cbe').textContent = beC>=0 ? MONTHS[beC] : '—';
}

function initApex(){
  const d = getInputs();
  const result = calcAll(d);
  const ue = calcUnitEconomics(d,result);
  const beE = result.monthly.findIndex(m => m.ebitda>=0);
  const beC = result.monthly.findIndex(m => m.cumCash>=0);
  const karina = karinaCapacity(d);
  const eng = engineerCapacity(d);
  const totalCloses = result.monthly.reduce((s,m) => s+m.closes,0);
  const apexLtv = document.getElementById('apex-ltv'); if(apexLtv) apexLtv.textContent = fmtK(ue.ltv);
  const apexCac = document.getElementById('apex-cac'); if(apexCac) apexCac.textContent = fmtK(ue.blendedCAC);
  const apexRatio = document.getElementById('apex-ratio'); if(apexRatio) apexRatio.textContent = ue.ratio.toFixed(1)+'×';
  const apexPayback = document.getElementById('apex-payback'); if(apexPayback) apexPayback.textContent = '~'+ue.payback.toFixed(1)+' mo';
  const apexBe = document.getElementById('apex-be'); if(apexBe){apexBe.textContent = beE>=0?MONTHS[beE]:'None';apexBe.className='apex-val small '+(beE>=0&&beE<=3?'pos':beE>=0?'warn':'neg')}
  const apexCbe = document.getElementById('apex-cbe'); if(apexCbe){apexCbe.textContent = beC>=0?MONTHS[beC]:'None';apexCbe.className='apex-val small '+(beC>=0&&beC<=4?'pos':beC>=0?'warn':'neg')}
  const apexFu = document.getElementById('apex-futil'); if(apexFu){apexFu.textContent = (karina.pct*100).toFixed(0)+'%';apexFu.className='apex-val small '+(karina.pct<=0.85?'pos':karina.pct<=1?'warn':'neg')}
  const apexEu = document.getElementById('apex-eutil'); if(apexEu){const u=totalCloses/eng.periodCap;apexEu.textContent = (u*100).toFixed(0)+'%';apexEu.className='apex-val small '+(u<=0.85?'pos':u<=1?'warn':'neg')}
  updateHeaderKPIs();
}

function buildControlsPanel(targetSelector){
  const fields = [
    {group:'Outreach intensity',items:[
      ['karinaHrs','Karina hrs/wk','h',10,50,1],
      ['emTw','Cold email touches/wk','',0,500,10],
      ['liTw','LinkedIn touches/wk','',0,200,5],
      ['wmIn','Warm intros/month','',0,15,1],
      ['cfEv','Conferences in period','',0,8,1]
    ]},
    {group:'Quality & pricing',items:[
      ['emRp','Cold email reply %','%',1,30,0.5],
      ['lusin','Lusin signal lift','×',1,10,0.5],
      ['pc','Pilot → Close %','%',30,90,1],
      ['hrFee','HR fee ($K)','',15,60,1],
      ['mspFee','MSP fee ($K)','',15,50,1],
      ['accFee','Accounting fee ($K)','',15,40,1],
      ['legFee','Legal fee ($K)','',30,120,2],
      ['rec','Monthly retainer ($K)','',0,8,0.5]
    ]},
    {group:'Team',items:[
      ['engN','Engineers (FTE)','',1,6,1],
      ['engCost','Engineer cost $K/mo','',6,22,0.5],
      ['draw','Founder draw $K/mo','',0,20,1]
    ]}
  ];
  const html = `<h4>Drivers <button class="close-btn" onclick="closePanel()">×</button></h4>` +
    fields.map(g => `<div class="driver-block"><div class="lab">${g.group}</div>` +
      g.items.map(([k,n,suf,min,max,step]) => `
        <div class="slider-row">
          <div class="slider-head"><span class="slider-name">${n}</span><span class="slider-val" id="v-${k}">${state[k]}${suf}</span></div>
          <input type="range" min="${min}" max="${max}" step="${step}" value="${state[k]}" oninput="onDriver('${k}',this.value,'${suf}')">
        </div>`).join('') + `</div>`
    ).join('');
  const el = document.querySelector(targetSelector);
  if(el) el.innerHTML = html;
}

function onDriver(k,v,suf){
  state[k] = +v;
  const lab = document.getElementById('v-'+k); if(lab) lab.textContent = v+(suf||'');
  saveState();
  if(window.redrawCurrentPage) window.redrawCurrentPage();
  updateHeaderKPIs();
  if(document.getElementById('page-0').classList.contains('active')) initApex();
}

function closePanel(){
  document.querySelectorAll('.controls-panel').forEach(p => p.classList.remove('visible'));
}

function applyScenarioBundle(name,btn){
  state = Object.assign(state,SCENARIOS[name],{scenario:name});
  saveState();
  // Update all sliders
  Object.keys(SCENARIOS[name]).forEach(k => {
    const el = document.querySelector(`input[onchange*="${k}"], input[oninput*="${k}"]`);
    if(el) el.value = state[k];
    const lab = document.getElementById('v-'+k); if(lab) lab.textContent = state[k];
  });
  document.querySelectorAll('.scen-pill').forEach(p => p.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(window.redrawCurrentPage) window.redrawCurrentPage();
  updateHeaderKPIs();
  if(document.getElementById('page-0').classList.contains('active')) initApex();
}

// initPage callback after partial load
window.initPage = function(id){
  if(id==='3' && window.initHypothesis) initHypothesis();
  if(id==='4' && window.initScenarios) initScenarios();
  if(id==='5' && window.initControls) initControls();
  // Insert controls panel into body
  if(['3','4','5'].includes(id) && !document.querySelector('.controls-panel')){
    const div = document.createElement('div');
    div.className = 'controls-panel visible';
    document.body.appendChild(div);
    buildControlsPanel('.controls-panel');
  }
};
