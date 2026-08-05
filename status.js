import{api,money,esc,phoneDigits,phoneFormat,findAccess,latestAccess,saveAccess}from'./shared.js?v=2';

const $=id=>document.getElementById(id);
const REFRESH_MS=20000;
const TERMINAL_STATUSES=new Set(['Завершён','Выдан','Доставлен','Отменён']);

let token='';
let savedPhone='';
let checking=false;
let pollTimeout=0;
let countdownInterval=0;
let manualTimer=0;
let nextPollAt=0;
let currentTerminal=false;
let previousProgressKey='';

const dt=v=>{
  if(!v)return'—';
  const d=new Date(v);
  return Number.isNaN(d.getTime())
    ?String(v)
    :new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(d);
};

function fail(message){
  $('feedback').textContent=message;
  $('feedback').className='feedback show error';
}

function clearFeedback(){
  $('feedback').className='feedback';
  $('feedback').textContent='';
}

function setAutoUpdate(text,countdown='',mode='idle'){
  $('autoUpdate').className=`auto-update ${mode}`;
  $('autoUpdateText').textContent=text;
  $('countdown').textContent=countdown;
}

function clearPolling(){
  if(pollTimeout)window.clearTimeout(pollTimeout);
  if(countdownInterval)window.clearInterval(countdownInterval);
  pollTimeout=0;
  countdownInterval=0;
  nextPollAt=0;
}

function updateCountdown(){
  if(!nextPollAt)return;
  const seconds=Math.max(0,Math.ceil((nextPollAt-Date.now())/1000));
  $('countdown').textContent=`через ${seconds} сек`;
}

function schedulePolling(){
  clearPolling();

  if(currentTerminal){
    setAutoUpdate('Заказ завершён — автообновление остановлено','','done');
    return;
  }

  if(document.hidden){
    setAutoUpdate('Автообновление приостановлено','','paused');
    return;
  }

  nextPollAt=Date.now()+REFRESH_MS;
  setAutoUpdate('Статус обновляется автоматически','','active');
  updateCountdown();

  countdownInterval=window.setInterval(updateCountdown,1000);
  pollTimeout=window.setTimeout(()=>{
    check({automatic:true});
  },REFRESH_MS);
}

function setStoredAccess(id){
  const access=findAccess(id);
  token=String(access?.trackingToken||'').trim();
  savedPhone=phoneDigits(access?.phone||'');
  $('phoneField').classList.toggle('hidden',Boolean(token||savedPhone));
}

function progressData(order){
  const pickup=String(order.deliveryLabel||'').startsWith('Самовывоз');
  const stages=pickup
    ?['Заказ принят','Готовится','Готов','Выдан']
    :['Заказ принят','Готовится','Готов','Передан курьеру','Доставлен'];

  const indexByStatus={
    'Новый':0,
    'Принят':0,
    'Заказ принят':0,
    'Подтверждён':0,
    'Готовится':1,
    'Готов':2,
    'Передан курьеру':pickup?2:3,
    'Выдан':stages.length-1,
    'Доставлен':stages.length-1,
    'Завершён':stages.length-1
  };

  const messages={
    'Новый':'Заказ получен и ожидает подтверждения.',
    'Принят':'Заказ принят.',
    'Заказ принят':'Заказ принят.',
    'Подтверждён':'Заказ подтверждён. Скоро начнём приготовление.',
    'Готовится':'Заказ сейчас готовится.',
    'Готов':pickup?'Заказ готов. Можно забирать.':'Заказ готов и ожидает передачи курьеру.',
    'Передан курьеру':'Заказ передан курьеру и уже в пути.',
    'Выдан':'Заказ выдан. Спасибо за покупку!',
    'Доставлен':'Заказ доставлен. Спасибо за покупку!',
    'Завершён':pickup?'Заказ выдан. Спасибо за покупку!':'Заказ доставлен. Спасибо за покупку!',
    'Отменён':'Заказ отменён.'
  };

  return{
    stages,
    current:indexByStatus[order.status]??0,
    message:messages[order.status]||`Текущий статус: ${order.status}`,
    cancelled:order.status==='Отменён',
    completed:['Завершён','Выдан','Доставлен'].includes(order.status),
    pending:!!order.pendingPayment
  };
}

function animateProgress(progress){
  progress.classList.remove('animate-in');
  void progress.offsetWidth;
  progress.classList.add('animate-in');
}

function renderProgress(order){
  const data=progressData(order);
  const block=$('progressBlock');
  const progress=$('orderProgress');
  const message=$('progressMessage');
  const percent=$('progressPercent');
  const progressKey=[
    order.status,
    order.deliveryLabel,
    order.paymentStatus,
    order.updatedAt
  ].join('|');
  const shouldAnimate=progressKey!==previousProgressKey;
  previousProgressKey=progressKey;

  block.classList.toggle('cancelled',data.cancelled);
  block.classList.toggle('pending',data.pending);
  block.classList.toggle('completed',data.completed);

  if(data.pending){
    progress.style.setProperty('--steps','1');
    progress.innerHTML=`
      <div class="progress-step current" aria-current="step" style="--step-index:0">
        <span class="progress-dot">1</span>
        <span class="progress-label">Ожидает оплаты</span>
      </div>`;
    percent.textContent='';
    message.textContent=order.paymentStatus==='Оплата отменена'
      ?'Оплата отменена. Заказ не передан на кухню.'
      :'После успешной оплаты заказ будет передан на кухню.';
    if(shouldAnimate)animateProgress(progress);
    return;
  }

  progress.style.setProperty('--steps',String(data.stages.length));
  progress.innerHTML=data.stages.map((label,index)=>{
    const classes=[];
    const finalStep=data.completed&&index===data.current;

    if(!data.cancelled){
      if(index<data.current)classes.push('done');
      if(index===data.current)classes.push('current');
      if(finalStep)classes.push('complete');
      if(!data.completed&&data.current>0&&index===data.current-1)classes.push('leading');
    }

    const passed=index<data.current||finalStep;
    const mark=passed?'✓':String(index+1);
    const current=index===data.current&&!data.cancelled?' aria-current="step"':'';

    return `
      <div class="progress-step ${classes.join(' ')}"${current} style="--step-index:${index}">
        <span class="progress-dot">${mark}</span>
        <span class="progress-label">${esc(label)}</span>
      </div>`;
  }).join('');

  const completed=data.cancelled?0:data.current+1;
  percent.textContent=data.cancelled?'Отменён':`${completed} из ${data.stages.length}`;
  message.textContent=data.message;

  if(shouldAnimate)animateProgress(progress);
}

function render(order){
  const scrollX=window.scrollX;
  const scrollY=window.scrollY;

  $('resultId').textContent=order.orderId;
  $('created').textContent=order.pendingPayment
    ?`Заявка создана: ${dt(order.createdAt)}`
    :`Заказ оформлен: ${dt(order.createdAt)}`;
  $('status').textContent=order.status;
  $('status').className=`badge ${['Подтверждён','Завершён','Выдан','Доставлен'].includes(order.status)?'ok':order.status==='Отменён'?'error-badge':'warn'}`;
  $('delivery').textContent=order.deliveryLabel;
  $('payment').textContent=order.paymentStatus;
  $('total').textContent=money(order.totalKopecks);
  $('updated').textContent=dt(order.updatedAt);
  $('pay').classList.toggle('hidden',!order.paymentUrl||order.paymentStatus==='Оплачено');
  if(order.paymentUrl)$('pay').href=order.paymentUrl;

  renderProgress(order);

  $('items').innerHTML='<strong>Состав</strong>'+order.items.map(item=>
    `<div class="order-item"><span>${esc(item.name)} × ${item.quantity}</span><strong>${money(item.lineTotalKopecks)}</strong></div>`
  ).join('');

  $('result').classList.remove('hidden');
  clearFeedback();

  currentTerminal=TERMINAL_STATUSES.has(order.status)
    ||order.paymentStatus==='Оплата отменена';

  window.requestAnimationFrame(()=>window.scrollTo(scrollX,scrollY));
}

async function requestStatus(id,accessToken,phone){
  const query=new URLSearchParams();
  if(accessToken)query.set('token',accessToken);
  else if(phone)query.set('phone',`7${phone}`);
  return api(`/api/orders/${encodeURIComponent(id)}/status?${query}`);
}

async function check({automatic=false}={}){
  if(checking)return;

  clearPolling();

  const id=$('orderId').value.trim().toUpperCase();
  const enteredPhone=phoneDigits($('phone').value);

  if(!id){
    setAutoUpdate('Введите номер заказа','','idle');
    return;
  }

  if(!token&&!savedPhone)setStoredAccess(id);

  const phone=enteredPhone||savedPhone;
  if(!token&&phone.length!==10){
    $('phoneField').classList.remove('hidden');
    setAutoUpdate('Введите телефон для автоматической проверки','','idle');
    if(!automatic)fail('Введите телефон, указанный при оформлении.');
    return;
  }

  checking=true;
  setAutoUpdate('Обновляем статус…','','loading');

  try{
    let order;

    try{
      order=await requestStatus(id,token,phone);
    }catch(error){
      if(token&&phone.length===10&&[401,403,404].includes(Number(error.status||0))){
        order=await requestStatus(id,'',phone);
        token='';
      }else{
        throw error;
      }
    }

    saveAccess(id,token,phone);
    savedPhone=phone;
    $('phoneField').classList.add('hidden');
    render(order);
    schedulePolling();
  }catch(error){
    const status=Number(error.status||0);

    if([401,403,404].includes(status)){
      token='';
      if(savedPhone.length!==10)$('phoneField').classList.remove('hidden');
    }

    const temporary=status>=500||!status;
    const message=temporary
      ?'Не удалось обновить статус. Повторим автоматически через 20 секунд.'
      :error.message;

    fail(message);

    if(temporary&&(token||savedPhone.length===10||phone.length===10)){
      currentTerminal=false;
      schedulePolling();
    }else{
      setAutoUpdate('Автообновление ожидает данных','','error');
    }
  }finally{
    checking=false;
  }
}

function queueManualCheck(){
  window.clearTimeout(manualTimer);
  clearPolling();

  const id=$('orderId').value.trim().toUpperCase();
  if(!id){
    setAutoUpdate('Введите номер заказа','','idle');
    return;
  }

  setStoredAccess(id);
  const phone=phoneDigits($('phone').value)||savedPhone;

  if(token||phone.length===10){
    setAutoUpdate('Подготавливаем автоматическую проверку…','','loading');
    manualTimer=window.setTimeout(()=>check(),650);
  }else{
    $('phoneField').classList.remove('hidden');
    setAutoUpdate('Введите телефон для автоматической проверки','','idle');
  }
}

const query=new URLSearchParams(location.search);
let id=String(query.get('order')||'').trim().toUpperCase();
token=String(query.get('token')||'').trim();

if(!id){
  const access=latestAccess();
  if(access){
    id=String(access.orderId||'').trim().toUpperCase();
    token=String(access.trackingToken||'').trim();
    savedPhone=phoneDigits(access.phone||'');
  }
}

if(id)$('orderId').value=id;

if(id&&token){
  const existing=findAccess(id);
  savedPhone=phoneDigits(existing?.phone||'');
  saveAccess(id,token,savedPhone);
}else if(id){
  setStoredAccess(id);
}

$('phoneField').classList.toggle('hidden',Boolean(token||savedPhone));

$('phone').oninput=event=>{
  event.target.value=phoneFormat(event.target.value);
  queueManualCheck();
};

$('orderId').oninput=event=>{
  event.target.value=event.target.value.toUpperCase();
  queueManualCheck();
};

for(const field of [$('orderId'),$('phone')]){
  field.addEventListener('keydown',event=>{
    if(event.key==='Enter'){
      event.preventDefault();
      window.clearTimeout(manualTimer);
      check();
    }
  });
}

$('refreshStatus').addEventListener('click',()=>{
  window.clearTimeout(manualTimer);
  check();
});

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    clearPolling();
    setAutoUpdate('Автообновление приостановлено','','paused');
    return;
  }

  const currentId=$('orderId').value.trim();
  const phone=phoneDigits($('phone').value)||savedPhone;
  if(currentId&&(token||phone.length===10))check({automatic:true});
});

window.addEventListener('pagehide',clearPolling);

if(id&&(token||savedPhone)){
  window.setTimeout(()=>check({automatic:true}),0);
}else{
  setAutoUpdate('Введите номер заказа и телефон','','idle');
}
