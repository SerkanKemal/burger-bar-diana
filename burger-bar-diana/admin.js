const ordersContainer=document.querySelector('#adminOrders');
const message=document.querySelector('#adminMessage');
const loginForm=document.querySelector('#adminLogin');
const logoutButton=document.querySelector('#adminLogout');
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
let secondsUntilRefresh=refreshIntervalSeconds;
let isLoading=false;
let authenticated=false;

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
})[char]);
const formatPrice=value=>`${Number(value).toFixed(2).replace('.',',')} лв.`;

async function request(url,options={}){
  const response=await fetch(url,{
    ...options,
    headers:{'Content-Type':'application/json',...(options.headers||{})}
  });
  const result=response.status===204?null:await response.json();
  if(!response.ok) throw new Error(result?.error||'Възникна грешка.');
  return result;
}

function setAuthenticated(value){
  authenticated=value;
  loginForm.hidden=value;
  logoutButton.hidden=!value;
  if(!value) ordersContainer.innerHTML='';
}

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
  if(!authenticated||isLoading) return;
  isLoading=true;
  message.textContent='Зареждаме поръчките...';
  try{
    const result=await request('/api/admin/orders');
    renderOrders(result.orders);
    message.textContent=`Заредени поръчки: ${result.orders.length}`;
    secondsUntilRefresh=refreshIntervalSeconds;
  }catch(error){
    setAuthenticated(false);
    message.textContent=error.message;
  }finally{
    isLoading=false;
  }
}

async function checkAccess(){
  try{
    const result=await request('/api/me');
    if(result.user?.role!=='admin') throw new Error('Влез с администраторския профил.');
    setAuthenticated(true);
    await loadOrders();
  }catch(error){
    setAuthenticated(false);
    message.textContent=error.message;
  }
}

loginForm.addEventListener('submit',async event=>{
  event.preventDefault();
  message.textContent='Влизаме...';
  try{
    const form=new FormData(loginForm);
    const result=await request('/api/auth/login',{
      method:'POST',
      body:JSON.stringify(Object.fromEntries(form))
    });
    if(result.user.role!=='admin') throw new Error('Този профил няма администраторски достъп.');
    loginForm.reset();
    setAuthenticated(true);
    await loadOrders();
  }catch(error){
    setAuthenticated(false);
    message.textContent=error.message;
  }
});

logoutButton.addEventListener('click',async()=>{
  await request('/api/auth/logout',{method:'POST'});
  setAuthenticated(false);
  message.textContent='Излезе от администраторския профил.';
});

document.querySelector('#refreshOrders').addEventListener('click',loadOrders);
ordersContainer.addEventListener('submit',async event=>{
  const form=event.target.closest('.status-form');
  if(!form) return;
  event.preventDefault();
  try{
    const result=await request(`/api/admin/orders/${encodeURIComponent(form.dataset.orderNumber)}`,{
      method:'PATCH',
      body:JSON.stringify({status:form.querySelector('select').value})
    });
    message.textContent=`Статусът на ${result.orderNumber} е обновен.`;
    await loadOrders();
  }catch(error){
    message.textContent=error.message;
  }
});

setInterval(()=>{
  if(!authenticated){
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
  if(!document.hidden&&authenticated) secondsUntilRefresh=0;
});

checkAccess();
