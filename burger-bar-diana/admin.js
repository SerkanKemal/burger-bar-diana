const ordersContainer=document.querySelector('#adminOrders');
const message=document.querySelector('#adminMessage');
const tokenInput=document.querySelector('#adminToken');
const refreshCountdown=document.querySelector('#refreshCountdown');
const refreshIntervalSeconds=60;
const statusLabels={
  received:'Получена',
  confirmed:'Потвърдена',
  preparing:'Приготвя се',
  ready:'Готова',
  completed:'Приключена',
  cancelled:'Отказана'
};
let token=sessionStorage.getItem('diana-admin-token')||'';
let secondsUntilRefresh=refreshIntervalSeconds;
let isLoading=false;
let authenticated=false;
tokenInput.value=token;

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
})[char]);
const formatPrice=value=>`${Number(value).toFixed(2).replace('.',',')} лв.`;

function renderOrders(orders){
  if(!orders.length){
    ordersContainer.innerHTML='<p>Все още няма записани поръчки.</p>';
    return;
  }
  ordersContainer.innerHTML=orders.map(order=>`
    <article class="order-card status-${escapeHtml(order.status)}">
      <h2>${escapeHtml(order.order_number)}</h2>
      <div class="order-meta">
        <strong>${escapeHtml(order.customer_name)}</strong><span>${escapeHtml(order.customer_phone)}</span>
        <strong>${order.fulfillment_type==='delivery'?'Доставка':'Вземане от място'}</strong><span>${formatPrice(order.total)}</span>
        <strong>${escapeHtml(statusLabels[order.status]||order.status)}</strong><span>${new Date(order.created_at).toLocaleString('bg-BG')}</span>
      </div>
      ${order.delivery_address?`<p><strong>Адрес:</strong> ${escapeHtml(order.delivery_address)}</p>`:''}
      ${order.requested_time?`<p><strong>Желан час:</strong> ${escapeHtml(order.requested_time)}</p>`:''}
      ${order.note?`<p><strong>Бележка:</strong> ${escapeHtml(order.note)}</p>`:''}
      <ul>${(order.items||[]).map(item=>`<li>${item.quantity} × ${escapeHtml(item.product_name)} · ${formatPrice(item.line_total)}</li>`).join('')}</ul>
      <form class="status-form" data-order-number="${escapeHtml(order.order_number)}">
        <select>${Object.entries(statusLabels).map(([value,label])=>`<option value="${value}"${value===order.status?' selected':''}>${label}</option>`).join('')}</select>
        <button type="submit">Запази</button>
      </form>
    </article>
  `).join('');
}

async function loadOrders(){
  if(!token||isLoading) return;
  isLoading=true;
  message.textContent='Зареждаме поръчките...';
  try{
    const response=await fetch('/api/admin/orders',{headers:{'x-admin-token':token}});
    const result=await response.json();
    if(response.status===401) authenticated=false;
    if(!response.ok) throw new Error(result.error||'Поръчките не могат да бъдат заредени.');
    authenticated=true;
    renderOrders(result.orders);
    message.textContent=`Заредени поръчки: ${result.orders.length}`;
    secondsUntilRefresh=refreshIntervalSeconds;
  }catch(error){
    ordersContainer.innerHTML='';
    message.textContent=error.message;
  }finally{
    isLoading=false;
  }
}

document.querySelector('#adminLogin').addEventListener('submit',event=>{
  event.preventDefault();
  token=tokenInput.value.trim();
  authenticated=false;
  sessionStorage.setItem('diana-admin-token',token);
  loadOrders();
});
document.querySelector('#refreshOrders').addEventListener('click',loadOrders);
ordersContainer.addEventListener('submit',async event=>{
  const form=event.target.closest('.status-form');
  if(!form) return;
  event.preventDefault();
  const response=await fetch(`/api/admin/orders/${encodeURIComponent(form.dataset.orderNumber)}`,{
    method:'PATCH',
    headers:{'Content-Type':'application/json','x-admin-token':token},
    body:JSON.stringify({status:form.querySelector('select').value})
  });
  const result=await response.json();
  message.textContent=response.ok?`Статусът на ${result.orderNumber} е обновен.`:(result.error||'Грешка при обновяване.');
  if(response.ok) loadOrders();
});

setInterval(()=>{
  if(!token||!authenticated){
    refreshCountdown.textContent='Автоматичното обновяване ще започне след вход.';
    return;
  }
  if(document.hidden||isLoading){
    refreshCountdown.textContent=document.hidden?'Обновяването е на пауза, докато табът е скрит.':'Обновяваме поръчките...';
    return;
  }
  secondsUntilRefresh-=1;
  if(secondsUntilRefresh<=0) loadOrders();
  refreshCountdown.textContent=`Следващо автоматично обновяване след ${secondsUntilRefresh} сек.`;
},1000);

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&authenticated){
    secondsUntilRefresh=0;
  }
});

if(token) loadOrders();
