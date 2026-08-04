import{api,money,esc,phoneDigits,phoneFormat,findAccess,latestAccess,saveAccess}from'./shared.js?v=2';
const $=id=>document.getElementById(id);
let token='',savedPhone='',checking=false;

const dt=v=>{
  if(!v)return'—';
  const d=new Date(v);
  return Number.isNaN(d.getTime())
    ?String(v)
    :new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(d)
};

function fail(m){
  $('feedback').textContent=m;
  $('feedback').className='feedback show error';
}

function setStoredAccess(id){
  const x=findAccess(id);
  token=String(x?.trackingToken||'').trim();
  savedPhone=phoneDigits(x?.phone||'');
  $('phoneField').classList.toggle('hidden',Boolean(token||savedPhone));
}

function progressData(d){
  const pickup=String(d.deliveryLabel||'').startsWith('Самовывоз');
  const stages=pickup
    ?['Заказ принят','Готовится','Готов','Выдан']
    :['Заказ принят','Готовится','Готов','Передан курьеру','Доставлен'];

  const indexByStatus={
    'Новый':0,
    'Подтверждён':0,
    'Готовится':1,
    'Готов':2,
    'Передан курьеру':pickup?2:3,
    'Завершён':stages.length-1
  };

  const messages={
    'Новый':'Заказ получен и ожидает подтверждения.',
    'Подтверждён':'Заказ подтверждён. Скоро начнём приготовление.',
    'Готовится':'Заказ сейчас готовится.',
    'Готов':pickup?'Заказ готов. Можно забирать.':'Заказ готов и ожидает передачи курьеру.',
    'Передан курьеру':'Заказ передан курьеру и уже в пути.',
    'Завершён':pickup?'Заказ выдан. Спасибо за покупку!':'Заказ доставлен. Спасибо за покупку!',
    'Отменён':'Заказ отменён.'
  };

  return{
    stages,
    current:indexByStatus[d.status]??0,
    message:messages[d.status]||`Текущий статус: ${d.status}`,
    cancelled:d.status==='Отменён',
    pending:!!d.pendingPayment
  };
}

function renderProgress(d){
  const data=progressData(d);
  const block=$('progressBlock');
  const progress=$('orderProgress');
  const message=$('progressMessage');
  const percent=$('progressPercent');

  block.classList.toggle('cancelled',data.cancelled);
  block.classList.toggle('pending',data.pending);

  if(data.pending){
    progress.style.setProperty('--steps','1');
    progress.innerHTML='<div class="progress-step current" aria-current="step"><span class="progress-dot">1</span><span class="progress-label">Ожидает оплаты</span></div>';
    percent.textContent='';
    message.textContent=d.paymentStatus==='Оплата отменена'
      ?'Оплата отменена. Заказ не передан на кухню.'
      :'После успешной оплаты заказ будет передан на кухню.';
    return;
  }

  progress.style.setProperty('--steps',String(data.stages.length));
  progress.innerHTML=data.stages.map((label,index)=>{
    const cls=data.cancelled?'':index<data.current?'done':index===data.current?'current':'';
    const mark=index<data.current?'✓':String(index+1);
    const current=index===data.current&&!data.cancelled?' aria-current="step"':'';
    return `<div class="progress-step ${cls}"${current}><span class="progress-dot">${mark}</span><span class="progress-label">${esc(label)}</span></div>`;
  }).join('');

  const completed=data.cancelled?0:data.current+1;
  percent.textContent=data.cancelled?'Отменён':`${completed} из ${data.stages.length}`;
  message.textContent=data.message;
}

function render(d){
  $('resultId').textContent=d.orderId;
  $('created').textContent=d.pendingPayment
    ?`Заявка создана: ${dt(d.createdAt)}`
    :`Заказ оформлен: ${dt(d.createdAt)}`;
  $('status').textContent=d.status;
  $('status').className=`badge ${['Подтверждён','Завершён'].includes(d.status)?'ok':d.status==='Отменён'?'error-badge':'warn'}`;
  $('delivery').textContent=d.deliveryLabel;
  $('payment').textContent=d.paymentStatus;
  $('total').textContent=money(d.totalKopecks);
  $('updated').textContent=dt(d.updatedAt);
  $('pay').classList.toggle('hidden',!d.paymentUrl||d.paymentStatus==='Оплачено');
  if(d.paymentUrl)$('pay').href=d.paymentUrl;
  renderProgress(d);
  $('items').innerHTML='<strong>Состав</strong>'+d.items.map(i=>`<div class="order-item"><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(i.lineTotalKopecks)}</strong></div>`).join('');
  $('result').classList.remove('hidden');
  $('refresh').classList.remove('hidden');
  $('feedback').className='feedback';
}

async function requestStatus(id,accessToken,phone){
  const q=new URLSearchParams();
  if(accessToken)q.set('token',accessToken);
  else if(phone)q.set('phone',`7${phone}`);
  return api(`/api/orders/${encodeURIComponent(id)}/status?${q}`);
}

async function check(){
  if(checking)return;
  const id=$('orderId').value.trim().toUpperCase();
  const enteredPhone=phoneDigits($('phone').value);

  if(!id)return fail('Введите номер заказа.');
  if(!token&&!savedPhone)setStoredAccess(id);

  const phone=enteredPhone||savedPhone;
  if(!token&&phone.length!==10){
    $('phoneField').classList.remove('hidden');
    return fail('Введите телефон, указанный при оформлении.');
  }

  checking=true;
  $('check').disabled=true;
  $('refresh').disabled=true;

  try{
    let data;
    try{
      data=await requestStatus(id,token,phone);
    }catch(e){
      // A saved phone is a fallback only when the stored token is genuinely rejected.
      if(token&&phone.length===10&&[401,403,404].includes(Number(e.status||0))){
        data=await requestStatus(id,'',phone);
        token='';
      }else{
        throw e;
      }
    }

    saveAccess(id,token,phone);
    savedPhone=phone;
    $('phoneField').classList.add('hidden');
    render(data);
  }catch(e){
    // Temporary network/HTTP errors must not delete the device access key.
    if([401,403,404].includes(Number(e.status||0))){
      token='';
      if(savedPhone.length!==10)$('phoneField').classList.remove('hidden');
    }
    const message=Number(e.status||0)>=500||!e.status
      ?'Не удалось обновить статус. Сохранённый доступ не удалён — повторите через несколько секунд.'
      :e.message;
    fail(message);
  }finally{
    checking=false;
    $('check').disabled=false;
    $('refresh').disabled=false;
  }
}

const q=new URLSearchParams(location.search);
let id=String(q.get('order')||'').trim().toUpperCase();
token=String(q.get('token')||'').trim();

if(!id){
  const x=latestAccess();
  if(x){
    id=String(x.orderId||'').trim().toUpperCase();
    token=String(x.trackingToken||'').trim();
    savedPhone=phoneDigits(x.phone||'');
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
$('phone').oninput=e=>e.target.value=phoneFormat(e.target.value);
$('orderId').oninput=e=>setStoredAccess(e.target.value.trim().toUpperCase());
$('check').onclick=check;
$('refresh').onclick=check;

if(id&&(token||savedPhone))setTimeout(check,0);
