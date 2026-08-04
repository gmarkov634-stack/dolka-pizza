const CFG=window.DOLKA_CONFIG||{};
const BASE=String(CFG.apiBase||'').replace(/\/+$/,'');
export function url(p){if(!BASE||BASE.includes('example.ru'))throw new Error('В config.js не указан адрес API.');return BASE+p}
export async function api(p,o={}){const r=await fetch(url(p),{...o,headers:{'Content-Type':'application/json',...(o.headers||{})}});const t=r.headers.get('content-type')||'';const b=t.includes('application/json')?await r.json():await r.text();if(!r.ok)throw new Error(b&&typeof b==='object'&&b.error?b.error:`Ошибка HTTP ${r.status}`);return b}
export const money=k=>`${new Intl.NumberFormat('ru-RU').format(Number(k||0)/100)} ₽`;
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
export function phoneDigits(v){let d=String(v||'').replace(/\D/g,'');if(d.length===11&&(d[0]==='7'||d[0]==='8'))d=d.slice(1);return d.slice(0,10)}
export function phoneFormat(v){const d=phoneDigits(v),a=d.slice(0,3),b=d.slice(3,6),c=d.slice(6,8),e=d.slice(8,10);return a+(b?' '+b:'')+(c?'-'+c:'')+(e?'-'+e:'')}
const ORDER_KEY='dolka_order_access_v1';
export function saveAccess(id,token){if(!id||!token)return;let a=[];try{a=JSON.parse(localStorage.getItem(ORDER_KEY)||'[]');if(!Array.isArray(a))a=[]}catch{}a=a.filter(x=>x.orderId!==id);a.unshift({orderId:id,trackingToken:token,savedAt:Date.now()});localStorage.setItem(ORDER_KEY,JSON.stringify(a.slice(0,20)))}
export function findAccess(id){try{const a=JSON.parse(localStorage.getItem(ORDER_KEY)||'[]');return Array.isArray(a)?a.find(x=>String(x.orderId)===String(id))||null:null}catch{return null}}
export function latestAccess(){try{const a=JSON.parse(localStorage.getItem(ORDER_KEY)||'[]');return Array.isArray(a)&&a.length?a[0]:null}catch{return null}}
export function removeAccess(id){try{const a=JSON.parse(localStorage.getItem(ORDER_KEY)||'[]');localStorage.setItem(ORDER_KEY,JSON.stringify(Array.isArray(a)?a.filter(x=>String(x.orderId)!==String(id)):[]))}catch{}}
export function normalizeAddress(value){
  const source=String(value||'').trim();if(!source)return '';
  let raw=source.replace(/^г\.?\s*луза\s*,?\s*/i,'').replace(/\bулица\b/gi,'ул.').replace(/\bдом\b/gi,'д.').replace(/\bквартира\b/gi,'кв.').replace(/\s+/g,' ').trim();
  let street='',house='',apt='';
  const ex=raw.match(/^(.*?)(?:,?\s+д\.?\s*([0-9]+[а-яА-Я]?(?:\/[0-9]+)?))(?:,?\s+кв\.?\s*([0-9]+[а-яА-Я]?))?$/i);
  if(ex){street=ex[1];house=ex[2]||'';apt=ex[3]||''}
  else{const sm=raw.match(/^(.*?)[,\s]+([0-9]+[а-яА-Я]?(?:\/[0-9]+)?)(?:[,\s]+([0-9]+[а-яА-Я]?))?$/);if(!sm)return source;street=sm[1];house=sm[2]||'';apt=sm[3]||''}
  street=street.replace(/^ул\.?\s*/i,'').replace(/[;,]+/g,' ').trim();if(!street||!house)return source;
  street=street.split(/\s+/).map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():'').join(' ');
  return `г. Луза, ул. ${street}, д. ${house}${apt?`, кв. ${apt}`:''}`;
}
