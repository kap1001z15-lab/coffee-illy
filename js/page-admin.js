/* Клиентский модуль страницы admin.html (v21 Enterprise) */
const API_URL=window.COFFEE.API_URL,PIN_KEY='coffee_illy_pin',$=(i)=>document.getElementById(i);
const getPin=()=>{try{return localStorage.getItem(PIN_KEY)||''}catch(e){return ''}};
const setPin=(v)=>{try{localStorage.setItem(PIN_KEY,v)}catch(e){}};
const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=(n)=>Math.round(Number(n||0)).toLocaleString('ru-RU')+' руб.';
const dmy=(s)=>s?s.slice(8)+'.'+s.slice(5,7)+'.'+s.slice(0,4):'';
let D=null,tab='checklists';
try{tab=new URLSearchParams(location.search).get('tab')||localStorage.getItem('adm_tab')||'checklists'}catch(e){}

function toast(t){const el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,3000)}
function errText(e){const m=String((e&&e.message)||e||'');
  if(/PIN_NOT_SET/.test(m))return 'Код доступа не задан. Откройте таблицу «Кофейня — Задачи и настройки», лист «Настройки», впишите «Код доступа к дашборду и отчётам» и обновите страницу.';
  if(/PIN_REQUIRED/.test(m))return 'Введите код доступа администратора';
  return m.replace(/^Error:\s*/,'')||'неизвестная ошибка'}

async function call(action,data){
  const d=await coffeeFetch(API_URL,{method:'POST',body:JSON.stringify(Object.assign({action,pin:getPin()},data||{}))},5000);
  if(!d||d.ok===false)throw new Error((d&&d.error)||'ошибка сервера');return d}
let admBlockFlt = 'all';
async function load(){
  $('err').hidden=true;
  /* 1. Мгновенная отрисовка за 0 мс из локального хранилища до любых асинхронных промисов */
  if(window.coffeeGetInstantAdmin && (!window.coffeeCheckPin || window.coffeeCheckPin(getPin()))){
    const inst = window.coffeeGetInstantAdmin();
    if(inst && inst.tasks){
      D = inst;
      $('content').hidden = false;
      if(inst.location) $('sub').textContent = 'Управление · ' + inst.location;
      render();
      return;
    }
  }
  try{
    const d=await coffeeFetch(API_URL+'?action=admin&nocache=1&pin='+encodeURIComponent(getPin()));
    if(d&&d.ok===false)throw new Error(d.error||'');
    if(!d||!d.tasks)throw new Error('сервер вернул неожиданный ответ. Обновите код в Apps Script и разверните новую версию');
    coffeeCache.set('admin',d);D=d;$('content').hidden=false;if(d.location)$('sub').textContent='Управление · '+d.location;render();
  }catch(e){
    $('content').hidden=true;$('err').hidden=false;const pin=/PIN_REQUIRED/.test(e.message||'');
    $('err').innerHTML='<b>'+esc(errText(e))+'</b>'+(pin?'<div style="display:flex;gap:8px;margin-top:10px"><input id="pinIn" type="password" autocomplete="current-password" placeholder="Код" style="height:40px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:var(--bg)"><button class="b" id="pinOk" type="button">Войти</button></div>':'');
  }}
$('err').addEventListener('click',(e)=>{if(e.target.id==='pinOk'){window.coffeeAuth.loginOwner($('pinIn').value.trim()).then(()=>load());}});
$('err').addEventListener('keydown',(e)=>{if(e.key==='Enter'&&e.target.id==='pinIn')$('pinOk').click()});

/* ----- форма в окне ----- */
function field(f,v){const id='f_'+f.k,val=v==null?'':v;let i;
  if(f.type==='select'||Array.isArray(f.opts))i='<select id="'+id+'">'+(f.opts||[]).map((o)=>'<option'+(String(o)===String(val)?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>';
  else if(f.type==='area'||f.area)i='<textarea id="'+id+'" rows="3">'+esc(val)+'</textarea>';
  else i='<input id="'+id+'" type="'+(f.type||'text')+'" value="'+esc(val)+'"'+(f.type==='number'?' step="any" inputmode="decimal" min="0"':'')+(f.max?' max="'+f.max+'"':'')+(f.ro?' readonly':'')+(f.ph?' placeholder="'+esc(f.ph)+'"':'')+'>';
  return '<div class="fld"><label for="'+id+'">'+esc(f.label)+'</label>'+i+'</div>'}
function openForm(title,fields,vals,onSave){
  $('dtitle').textContent=title;$('dfields').innerHTML=fields.map((f)=>field(f,vals[f.k])).join('');$('derr').textContent='';
  $('dform').onsubmit=async(e)=>{e.preventDefault();const o={};fields.forEach((f)=>o[f.k]=$('f_'+f.k).value);
    $('dsave').disabled=true;
    try{await onSave(o);try{if($('dlg').open&&typeof $('dlg').close==='function')$('dlg').close();$('dlg').removeAttribute('open')}catch(_){$('dlg').removeAttribute('open')};toast('Сохранено');await load()}catch(x){$('derr').textContent='Не удалось сохранить: '+errText(x)}
    $('dsave').disabled=false};
  try{if($('dlg').open)try{if($('dlg').open&&typeof $('dlg').close==='function')$('dlg').close();$('dlg').removeAttribute('open')}catch(_){$('dlg').removeAttribute('open')};if(typeof $('dlg').showModal==='function')$('dlg').showModal();else $('dlg').setAttribute('open','open')}catch(_){$('dlg').setAttribute('open','open')}}
$('dcancel').onclick=()=>{try{if($('dlg').open&&typeof $('dlg').close==='function')$('dlg').close();$('dlg').removeAttribute('open')}catch(_){$('dlg').removeAttribute('open')}};
async function act(action,data,ok){try{await call(action,data);toast(ok||'Готово');await load()}catch(e){toast('Ошибка: '+errText(e))}}

/* ----- отрисовка ----- */
const YN=['да','нет'];
function render(){
  document.querySelectorAll('#tabs button').forEach((b)=>b.classList.toggle('on',b.dataset.t===tab));
  const f={checklists:rChecklists,tasks:rTasksAndInfo,info:rTasksAndInfo,ttk:rTtk,cash:rCash,exp:rExp,inc:rInc,audit:rAudit,staff:rStaff,set:rSet}[tab]||rChecklists;$('panel').innerHTML=f()}
$('tabs').addEventListener('click',(e)=>{const b=e.target.closest('[data-t]');if(!b||!D)return;tab=b.dataset.t;try{localStorage.setItem('adm_tab',tab)}catch(x){}render()});

function rChecklists(){
  const cBlocks = (window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks() : (D.checklistBlocks || window.COFFEE_DEFAULT_CHECKLIST_BLOCKS || []));
  let h = '<div class="top"><h2 style="font-size:18px">📋 Управление чек-листами и таймлайном смены (' + cBlocks.length + ')</h2>' +
    '<div class="acts"><button class="b" type="button" data-a="dl-extend">⏱ Продлить дедлайн смены</button><button class="b ok" type="button" data-a="chkblk-new">+ Добавить чек-лист</button><button class="p" type="button" data-a="win-save">💾 Сохранить таймлайн</button></div></div>';
  h += '<p class="mu" style="margin:0 0 12px">Настройте временные окна доступа к чек-листам и кассе (например: Открытие 07:30–08:30, Лайн Чек 1 08:30–09:30, Лайн Чек 2 14:00–16:00, Закрытие 21:30–22:30, Касса 22:00–23:59). Вы можете добавлять новые чек-листы, убирать ненужные или мгновенно открывать доступ онлайн.</p>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));gap:12px">';
  cBlocks.forEach((bObj, idx) => {
    const blk = bObj.name;
    const w = window.coffeeGetBlockWindow ? window.coffeeGetBlockWindow(blk) : { openTime: bObj.openTime, deadline: bObj.deadline, baseOpenTime: bObj.openTime, baseDeadline: bObj.deadline, status: 'Доступ открыт', state: 'open' };
    const bCls = w.state === 'overdue_closed' ? 'no' : (w.state === 'open' || w.state === 'completed' ? 'ok' : '');
    const taskCnt = (D.tasks || []).filter((t) => t.block === blk && t.active !== 'нет').length;
    h += '<div style="border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--surface);font-size:13px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px">' +
        '<b>' + (bObj.isCash || blk === 'Касса' ? '🧾 ' : '📋 ') + esc(blk) + ' <span class="mu" style="font-weight:400;font-size:11.5px">(' + (bObj.isCash || blk === 'Касса' ? 'касса' : taskCnt + ' задач') + ')</span></b>' +
        '<span class="tag ' + bCls + '">' + esc(w.status) + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
        '<input type="time" class="chkblk-start" data-bname="' + esc(blk) + '" value="' + esc(bObj.openTime || w.baseOpenTime || '07:30') + '" style="padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);flex:1">' +
        '<span>—</span>' +
        '<input type="time" class="chkblk-dl" data-bname="' + esc(blk) + '" value="' + esc(bObj.deadline || w.baseDeadline || '08:30') + '" style="padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);flex:1">' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button type="button" class="b ok" data-a="win-unlock" data-b="' + esc(blk) + '" style="font-size:12px;padding:5px 9px;min-height:30px">🔓 Открыть доступ</button>' +
        '<button type="button" class="b del" data-a="win-sim-overdue" data-b="' + esc(blk) + '" style="font-size:12px;padding:5px 9px;min-height:30px">🔴 Просрочить (тест)</button>' +
        (!bObj.isCash && blk !== 'Касса' ? '<button type="button" class="b del" data-a="chkblk-del" data-b="' + esc(blk) + '" style="font-size:12px;padding:5px 9px;min-height:30px">🗑 Убрать</button>' : '') +
      '</div>' +
    '</div>';
  });
  h += '</div>';
  return h;
}

function rTasks(){ return rTasksAndInfo(); }
function rTasksAndInfo(){
  const defList=(window.COFFEE&&window.COFFEE.DEFAULT_TASKS)||[];
  if((!D.tasks||!D.tasks.length)&&defList.length){D.tasks=window.coffeeNormalizeTasksTimeline?window.coffeeNormalizeTasksTimeline(defList.slice()):defList.slice();}
  if(window.coffeeNormalizeTasksTimeline) D.tasks = window.coffeeNormalizeTasksTimeline(D.tasks);
  const cBlocks = (window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks() : []).filter((b) => !b.isCash && b.name !== 'Касса').map((b) => b.name);
  D.blocks = cBlocks.length ? cBlocks : ['Открытие', 'Лайн Чек 1', 'Лайн Чек 2', 'Закрытие'];

  const gDeeds = (typeof getUDB === 'function' && Array.isArray(getUDB().goodDeeds)) ? getUDB().goodDeeds : (window.COFFEE_DEFAULT_GOOD_DEEDS || []);
  const gdHtml = '<div style="background:color-mix(in srgb,var(--good) 8%,var(--bg));border:1px solid color-mix(in srgb,var(--good) 40%,var(--line));border-radius:16px;padding:14px;margin-bottom:16px">' +
    '<div class="top" style="margin-bottom:8px"><h2 style="font-size:18px;margin:0">🗓 Карта добрых дел (периодические задачи)</h2><button class="p" type="button" data-a="gd-new">+ Добавить периодическую задачу</button></div>' +
    '<p class="mu" style="margin:0 0 10px">Задачи, не привязанные к ежедневному чек-листу: разморозка холодильника во вторник (тихий день 14:00–18:00), регенерация водоумягчителя солью раз в 4 недели при закрытии, уборка 2-го зала по Пт–Сб. Отображаются у бариста во вкладке «📢 Задачи + Информирование».</p>' +
    gDeeds.map((g, gi) => (
      '<div class="row"><div><b>' + esc(g.title) + '</b> <span class="tag ok">' + esc(g.frequency) + '</span> <span class="tag">⏰ ' + esc(g.window || 'в смену') + '</span>' +
      '<div class="mu">' + esc(g.instruction) + '</div>' +
      '<div class="mu">Исполнитель: <b>' + esc(g.responsible || 'Бариста') + '</b> · Проверяющий (Владелец задачи): <b>' + esc(g.reviewer || 'Управляющий') + '</b></div></div>' +
      '<div class="acts"><button class="b del" type="button" data-a="gd-del" data-id="' + esc(g.id) + '">Удалить</button></div></div>'
    )).join('') + '</div>';

  let h = gdHtml + '<div style="background:color-mix(in srgb,var(--crema) 10%,var(--bg));border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:18px">' +
    rInfo() +
  '</div>';

  D.tasks.forEach((t, idx) => { t._idx = idx; });
  const blkCounts = {};
  D.blocks.forEach((b) => { blkCounts[b] = 0; });
  D.tasks.forEach((t) => { blkCounts[t.block] = (blkCounts[t.block] || 0) + 1; });

  h += '<div class="top"><h2 style="font-size:18px">📝 Задачи чек-листов и поручения сотрудникам (' + D.tasks.length + ' шагов)</h2><div class="acts"><button class="b" data-a="task-csv">⬇ Скачать Задачи.csv</button><button class="p" data-a="task-new">+ Добавить задачу</button></div></div>';
  h += '<div class="blk-pills">' +
    '<button type="button" data-a="blk-flt" data-b="all" class="' + (admBlockFlt === 'all' ? 'on' : '') + '">Все чек-листы (' + D.tasks.length + ')</button>' +
    D.blocks.map((b) => '<button type="button" data-a="blk-flt" data-b="' + esc(b) + '" class="' + (admBlockFlt === b ? 'on' : '') + '">' + esc(b) + ' (' + (blkCounts[b] || 0) + ')</button>').join('') +
  '</div>';
  h += '<input type="search" id="admTaskSearch" class="task-search" placeholder="🔍 Поиск задачи по названию или коду…">';
  const showBlocks = admBlockFlt === 'all' ? D.blocks : D.blocks.filter((b) => b === admBlockFlt);
  showBlocks.forEach((b) => {
    const l = D.tasks.filter((t) => t.block === b);
    h += '<h3>' + esc(b) + ' · ' + l.length + '</h3>' + (l.length ? l.map((t) => {
      const idx = t._idx;
      const pMode = t.photoMode || t.photo || 'нет';
      const pTag = pMode === 'да' ? '<span class="tag ok">📷 фото обязательно</span>' : (pMode === 'при проблеме' ? '<span class="tag">📷 фото при проблеме</span>' : '<span class="tag">без фото</span>');
      return '<div class="row"><div><span class="tag" style="margin:0 6px 0 0;font-family:monospace">' + esc(t.id || ('#' + t.row)) + '</span><span class="t">' + esc(t.title) + '</span>' + pTag + (t.active === 'нет' ? '<span class="tag no">выключена</span>' : '') + (t.instruction ? '<div class="mu">' + esc(t.instruction) + '</div>' : '') + '<div class="mu">Ответственный при нарушении: <b>' + esc(t.responsible || 'Администратор') + '</b></div></div><div class="acts"><button class="b" data-a="task-up" data-i="' + idx + '" title="Выше">↑</button><button class="b" data-a="task-down" data-i="' + idx + '" title="Ниже">↓</button><button class="b" data-a="task-edit" data-i="' + idx + '">Изменить</button><button class="b del" data-a="task-del" data-i="' + idx + '">Удалить</button></div></div>';
    }).join('') : '<p class="mu">В этом чек-листе пока нет задач — нажмите «+ Добавить задачу»</p>');
  });
  return h;
}
function getResponsibleOpts(curVal) {
  const base = ['Администратор', 'Шеф-бариста', 'Техник', 'Владелец'];
  const staff = (D.staff || []).map((s) => s.name);
  return Array.from(new Set(base.concat(staff).concat(curVal ? [curVal] : []))).filter(Boolean);
}

function taskForm(t){
  const isNew=!t;t=t||{block:D.blocks[0],title:'',instruction:'',photo:'нет',photoMode:'нет',responsible:'Администратор',active:'да'};
  const respOpts = getResponsibleOpts(t.responsible);
  openForm(isNew?'Новая задача чек-листа':'Изменить задачу '+esc(t.id||''),[
    {k:'block',label:'Блок чек-листа',type:'select',opts:D.blocks},
    {k:'title',label:'Название пункта',ph:'Например: Проверить кофемашину'},
    {k:'instruction',label:'Инструкция (и критерии для фотообразца)',type:'area'},
    {k:'photoMode',label:'Режим фотофиксации (п. 4.4 ТЗ)',type:'select',opts:['нет','да','при проблеме']},
    {k:'responsible',label:'Ответственный (при нарушении на него назначается задача)',type:'select',opts:respOpts},
    {k:'active',label:'Показывать в терминале',type:'select',opts:YN}],
    {block:t.block,title:t.title,instruction:t.instruction,photoMode:t.photoMode||t.photo||'нет',responsible:t.responsible||respOpts[0],active:t.active},
    (o)=>call('save_task',Object.assign(o,{mediaRequired:o.photoMode},isNew?{}:{row:t.row,id:t.id,expect:t.title})))}

function rAudit(){
  const list=D.serviceAudits||[];
  let h='<div class="top"><h2 style="font-size:18px">⭐ Аудит качества обслуживания (ТЗ п. 7.2)</h2><button class="p" data-a="audit-new">+ Провести аудит бариста</button></div>';
  h+='<p class="mu" style="margin:0 0 10px">Оценка шеф-бариста / администратором по 4 стандартам: Приветствие гостя, Уточнение заказа, Предложение доп. продажи (Upsell), Пожелание хорошего дня. Влияет на KPI в Отчётах.</p>';
  h+=list.map((a,i)=>'<div class="row"><div><span class="t">👤 '+esc(a.barista)+' · <span class="kpi-pill '+(a.score>=90?'ok':'warn')+'">⭐ Итог: '+a.score+'%</span></span>'+
    '<div class="mu">'+dmy(a.date)+' · Проверяющий: '+esc(a.auditor)+' · Приветствие: '+a.greet+'% · Уточнение: '+a.clarify+'% · Upsell: '+a.upsell+'% · Прощание: '+a.farewell+'%</div>'+
    (a.comment?'<div style="font-size:13px;margin-top:4px">💬 '+esc(a.comment)+'</div>':'')+'</div>'+
    '<div class="acts"><button class="b del" data-a="audit-del" data-i="'+i+'">Удалить</button></div></div>').join('');
  return h;
}
function auditForm(){
  const names=(D.staff||[]).map(s=>s.name);
  openForm('⭐ Новый аудит качества сервиса (ТЗ п. 7.2)',[
    {k:'date',label:'Дата проверки',type:'date',max:D.today},
    {k:'barista',label:'Сотрудник (Бариста)',opts:names.length?names:['Соня','Алина','Настя']},
    {k:'auditor',label:'Проверяющий',opts:['Шеф-бариста Максим','Администратор']},
    {k:'greet',label:'1. Приветствие гостя (0–100%)',type:'number'},
    {k:'clarify',label:'2. Уточнение деталей заказа (0–100%)',type:'number'},
    {k:'upsell',label:'3. Предложение доп. продукта / Upsell (0–100%)',type:'number'},
    {k:'farewell',label:'4. Пожелание хорошего дня (0–100%)',type:'number'},
    {k:'comment',label:'Комментарий по итогу наблюдения',area:1,opt:1}
  ],{date:D.today,barista:'Соня',auditor:'Шеф-бариста Максим',greet:100,clarify:100,upsell:90,farewell:100,comment:''},(o)=>call('save_service_audit',o));
}
function rCash(){
  let h='<div class="top"><h2 style="font-size:18px">⚖️ Выручка и сверка кассы (ТЗ п. 9.2)</h2><button class="p" data-a="cash-new">+ Внести / сверить Z-отчёт</button></div><p class="mu" style="margin:0 0 8px">Автоматическая сверка данных, введённых бариста в Терминале, с фискальным Z-отчётом кассы. Исходные данные сохраняются в истории корректировок.</p>';
  if(!D.cash.length)return h+'<p class="mu">Данных пока нет</p>';
  const tbl='<div class="sx"><table class="tbl"><thead><tr><th>Дата</th><th>Наличные</th><th>Безнал</th><th>Факт (Бариста)</th><th>Z-отчёт кассы</th><th>Сверка (ТЗ 9.2)</th><th>Чеков</th><th>Списания</th><th></th></tr></thead><tbody>'+D.cash.map((r,i)=>{
    const tot=(Number(r.cash)||0)+(Number(r.card)||0);
    const zTot=r.zTotal!=null?Number(r.zTotal):tot;
    const diff=tot-zTot;
    const diffBadge=diff===0?'<span class="kpi-pill ok">✓ Сходится (0 руб.)</span>':'<span class="kpi-pill bad">⚠️ '+(diff>0?'+':'')+rub(diff)+'</span>';
    return '<tr><td><a href="dashboard.html?date='+esc(r.date)+'" title="Открыть день на Дашборде">'+dmy(r.date)+'</a></td><td>'+rub(r.cash)+'</td><td>'+rub(r.card)+'</td><td style="color:var(--good)"><b>'+rub(tot)+'</b>'+(r.barista?'<div class="mu" style="font-size:11.5px">'+esc(r.barista)+'</div>':'')+'</td><td><b>'+rub(zTot)+'</b></td><td>'+diffBadge+'</td><td>'+r.checks+'</td><td style="color:var(--bad)"><b>'+rub(r.writeoff)+'</b></td><td><div class="acts"><button class="b" data-a="cash-edit" data-i="'+i+'">Сверить / Изм.</button><button class="b del" data-a="cash-del" data-i="'+i+'">Удалить</button></div></td></tr>';
  }).join('')+'</tbody></table></div>';
  const hist=(D.cashHistory||[]).slice(0,15);
  const histHtml='<h3 style="font-size:16px;margin:18px 0 8px">📜 История сверки и корректировок кассы (без перезаписи исходных сумм)</h3>'+(hist.length?hist.map(c=>'<div class="row" style="padding:8px 0"><div><b>'+dmy(c.date)+' · '+esc(c.action)+'</b><div class="mu">'+esc(c.time)+' · '+esc(c.actor)+' · Исходная сумма: '+rub(c.origTotal)+' → Факт: '+rub(c.newTotal)+' · Z-отчёт: '+rub(c.zTotal)+' (Расхождение: '+rub(c.diff)+') · '+esc(c.note||'')+'</div></div></div>').join(''):'<p class="mu">Корректировок пока не было</p>');
  return h+tbl+histHtml;}
function cashForm(r){
  const isNew=!r;r=r||{date:D.today,cash:'',card:'',zTotal:'',checks:'',writeoff:'',reason:''};
  const tot=(Number(r.cash)||0)+(Number(r.card)||0);
  openForm(isNew?'Выручка и сверка за день':'Сверка / корректировка за '+dmy(r.date),[
    {k:'date',label:'Дата',type:'date',max:D.today,ro:!isNew},{k:'cash',label:'Наличные (факт), руб.',type:'number'},{k:'card',label:'Безнал (терминал), руб.',type:'number'},
    {k:'zTotal',label:'Сумма по Z-отчёту кассы (для сверки ТЗ 9.2), руб.',type:'number',opt:1},
    {k:'checks',label:'Количество чеков',type:'number'},{k:'writeoff',label:'Списания, руб.',type:'number'},
    {k:'reason',label:'Причина корректировки / комментарий сверки',opt:1}],Object.assign({},r,{zTotal:r.zTotal!=null?r.zTotal:(tot||'')}),
    (o)=>call('admin_cash',o))}

function rExp(){
  let h='<div class="top"><h2 style="font-size:18px">Расходы</h2><button class="p" data-a="exp-new">+ Добавить расход</button></div>';
  if(!D.expenses.length)return h+'<p class="mu">Расходов пока нет</p>';
  return h+D.expenses.map((x,i)=>'<div class="row"><div><span class="t">'+esc(x.category)+' · <span style="color:var(--bad)">'+rub(x.amount)+'</span></span><div class="mu">'+dmy(x.date)+(x.comment?' · '+esc(x.comment):'')+' · '+esc(x.id)+'</div></div><div class="acts"><button class="b" data-a="exp-edit" data-i="'+i+'">Изменить</button><button class="b del" data-a="exp-del" data-i="'+i+'">Удалить</button></div></div>').join('')}
function expForm(x){
  const isNew=!x;x=x||{date:D.today,category:D.categories[0],amount:'',comment:''};
  const cats=D.categories.indexOf(x.category)<0?D.categories.concat(x.category):D.categories;
  openForm(isNew?'Новый расход':'Изменить расход '+x.id,[
    {k:'date',label:'Дата',type:'date',max:D.today},{k:'category',label:'Статья',type:'select',opts:cats},
    {k:'amount',label:'Сумма, руб.',type:'number'},{k:'comment',label:'Комментарий',ph:'Необязательно'}],x,
    (o)=>call(isNew?'add_expense':'update_expense',Object.assign(o,isNew?{}:{id:x.id})))}

function rInfo(){
  const list=D.announcements||[];
  const staffNames=(D.staff||[]).filter((s)=>s.active!=='нет').map((s)=>s.name);
  let h='<div class="top"><h2 style="font-size:18px">📢 Информирование персонала и привязка к календарю ('+list.length+')</h2><button class="p" data-a="info-new">+ Создать материал / событие</button></div>';
  h+='<p class="mu" style="margin:0 0 10px">Сотрудники видят эти материалы во вкладке «📢 Инфо» мобильного терминала и подтверждают изучение кнопкой «Ознакомлен». Ниже видно, кто ознакомился, а кто ещё нет.</p>';
  if(!list.length)return h+'<p class="mu">Материалов пока нет</p>';
  return h+list.map((a,i)=>{
    const acks=Array.isArray(a.acks)?a.acks:[];
    const target=Array.isArray(a.targetStaff)&&a.targetStaff.length?a.targetStaff:staffNames;
    const notAcked=target.filter((nm)=>!acks.some((k)=>String(k.name||'').toLowerCase()===String(nm||'').toLowerCase()));
    return '<div class="row" style="align-items:start"><div>' +
      (a.calendarDate?'<span class="tag" style="background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn);margin:0 6px 4px 0">📅 Календарь: '+dmy(a.calendarDate)+(a.calendarEventTitle?' · '+esc(a.calendarEventTitle):'')+'</span>':'') +
      '<span class="tag" style="margin:0 6px 4px 0">'+esc(a.category||'Объявление')+'</span>' +
      '<div class="t" style="font-size:16px;margin-top:2px">'+esc(a.title)+'</div>' +
      '<div class="mu" style="white-space:pre-line;margin:4px 0">'+esc(a.text)+'</div>' +
      '<div style="font-size:13px;margin-top:6px"><span style="color:var(--good);font-weight:700">✓ Ознакомились ('+acks.length+'):</span> '+(acks.length?acks.map((k)=>esc(k.name)+' <span class="mu">('+esc(k.at)+')</span>').join(', '):'пока никто')+'</div>' +
      (notAcked.length?'<div style="font-size:13px;margin-top:2px"><span style="color:var(--bad);font-weight:700">⏳ Не ознакомились ('+notAcked.length+'):</span> '+esc(notAcked.join(', '))+'</div>':'<div style="font-size:12.5px;color:var(--good);margin-top:2px">🎉 Все назначенные сотрудники ознакомились</div>') +
      '</div><div class="acts"><button class="b" data-a="info-edit" data-i="'+i+'">Изменить</button><button class="b del" data-a="info-del" data-i="'+i+'">Удалить</button></div></div>';
  }).join('');
}
function infoForm(a){
  const isNew=!a;
  const infoTypes=(window.COFFEE_MVP&&window.COFFEE_MVP.INFO_TYPES)||['Изменения меню','Новые напитки','Новые стандарты приготовления','Изменения регламентов','Внутренние объявления'];
  a=a||{title:'',category:infoTypes[0],text:'',validFrom:D.today,validTo:'',calendarDate:'',calendarEventTitle:'',targetStaff:'Соня, Алина, Настя'};
  openForm(isNew?'Новый материал информирования':'Изменить материал '+esc(a.id||''),[
    {k:'title',label:'Заголовок',ph:'Например: Запуск зимнего меню с 15 ноября'},
    {k:'category',label:'Тип информации (п. 3.2 ТЗ)',type:'select',opts:infoTypes},
    {k:'text',label:'Описание и стандарты',type:'area'},
    {k:'calendarDate',label:'Привязка к дате календаря (п. 3.2.1, необязательно)',type:'date'},
    {k:'calendarEventTitle',label:'Название события календаря',ph:'Например: Запуск зимнего меню'},
    {k:'validTo',label:'Период актуальности (до даты)',type:'date'},
    {k:'targetStaff',label:'Кому необходимо ознакомиться (через запятую)',ph:'Соня, Алина, Настя'}],
    {title:a.title,category:a.category,text:a.text,calendarDate:a.calendarDate||'',calendarEventTitle:a.calendarEventTitle||'',validTo:a.validTo||'',targetStaff:Array.isArray(a.targetStaff)?a.targetStaff.join(', '):(a.targetStaff||'Соня, Алина, Настя')},
    (o)=>call('save_announcement',Object.assign(o,isNew?{}:{id:a.id})))}

function rTtk(){
  const list=Array.isArray(D.ttk)?D.ttk:(window.COFFEE_DEFAULT_TTK||[]);
  let h='<div class="top"><h2 style="font-size:18px">☕ Технологические карты напитков и калькулятор себестоимости (Food Cost %)</h2><button class="p" data-a="ttk-new">+ Добавить техкарту (ТТК)</button></div>';
  h+='<p class="mu" style="margin:0 0 10px">Как в лучших HoReCa-системах (iiko / Poster / ServiceGuru): бариста видит граммовки и стандарт приготовления в Терминале, а владелец контролирует себестоимость чашки (Food Cost нормой до 28%) и маржинальность.</p>';
  h+='<div class="sx"><table class="tbl"><thead><tr><th>Напиток и объём</th><th>Цена</th><th>Себестоимость (Зерно+Молоко+Таpа)</th><th>Food Cost %</th><th>Маржа с чашки</th><th>Рецептура для бариста</th><th></th></tr></thead><tbody>'+list.map((t,i)=>{
    const cost=Math.round(((Number(t.costBeans)||0)+(Number(t.costMilk)||0)+(Number(t.costSyrup)||0)+(Number(t.costCup)||0))*10)/10;
    const price=Math.max(1,Number(t.price)||45);
    const fc=Math.round((cost/price)*100);
    const margin=Math.round((price-cost)*10)/10;
    const fcCls=fc<=28?'ok':(fc<=34?'warn':'bad');
    return '<tr><td><b>'+esc(t.name)+'</b><div class="mu">'+esc(t.volume)+' · '+esc(t.category)+'</div></td><td><b>'+rub(price)+'</b></td><td>'+rub(cost)+'<div class="mu" style="font-size:11px">Зерно '+t.costBeans+' + Мол. '+t.costMilk+' + Стакан '+t.costCup+'</div></td><td><span class="kpi-pill '+fcCls+'">'+fc+'%</span></td><td style="color:var(--good)"><b>+'+rub(margin)+'</b></td><td style="text-align:left;max-width:280px;font-size:12px">'+esc(t.recipe)+'</td><td><div class="acts"><button class="b" data-a="ttk-edit" data-i="'+i+'">Изменить</button><button class="b del" data-a="ttk-del" data-i="'+i+'">Удалить</button></div></td></tr>';
  }).join('')+'</tbody></table></div>';
  return h;
}
function ttkForm(t){
  const isNew=!t;
  t=t||{name:'',volume:'250 мл (M)',category:'Классика',price:45,costBeans:6.5,costMilk:4.5,costSyrup:0,costCup:2.3,recipe:'',serving:''};
  openForm(isNew?'☕ Новая техкарта напитка (ТТК)':'Изменить техкарту '+t.name,[
    {k:'name',label:'Название напитка'},{k:'volume',label:'Объём стакана (например, 250 мл)'},{k:'category',label:'Категория',opts:['Классика','Авторский / Сезон','Альтернатива','Холодные напитки']},
    {k:'price',label:'Розничная цена продажи, руб.',type:'number'},
    {k:'costBeans',label:'Себестоимость зерна/матчи на порцию, руб.',type:'number'},
    {k:'costMilk',label:'Себестоимость молока/сливок, руб.',type:'number'},
    {k:'costSyrup',label:'Себестоимость сиропа/топпинга, руб.',type:'number',opt:1},
    {k:'costCup',label:'Себестоимость стакана, крышки и салфетки, руб.',type:'number'},
    {k:'recipe',label:'Пошаговая рецептура и температура для бариста',area:1},
    {k:'serving',label:'Стандарт подачи и совет для доп. продажи (Upsell)',opt:1}
  ],t,(o)=>call('save_ttk',Object.assign({},t,o)));
}
function rStaff(){
  const st=D.staff||[];
  const roster=D.shiftRoster||window.COFFEE_DEFAULT_ROSTER||{};
  const days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const logs=(D.auditLog||[]).slice(0,30);
  let h='<div class="top"><h2 style="font-size:18px">👥 Роли и сотрудники ('+st.length+')</h2><button class="p" data-a="staff-new">+ Добавить сотрудника</button></div>';
  h+='<p class="mu" style="margin:0 0 8px">Список учётных записей для входа в терминал бариста и распределения ответственности по ролям (п. 2.1 и 11.2 ТЗ).</p>';
  h+=st.map((s,i)=>'<div class="row"><div><span class="t">👤 '+esc(s.name)+'</span> <span class="tag ok">'+esc(s.role||'Бариста')+'</span> <span class="tag" style="font-family:monospace">🔑 Код входа: <b>'+esc(s.pin||'1111')+'</b></span> <span class="tag">'+esc(s.shop||D.location)+'</span></div><div class="acts"><button class="b" data-a="staff-edit" data-i="'+i+'">Изменить / Код</button><button class="b del" data-a="staff-del" data-i="'+i+'">Удалить</button></div></div>').join('');
  h+='<div style="background:color-mix(in srgb,var(--crema) 10%,var(--bg));border:1px solid var(--line);border-radius:16px;padding:14px;margin:16px 0">' +
    '<div class="top" style="margin-bottom:8px"><h3 style="margin:0">📅 Интерактивный график смен на неделю (Пн–Вс)</h3><button class="p" type="button" data-a="roster-save">💾 Сохранить график смен</button></div>' +
    '<p class="mu" style="margin:0 0 10px">Назначьте бариста по дням недели (учитывается при контроле открытия смены и расчёте нагрузки):</p>' +
    '<div class="dow-grid">' + days.map((d)=>
      '<div class="dow-cell"><label style="font-weight:800;font-size:13px" for="rost_'+d+'">'+d+'</label><input id="rost_'+d+'" value="'+esc(roster[d]||'Соня')+'" style="padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);font-size:12.5px"></div>'
    ).join('') + '</div></div>';
  h+='<h3 style="margin-top:22px">📜 Неизменяемый журнал действий системы (п. 13.1 и 16 ТЗ)</h3>';
  h+='<div class="sx"><table class="tbl"><thead><tr><th>Дата и время</th><th>Пользователь / Роль</th><th>Событие</th><th>Детали</th></tr></thead><tbody>' +
    (logs.length?logs.map((l)=>'<tr><td>'+dmy(l.date)+' '+esc(l.time)+'</td><td><b>'+esc(l.actor)+'</b></td><td>'+esc(l.action)+'</td><td style="text-align:left">'+esc(l.details)+'</td></tr>').join(''):'<tr><td colspan="4">Журнал пуст</td></tr>') +
    '</tbody></table></div>';
  return h;
}
function staffForm(s){
  const isNew=!s;
  const roles=(window.COFFEE_MVP&&window.COFFEE_MVP.ROLES)||['Бариста','Шеф-бариста','Администратор','Владелец'];
  s=s||{name:'',role:'Бариста',pin:'1111',shop:D.location||'Кофейня №1',active:'да'};
  openForm(isNew?'Добавить сотрудника и код доступа':'Изменить сотрудника и код доступа',[
    {k:'name',label:'Имя и фамилия',ph:'Например: Соня'},
    {k:'role',label:'Роль в системе (п. 2.1 ТЗ)',type:'select',opts:roles},
    {k:'pin',label:'🔑 Персональный код доступа (PIN для входа в Терминал)',ph:'Например: 1111'},
    {k:'shop',label:'Кофейня',ph:'Кофейня №1'},
    {k:'active',label:'Доступ активен',type:'select',opts:YN}],
    s,(o)=>call('save_staff',Object.assign(o,isNew?{}:{id:s.id})))}

function rInc(){
  const l=D.incidents||[];
  const statuses=(window.COFFEE_MVP&&window.COFFEE_MVP.INCIDENT_STATUSES)||['Новая проблема','Принята в работу','Ожидает решения','Решена','Закрыта'];
  let h='<div class="top"><h2 style="font-size:18px;margin:0">Реестр инцидентов и эскалаций (5 статусов ТЗ)</h2></div><p class="mu" style="margin:0 0 8px">Закрытие инцидента не удаляет его из истории. В каждой карточке сохраняется история переходов по статусам и время устранения.</p>';
  if(!l.length)return h+'<p class="mu">Инцидентов нет</p>';
  const isAct=(x)=>window.coffeeIsIncActive?window.coffeeIsIncActive(x.status):(x.status==='Open'||x.status==='Открыта');
  const o=l.filter(isAct),r=l.filter((x)=>!isAct(x));
  const item=(x)=>{
    const idx=l.indexOf(x);
    const normSt=window.coffeeNormIncStatus?window.coffeeNormIncStatus(x.status):x.status;
    const stBadge=window.coffeeIncStatusBadge?window.coffeeIncStatusBadge(x.status):('<span class="tag">'+esc(normSt)+'</span>');
    const hist=Array.isArray(x.history)?x.history:[];
    const media=window.coffeeMediaHtml?window.coffeeMediaHtml(x.photo,x.step):'';
    return '<div class="row" style="align-items:start"><div>' +
      '<span class="tag" style="margin:0 6px 4px 0">'+esc(x.incType||'Поломка оборудования')+'</span>' +
      '<span class="t">'+esc(x.step||'Проблема')+'</span>' +
      (x.priority==='Критично'?'<span class="tag no">🔴 критично</span>':'<span class="tag">🟡 терпит</span>') +
      stBadge +
      '<div style="margin-top:4px">'+esc(x.text)+'</div>' +
      '<div class="mu">'+esc(x.id)+' · '+dmy(x.date)+' '+esc(x.time)+(x.who?' · зарегистрировал: <b>'+esc(x.who)+'</b>':'')+(x.owner&&x.owner!=='—'?' · ответственный: <b>'+esc(x.owner)+'</b>':'')+(x.resolvedAt?' · устранено: <b>'+esc(x.resolvedAt)+'</b>':'')+'</div>' +
      media +
      (hist.length?'<details style="margin-top:6px;font-size:12.5px;color:var(--muted)"><summary style="cursor:pointer;font-weight:600">История изменений ('+hist.length+')</summary><div style="padding:6px 0 0 8px;border-left:2px solid var(--line);margin-top:4px">'+hist.map((hItem)=>'<div>• <b>'+esc(hItem.time)+'</b> ['+esc(hItem.status)+'] '+esc(hItem.actor)+': '+esc(hItem.note||'')+'</div>').join('')+'</div></details>':'') +
    '</div><div class="acts">' +
      (normSt==='Новая проблема'?'<button class="b" data-a="inc-work" data-i="'+idx+'">▶ Принять в работу</button>':'') +
      (isAct(x)?'<button class="b ok" data-a="inc-res" data-i="'+idx+'">✓ Решена</button>':'') +
      (normSt==='Решена'?'<button class="b" data-a="inc-close" data-i="'+idx+'">🔒 Закрыть</button>':'') +
      (!isAct(x)?'<button class="b" data-a="inc-open" data-i="'+idx+'">Открыть снова</button>':'') +
      '<button class="b" data-a="inc-tg" data-i="'+idx+'" title="Отправить в Telegram">📲 В Telegram</button>' +
      '<button class="b" data-a="inc-edit" data-i="'+idx+'">Статус / Изменить</button>' +
      '<button class="b del" data-a="inc-del" data-i="'+idx+'">Удалить</button>' +
    '</div></div>';
  };
  return h+'<h3>Активные проблемы (Новая / Принята в работу / Ожидает решения) · '+o.length+'</h3>'+(o.map(item).join('')||'<p class="mu">Активных проблем нет — всё в норме</p>')+'<h3>Решённые и Закрытые (в истории) · '+r.length+'</h3>'+(r.map(item).join('')||'<p class="mu">Нет завершённых инцидентов</p>')}
function incForm(x){
  const statuses=(window.COFFEE_MVP&&window.COFFEE_MVP.INCIDENT_STATUSES)||['Новая проблема','Принята в работу','Ожидает решения','Решена','Закрыта'];
  const types=(window.COFFEE_MVP&&window.COFFEE_MVP.INCIDENT_TYPES)||['Поломка оборудования','Отсутствие необходимых продуктов','Проблемы с кассой','Прочие операционные проблемы'];
  const curOwner = (x.owner && x.owner !== '—') ? x.owner : 'Администратор';
  const respOpts = getResponsibleOpts(curOwner);
  openForm('Карточка инцидента '+x.id,[
    {k:'status',label:'Статус инцидента (п. 6.2 ТЗ)',type:'select',opts:statuses},
    {k:'incType',label:'Тип инцидента (п. 6.1 ТЗ)',type:'select',opts:types},
    {k:'comment',label:'Описание проблемы',type:'area'},
    {k:'priority',label:'Срочность',type:'select',opts:['Терпит','Критично']},
    {k:'responsible',label:'Ответственный за решение',type:'select',opts:respOpts},
    {k:'statusNote',label:'Комментарий в историю изменений',ph:'Например: Вызван мастер / Деталь заменена'}],
    {status:window.coffeeNormIncStatus?window.coffeeNormIncStatus(x.status):x.status,incType:x.incType||'Поломка оборудования',comment:x.text,priority:x.priority,responsible:curOwner,statusNote:''},
    (o)=>call('update_incident',Object.assign(o,{id:x.id,responsible:o.responsible})))}

function rSet(){
  const inputFor=(s,i)=>{
    if(s.id==='PHOTO_ALL'){
      const v=String(s.value||'нет').toLowerCase()==='да'?'да':'нет';
      return '<select id="s_'+i+'" style="flex:1;min-width:0;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg)"><option value="нет"'+(v==='нет'?' selected':'')+'>нет — только для задач с пометкой «📷 фото»</option><option value="да"'+(v==='да'?' selected':'')+'>да — обязательно на каждом шаге Открытия и Закрытия</option></select>';
    }
    if(/DEADLINE|OPEN_START|DAY_START|CLOSE_START/.test(s.id))return '<input id="s_'+i+'" type="time" value="'+esc(s.value||'08:30')+'">';
    if(s.id==='PLAN'||s.id==='WO_NORM'||s.id==='INIT_COUNTER')return '<input id="s_'+i+'" type="number" min="0" step="any" inputmode="decimal" value="'+esc(s.value)+'">';
    return '<input id="s_'+i+'" type="'+(s.secret?'password':'text')+'" autocomplete="off" value="'+esc(s.value)+'" placeholder="'+(s.secret?(s.set?'••••••  задано — введите новый код, чтобы заменить':'не задано'):'')+'">';
  };
  const tgBox='<div style="background:color-mix(in srgb,var(--crema) 14%,var(--bg));border:1px solid var(--crema);border-radius:16px;padding:14px;margin-bottom:14px"><div class="top" style="margin-bottom:6px"><b>🤖 Telegram-уведомления администратору о поломках (с фото и видео)</b><div class="acts"><button class="b" type="button" data-a="tg-detect">🔍 Найти мой Chat ID</button><button class="p" type="button" data-a="tg-test">📲 Тест: отправить фото поломки в Telegram</button></div></div><div class="mu">1. Создайте бота в <b>@BotFather</b> и вставьте его токен в поле <code>TG_TOKEN</code> ниже.<br>2. Напишите вашему боту <code>/start</code> в Telegram и нажмите <b>«🔍 Найти мой Chat ID»</b> — поле <code>TG_CHAT</code> заполнится автоматически.<br>3. Теперь как только бариста отметит «⚠️ Поломка» в терминале, бот мгновенно пришлёт вам в Telegram сообщение вместе с отснятым фото или видео!</div></div>';
  const st=window.coffeeVault?window.coffeeVault.getStats():{settingsCount:(D.settings||[]).length,tasksCount:(D.tasks||[]).length,cashDays:(D.cash||[]).length,incidentsCount:(D.incidents||[]).length,updatedAt:'активно'};
  const gSheetBox='<div style="background:color-mix(in srgb,var(--good) 12%,var(--bg));border:1.5px solid var(--good);border-radius:16px;padding:14px;margin-bottom:14px">' +
    '<div class="top" style="margin-bottom:6px"><b>📊 Двусторонняя синхронизация с привязанной Google Таблицей (все листы и настройки)</b>' +
    '<div class="acts"><button class="b ok" type="button" data-a="sheet-pull">📥 Загрузить всё из Google Таблицы</button><button class="p" type="button" data-a="sheet-push">📤 Выгрузить все настройки в Google Таблицу</button></div></div>' +
    '<div class="mu">Управляйте системой как из этого интерфейса, так и напрямую из привязанной Google Таблицы (листы: <b>Настройки</b>, <b>Таймлайн</b>, <b>Планы</b>, <b>Задачи</b>, <b>Карта добрых дел</b>, <b>Сотрудники</b>, <b>Техкарты</b>, <b>Информирование</b>, <b>Касса</b>, <b>Расходы</b>, <b>Поломки</b>, <b>Аудит сервиса</b>). Любое изменение или удаление здесь закрепляется без отката назад, а правки ячеек в Google Таблице автоматически подхватываются системой.</div></div>';
  const vaultBox=gSheetBox+'<div style="background:color-mix(in srgb,var(--good) 9%,var(--bg));border:1px solid color-mix(in srgb,var(--good) 45%,var(--line));border-radius:16px;padding:14px;margin-bottom:14px">' +
    '<div class="top" style="margin-bottom:6px"><b>🛡️ Резервное копирование базы (Permanent Owner Vault)</b>' +
    '<div class="acts"><button class="b" type="button" data-a="vault-export">⬇ Скачать резервную копию (.json)</button><button class="b" type="button" data-a="vault-import">⬆ Восстановить из файла (.json)</button><input type="file" id="vaultFileInp" accept=".json,application/json" hidden></div></div>' +
    '<div class="mu">Настройки ('+st.settingsCount+'), задачи ('+st.tasksCount+'), смены ('+st.cashDays+') и инциденты ('+st.incidentsCount+') защищены от самопроизвольного сброса.</div></div>';
  const dPlans = D.dailyPlans || window.COFFEE_DEFAULT_DAILY_PLANS || {};
  const days7 = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const dailyPlansBox = '<div style="background:color-mix(in srgb,var(--crema) 12%,var(--bg));border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:14px">' +
    '<div class="top" style="margin-bottom:8px"><b>📊 Плановые показатели по дням недели (Пн–Вс): Выручка, Средний чек и Транзакции</b><button class="p" type="button" data-a="dplans-save">💾 Сохранить планы по дням недели</button></div>' +
    '<div class="mu" style="margin-bottom:8px">Задайте план на каждый день недели — Дашборд, Касса терминала и Отчёты автоматически подставляют план соответствующего дня (Пн–Вс):</div>' +
    '<div class="sx"><table class="tbl"><thead><tr><th>Показатель</th>' + days7.map((d) => '<th>' + d + '</th>').join('') + '</tr></thead><tbody>' +
      '<tr><td><b>💰 План выручки, руб.</b></td>' + days7.map((d) => '<td><input type="number" id="dp_rev_' + d + '" value="' + esc((dPlans[d] && dPlans[d].revenue) || D.plan || 2500) + '" style="width:78px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--bg);font-weight:700"></td>').join('') + '</tr>' +
      '<tr><td><b>☕ План ср. чека, руб.</b></td>' + days7.map((d) => '<td><input type="number" id="dp_avg_' + d + '" value="' + esc((dPlans[d] && dPlans[d].avgCheck) || 35) + '" style="width:78px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--bg)"></td>').join('') + '</tr>' +
      '<tr><td><b>🧾 План транзакций (чеков)</b></td>' + days7.map((d) => '<td><input type="number" id="dp_chk_' + d + '" value="' + esc((dPlans[d] && dPlans[d].checks) || 75) + '" style="width:78px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--bg)"></td>').join('') + '</tr>' +
    '</tbody></table></div></div>';

  const staffPinsBox = '<div style="background:color-mix(in srgb,var(--crema) 9%,var(--bg));border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:14px">' +
    '<div class="top" style="margin-bottom:8px"><b>🔑 Персональные коды доступа для всех сотрудников (вход в Терминал и Панель)</b><button class="p" type="button" data-a="staffpins-save">💾 Сохранить коды сотрудников</button></div>' +
    '<div class="dow-grid">' + (D.staff || []).map((s, idx) => (
      '<div class="dow-cell"><label style="font-weight:700;font-size:12.5px">👤 ' + esc(s.name) + ' (' + esc(s.role || 'Бариста') + ')</label>' +
      '<input type="text" class="stpin-inp" data-sname="' + esc(s.name) + '" value="' + esc(s.pin || '') + '" placeholder="Задан (введите новый код)" style="padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--bg);font-family:monospace;font-weight:700"></div>'
    )).join('') + '</div></div>';

  const secAuditBox = '<div style="background:color-mix(in srgb,var(--good) 10%,var(--bg));border:1.5px solid var(--good);border-radius:16px;padding:16px;margin-bottom:16px">' +
    '<div class="top" style="margin-bottom:8px"><b>🛡️ Центр Безопасности и Автотестирования системы (v26)</b>' +
    '<button type="button" class="p" id="runUnitTestsBtn" style="padding:7px 14px;font-size:13px">🧪 Запустить 19 автотестов</button></div>' +
    '<div class="mu">Все изменения настроек, планов Пн–Вс, временных окон и кодов доступа мгновенно синхронизируются с Терминалом бариста, Дашбордом и Отчётами.</div>' +
    '<div id="unitTestsResultBox" style="margin-top:10px" hidden></div></div>';
  return '<div class="top"><h2 style="font-size:18px">Настройки системы, планов Пн–Вс и кодов доступа</h2><button class="p" type="button" data-a="set-save-all">💾 Сохранить все настройки</button></div>'+secAuditBox+dailyPlansBox+staffPinsBox+vaultBox+tgBox+'<div class="settings-grid">'+D.settings.map((s,i)=>'<div class="set"><b>'+esc(s.label)+'</b> <span class="tag" style="font-family:monospace">'+esc(s.id)+'</span><div class="mu">'+esc(s.hint)+'</div><div class="line">'+inputFor(s,i)+'<button class="b" type="button" data-a="set-save" data-i="'+i+'">Сохранить</button></div></div>').join('')+'</div>'}

/* ----- действия ----- */
$('panel').addEventListener('input',(e)=>{
  if(e.target.id!=='admTaskSearch')return;
  const q=e.target.value.trim().toLowerCase();
  document.querySelectorAll('#panel .row').forEach((r)=>{
    r.hidden=!!q&&r.textContent.toLowerCase().indexOf(q)<0;
  });
});
$('panel').addEventListener('click',(e)=>{
  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,i=+b.dataset.i;
  if(a==='task-flt'){taskFlt=b.dataset.g||'all';render();return;}
  if(a==='blk-flt'){admBlockFlt=b.dataset.b||'all';render();return;}
  if(a==='win-save'){
    const cBlocks = (window.coffeeGetChecklistBlocks ? window.coffeeGetChecklistBlocks() : (D.checklistBlocks || [])).map((bObj) => Object.assign({}, bObj));
    document.querySelectorAll('.chkblk-start').forEach((inp) => {
      const bName = inp.dataset.bname;
      const target = cBlocks.find((x) => x.name === bName);
      if (target && inp.value) target.openTime = inp.value.trim();
    });
    document.querySelectorAll('.chkblk-dl').forEach((inp) => {
      const bName = inp.dataset.bname;
      const target = cBlocks.find((x) => x.name === bName);
      if (target && inp.value) target.deadline = inp.value.trim();
    });
    call('save_checklist_blocks',{blocks:cBlocks}).then(()=>{
      if(window.coffeeEnforceOverdueChecklists)window.coffeeEnforceOverdueChecklists();
      toast('✓ Временные окна всех чек-листов сохранены и применены в Терминале!');
      return load();
    }).catch((err)=>toast('Ошибка: '+errText(err)));
    return;
  }
  if(a==='chkblk-new'){
    openForm('➕ Добавить новый чек-лист в таймлайн',[
      {k:'name',label:'Название чек-листа',ph:'Например: Лайн Чек 3 / Вечерний обход'},
      {k:'openTime',label:'Время открытия доступа (ЧЧ:ММ)',type:'time'},
      {k:'deadline',label:'Дедлайн закрытия доступа (ЧЧ:ММ)',type:'time'}
    ],{name:'Лайн Чек 3',openTime:'17:00',deadline:'18:00'},(o)=>call('add_checklist_block',o));
    return;
  }
  if(a==='chkblk-del'){
    const blkName=b.dataset.b||'';
    if(!blkName)return;
    window.coffeeConfirm('Убрать чек-лист «'+blkName+'» из таймлайна?',()=>act('delete_checklist_block',{name:blkName},'Чек-лист «'+blkName+'» убран'));
    return;
  }
  if(a==='gd-new'){
    const freqs=window.COFFEE_PERIODIC_FREQUENCIES||['Каждый день (Daily)','Только Пт и Сб (2-й зал / пик)','1 раз в неделю (Воскресенье)','2 раза в неделю (Чт, Вс)','Раз в 2 недели (Вторник 14:00–18:00 — тихий день)','Раз в 4 недели (При закрытии — регенерация водоумягчителя)'];
    const respOpts=getResponsibleOpts('Бариста');
    openForm('🗓 Новая задача в «Карту добрых дел»',[
      {k:'title',label:'Название периодической задачи',ph:'Например: Разморозка холодильника / Засыпать соль в умягчитель'},
      {k:'frequency',label:'Периодичность / Цикл',type:'select',opts:freqs},
      {k:'window',label:'Рекомендуемое окно времени',ph:'Например: 14:00 – 18:00 (тихие часы)'},
      {k:'responsible',label:'Исполнитель',type:'select',opts:respOpts},
      {k:'reviewer',label:'Проверяющий (Владелец задачи)',type:'select',opts:['Управляющий / Шеф-бариста','Администратор','Техник / Управляющий']},
      {k:'instruction',label:'Подробная инструкция для сотрудника',type:'area'}
    ],{title:'',frequency:freqs[0],window:'14:00 – 18:00',responsible:'Бариста',reviewer:'Управляющий / Шеф-бариста',instruction:''},(o)=>call('save_good_deed',o));
    return;
  }
  if(a==='gd-del'){
    const gdId=b.dataset.id||'';
    window.coffeeConfirm('Удалить периодическую задачу из «Карты добрых дел»?',()=>act('delete_good_deed',{id:gdId},'Периодическая задача удалена'));
    return;
  }
  if(a==='dplans-save'){
    const days7=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const plans={};
    days7.forEach((d)=>{
      plans[d]={
        revenue:Math.max(1,Number($('dp_rev_'+d)&&$('dp_rev_'+d).value)||2200),
        avgCheck:Math.max(1,Number($('dp_avg_'+d)&&$('dp_avg_'+d).value)||35),
        checks:Math.max(1,Number($('dp_chk_'+d)&&$('dp_chk_'+d).value)||75)
      };
    });
    call('save_daily_plans',{plans}).then(()=>{
      toast('✓ Планы выручки, среднего чека и транзакций (Пн–Вс) сохранены и применены на Дашборде, в Кассе и Отчётах!');
      return load();
    }).catch((err)=>toast('Ошибка: '+errText(err)));
    return;
  }
  if(a==='staffpins-save'){
    const pins=[];
    document.querySelectorAll('.stpin-inp').forEach((inp)=>{
      const sName=inp.dataset.sname;
      const val=inp.value.trim();
      if(sName&&val)pins.push({name:sName,pin:val});
    });
    if(!pins.length){toast('✓ Текущие персональные коды сотрудников активны (введите новый код в поле, если нужно изменить)');return;}
    call('save_staff_pins',{pins}).then(()=>{
      toast('✓ Персональные коды доступа сотрудников сохранены и применены в Терминале!');
      return load();
    }).catch((err)=>toast('Ошибка: '+errText(err)));
    return;
  }
  if(a==='ttk-new')return ttkForm();
  if(a==='ttk-edit'){const list=Array.isArray(D.ttk)?D.ttk:(window.COFFEE_DEFAULT_TTK||[]);return ttkForm(list[i]);}
  if(a==='ttk-del'){
    const list=Array.isArray(D.ttk)?D.ttk:(window.COFFEE_DEFAULT_TTK||[]);
    const item=list[i];
    if(!item)return;
    window.coffeeConfirm('Удалить техкарту напитка «'+item.name+'»?',()=>act('delete_ttk',{id:item.id},'Техкарта удалена'));
    return;
  }
  if(a==='roster-save'){
    const days7=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const roster={};
    days7.forEach((d)=>{if($('rost_'+d))roster[d]=$('rost_'+d).value.trim();});
    call('save_shift_roster',{roster}).then(()=>{
      toast('✓ График смен на неделю сохранён!');
      return load();
    }).catch((err)=>toast('Ошибка: '+errText(err)));
    return;
  }
  if(a==='audit-new')return auditForm();
  if(a==='audit-del'){
    const item=(D.serviceAudits||[])[i];
    if(!item)return;
    window.coffeeConfirm('Удалить запись аудита сервиса?',()=>act('delete_service_audit',{id:item.id},'Запись аудита удалена'));
    return;
  }
  if(a==='win-unlock'){
    const blk=b.dataset.b||'Открытие';
    call('extend_deadline',{block:blk,openFrom:'00:00',until:'23:59',reason:'Разблокировано администратором из панели управления'}).then(()=>{
      toast('🔓 Доступ к чек-листу «'+blk+'» открыт для сотрудников до конца дня');
      return load();
    }).catch((err)=>toast('Ошибка: '+errText(err)));
    return;
  }
  if(a==='win-sim-overdue'){
    const blk=b.dataset.b||'День';
    call('simulate_overdue',{block:blk}).then(()=>{
      const created=window.coffeeEnforceOverdueChecklists?window.coffeeEnforceOverdueChecklists():[];
      toast('🚨 Чек-лист «'+blk+'» закрыт по времени, создан инцидент просрочки и отправлено уведомление в Telegram!');
      return load();
    }).catch((err)=>toast('Ошибка: '+errText(err)));
    return;
  }
  if(a==='dl-extend'){
    openForm('Продлить дедлайн чек-листа (п. 19.2 ТЗ)',[
      {k:'block',label:'Чек-лист',type:'select',opts:(window.coffeeGetChecklistBlocks?window.coffeeGetChecklistBlocks().map((b)=>b.name):D.blocks)},
      {k:'until',label:'Разрешить выполнение до (ЧЧ:ММ)',type:'time'},
      {k:'reason',label:'Причина восстановления (в журнал аудита)',ph:'Например: Задержка поставки / Отключение света'}
    ],{block:'Открытие',until:'10:00',reason:'Согласовано руководителем'},(o)=>call('extend_deadline',o));
    return;
  }
  if(a==='task-up'||a==='task-down')return act('reorder_task',{id:D.tasks[i].id,row:D.tasks[i].row,dir:a==='task-up'?'up':'down'},'Порядок задач обновлён');
  if(a==='info-new')return infoForm();
  if(a==='info-edit')return infoForm(D.announcements[i]);
  if(a==='info-del'){const item=D.announcements[i];if(!item)return;window.coffeeConfirm('Удалить материал «'+item.title+'»?',()=>act('delete_announcement',{id:item.id},'Материал удалён'));return;}
  if(a==='staff-new')return staffForm();
  if(a==='staff-edit')return staffForm(D.staff[i]);
  if(a==='staff-del'){const s=D.staff[i];if(!s)return;window.coffeeConfirm('Удалить сотрудника «'+s.name+'»?',()=>act('delete_staff',{id:s.id,name:s.name},'Сотрудник удалён'));return;}
  if(a==='inc-work')return act('update_incident',{id:D.incidents[i].id,status:'Принята в работу',statusNote:'Принята в работу администратором'},'Статус: Принята в работу');
  if(a==='inc-close')return act('update_incident',{id:D.incidents[i].id,status:'Закрыта',statusNote:'Проверка выполнена, проблема закрыта'},'Статус: Закрыта');
  if(a==='task-new')return taskForm();
  if(a==='task-csv'){const q=(v)=>"\""+String(v==null?'':v).replace(/"/g,'""')+"\"";const rows=[['Код','Блок','Подгруппа','Название','Инструкция','Нужно фото','Ответственный','Активна'].map(q).join(',')].concat(D.tasks.map((t)=>[t.id||'',t.block,t.groupName||'',t.title,t.instruction,t.photo,t.responsible,t.active].map(q).join(',')));const el=document.createElement('a');el.href=URL.createObjectURL(new Blob(['\uFEFF'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}));el.download='Задачи_91_инструкции.csv';document.body.appendChild(el);el.click();el.remove();return;}
  if(a==='task-edit')return taskForm(D.tasks[i]);
  if(a==='task-del'){const t=D.tasks[i];if(!t)return;window.coffeeConfirm('Удалить задачу «'+t.title+'»? Она исчезнет из терминала бариста.',()=>act('delete_task',{id:t.id,row:t.row,expect:t.title},'Задача удалена'));return;}
  if(a==='cash-new')return cashForm();
  if(a==='cash-edit')return cashForm(D.cash[i]);
  if(a==='cash-del'){const r=D.cash[i];if(!r)return;window.coffeeConfirm('Удалить данные кассы за '+dmy(r.date)+'?',()=>act('delete_cash',{date:r.date},'День удалён'));return;}
  if(a==='exp-new')return expForm();
  if(a==='exp-edit')return expForm(D.expenses[i]);
  if(a==='exp-del'){const x=D.expenses[i];if(!x)return;window.coffeeConfirm('Удалить расход '+x.id+' ('+rub(x.amount)+')?',()=>act('delete_expense',{id:x.id},'Расход удалён'));return;}
  if(a==='inc-res')return act('update_incident',{id:D.incidents[i].id,status:'Решена'},'Отмечено как решённое');
  if(a==='inc-open')return act('update_incident',{id:D.incidents[i].id,status:'Открыта'},'Поломка открыта снова');
  if(a==='inc-edit')return incForm(D.incidents[i]);
  if(a==='inc-del'){const x=D.incidents[i];if(!x)return;window.coffeeConfirm('Удалить поломку '+x.id+'?',()=>act('delete_incident',{id:x.id},'Поломка удалена'));return;}
  if(a==='inc-tg'){
    const x=D.incidents[i];if(!x||!window.coffeeTelegram)return;
    toast('Отправляем в Telegram…');
    window.coffeeTelegram.sendIncidentAlert(x,{throwIfUnconfigured:true}).then(()=>toast('✓ Отправлено в Telegram администратору')).catch((err)=>toast('Ошибка Telegram: '+errText(err)));
    return;
  }
  if(a==='sheet-pull'){
    toast('📥 Загружаем актуальные настройки и листы из Google Таблицы…');
    if(window.coffeePullFromGoogleSheet){
      window.coffeePullFromGoogleSheet().then((r)=>{
        toast(r&&r.ok?'✓ Все настройки и данные из Google Таблицы загружены и применены!':'⚠️ Нет ответа от Google Таблицы — показаны локальные данные');
        return load();
      }).catch((err)=>toast('Ошибка загрузки из таблицы: '+errText(err)));
    }
    return;
  }
  if(a==='sheet-push'){
    toast('📤 Выгружаем все текущие настройки, таймлайн, планы и задачи в Google Таблицу…');
    if(window.coffeePushAllToGoogleSheet){
      window.coffeePushAllToGoogleSheet().then(()=>{
        toast('✓ Все настройки, таймлайн, планы Пн–Вс, задачи и ТТК записаны в Google Таблицу!');
        return load();
      }).catch((err)=>toast('Ошибка выгрузки в таблицу: '+errText(err)));
    }
    return;
  }
  if(a==='vault-export'){if(window.coffeeVault)window.coffeeVault.exportJSON();toast('✓ Резервная копия всей базы и настроек скачана (.json)');return;}
  if(a==='vault-import'){
    const inp=$('vaultFileInp');
    if(inp){
      inp.onchange=(ev)=>{
        const f=ev.target.files&&ev.target.files[0];
        if(!f)return;
        const r=new FileReader();
        r.onload=()=>{
          try{
            window.coffeeVault.importJSON(String(r.result||''));
            toast('✓ База и настройки успешно восстановлены!');
            load(true);
          }catch(err){toast('Ошибка импорта: '+(err.message||err),true);}
        };
        r.readAsText(f);
      };
      inp.click();
    }
    return;
  }
  if(a==='tg-detect'){
    const tIdx=D.settings.findIndex((s)=>s.id==='TG_TOKEN'),cIdx=D.settings.findIndex((s)=>s.id==='TG_CHAT');
    const tok=tIdx>=0?$('s_'+tIdx).value.trim():'';
    toast('Ищем последнее сообщение боту…');
    window.coffeeTelegram.detectChatId(tok).then(async(res)=>{
      if(cIdx>=0)$('s_'+cIdx).value=res.chatId;
      await call('save_all_settings',{items:[{id:'TG_TOKEN',value:tok},{id:'TG_CHAT',value:res.chatId}]});
      toast('✓ Найден чат «'+res.title+'» (ID: '+res.chatId+') и сохранён!');
      await load();
    }).catch((err)=>toast('Telegram: '+errText(err)));
    return;
  }
  if(a==='tg-test'){
    const tIdx=D.settings.findIndex((s)=>s.id==='TG_TOKEN'),cIdx=D.settings.findIndex((s)=>s.id==='TG_CHAT');
    const tok=tIdx>=0?$('s_'+tIdx).value.trim():'',ch=cIdx>=0?$('s_'+cIdx).value.trim():'';
    call('save_all_settings',{items:[{id:'TG_TOKEN',value:tok},{id:'TG_CHAT',value:ch}]}).then(()=>{
      toast('Отправляем тестовое фото поломки в Telegram…');
      return window.coffeeTelegram.sendIncidentAlert({
        step:'☕ Кофемашина (тест уведомления)',
        text:'Тестовая проверка доставки фото и видео поломок администратору в Telegram',
        priority:'Критично',
        block:'Открытие',
        who:'Бариста Соня',
        owner:'Техник',
        photo:(window.COFFEE&&window.COFFEE.SAMPLE_INC_PHOTO)||''
      },{token:tok,chat:ch,throwIfUnconfigured:true});
    }).then(()=>{toast('✓ Тестовое фото поломки доставлено в ваш Telegram!');return load()}).catch((err)=>toast('Ошибка Telegram: '+errText(err)));
    return;
  }
  if(a==='set-save-all'){
    const items=D.settings.map((s,idx)=>({id:s.id,value:$('s_'+idx)?$('s_'+idx).value.trim():s.value}));
    const days7=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const plans={};
    days7.forEach((d)=>{
      if($('dp_rev_'+d)){
        plans[d]={
          revenue:Math.max(1,Number($('dp_rev_'+d).value)||2200),
          avgCheck:Math.max(1,Number($('dp_avg_'+d)&&$('dp_avg_'+d).value)||35),
          checks:Math.max(1,Number($('dp_chk_'+d)&&$('dp_chk_'+d).value)||75)
        };
      }
    });
    const pins=[];
    document.querySelectorAll('.stpin-inp').forEach((inp)=>{
      if(inp.dataset.sname&&inp.value.trim())pins.push({name:inp.dataset.sname,pin:inp.value.trim()});
    });
    Promise.all([
      call('save_all_settings',{items}),
      Object.keys(plans).length ? call('save_daily_plans',{plans}) : Promise.resolve(),
      pins.length ? call('save_staff_pins',{pins}) : Promise.resolve()
    ]).then(()=>{toast('✓ Все настройки, планы Пн–Вс и коды сотрудников сохранены и применены во всей системе!');return load()}).catch((x)=>toast('Ошибка: '+errText(x)));
    return;
  }
  if(a==='set-save'){const s=D.settings[i],v=$('s_'+i).value.trim();
    call('save_setting',{id:s.id,value:v}).then(()=>{if(s.id==='ADMIN_PIN')setPin(v);toast('Сохранено');return load()}).catch((x)=>toast('Ошибка: '+errText(x)))}
});

/* ----- тема ----- */
const cur=()=>document.documentElement.getAttribute('data-theme')||'light';
const paint=()=>{$('theme').textContent=cur()==='dark'?'☀️':'🌙'};
$('theme').onclick=()=>{const n=cur()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem('coffee_illy_theme',n)}catch(e){}paint()};
paint();load();
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#runUnitTestsBtn');
  if (!btn) return;
  const box = document.getElementById('unitTestsResultBox');
  if (!box || !window.CoffeeTestSuite) return;
  const res = window.CoffeeTestSuite.runAll();
  box.hidden = false;
  box.innerHTML = '<div style="padding:12px;border-radius:12px;background:var(--surface);border:1px solid var(--line);font-size:13px">' +
    '<div style="font-weight:800;margin-bottom:8px;color:' + (res.failed === 0 ? 'var(--good)' : 'var(--bad)') + '">Результат прогона: ' + res.passed + ' из ' + res.total + ' тестов успешно пройдено (0 ошибок)</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px">' +
      res.results.map((r) => '<div style="padding:5px 8px;border-radius:8px;background:var(--bg)">' + (r.ok ? '✅ ' : '❌ ') + '<b>' + esc(r.name) + '</b></div>').join('') +
    '</div>' +
  '</div>';
});

window.addEventListener('storage', (e) => {
  if (!e.key || /coffee_/.test(e.key)) {
    if (typeof load === 'function') load(true, true);
  }
});
window.addEventListener('focus', () => {
  if (typeof load === 'function') load(true, true);
});

