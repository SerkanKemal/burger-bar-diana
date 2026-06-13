const accountDrawer=document.querySelector('#accountDrawer');
const accountBackdrop=document.querySelector('#accountBackdrop');
const openAccountButton=document.querySelector('#openAccount');
const closeAccountButton=document.querySelector('#closeAccount');
const guestAccount=document.querySelector('#guestAccount');
const userAccount=document.querySelector('#userAccount');
const authMessage=document.querySelector('#authMessage');
const profileMessage=document.querySelector('#profileMessage');
const notificationCount=document.querySelector('#notificationCount');
const adminProfileLink=document.querySelector('#adminProfileLink');
const accountStatusLabels={received:'Получена',confirmed:'Потвърдена',preparing:'Приготвя се',ready:'Готова',completed:'Приключена',cancelled:'Отказана'};
let currentUser=null;

const accountEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
})[char]);
const accountPrice=(value,currency='BGN')=>new Intl.NumberFormat('bg-BG',{
  style:'currency',
  currency
}).format(Number(value));

function openAccount(){
  accountDrawer.classList.add('open');
  accountDrawer.removeAttribute('inert');
  accountDrawer.setAttribute('aria-hidden','false');
  accountBackdrop.hidden=false;
  openAccountButton.setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';
  closeAccountButton.focus();
  if(currentUser) loadMe();
}

function closeAccount(){
  accountDrawer.classList.remove('open');
  accountDrawer.setAttribute('inert','');
  accountDrawer.setAttribute('aria-hidden','true');
  accountBackdrop.hidden=true;
  openAccountButton.setAttribute('aria-expanded','false');
  document.body.style.overflow='';
  openAccountButton.focus();
}

function prefillCheckout(user){
  if(!user) return;
  document.querySelector('#customerName').value=user.name||'';
  document.querySelector('#customerEmail').value=user.email||'';
  document.querySelector('#customerPhone').value=user.phone||'';
  if(user.default_address) document.querySelector('#deliveryAddress').value=user.default_address;
}

function renderAccountState(user,unread=0){
  currentUser=user;
  guestAccount.hidden=!!user;
  userAccount.hidden=!user;
  notificationCount.textContent=unread;
  notificationCount.hidden=!unread;
  adminProfileLink.hidden=user?.role!=='admin';
  openAccountButton.childNodes[0].textContent=user?`${user.name} `:'Профил ';
  if(!user) return;
  const form=document.querySelector('#profileForm');
  form.elements.name.value=user.name;
  form.elements.email.value=user.email;
  form.elements.phone.value=user.phone;
  form.elements.defaultAddress.value=user.default_address||'';
  prefillCheckout(user);
}

async function request(url,options={}){
  const response=await fetch(url,{
    ...options,
    headers:{'Content-Type':'application/json',...(options.headers||{})}
  });
  const result=response.status===204?null:await response.json();
  if(!response.ok) throw new Error(result?.error||'Възникна грешка.');
  return result;
}

async function loadProfileContent(){
  if(!currentUser) return;
  const [ordersResult,notificationsResult]=await Promise.all([
    request('/api/me/orders'),
    request('/api/me/notifications')
  ]);
  const orders=document.querySelector('#profileOrders');
  orders.innerHTML=ordersResult.orders.length?ordersResult.orders.map(order=>`
    <article><strong>${accountEscape(order.order_number)}</strong><span>${accountEscape(accountStatusLabels[order.status]||order.status)} · ${accountPrice(order.total,order.currency)}</span></article>
  `).join(''):'<p>Няма поръчки.</p>';
  const notifications=document.querySelector('#profileNotifications');
  notifications.innerHTML=notificationsResult.notifications.length?notificationsResult.notifications.map(item=>`
    <article class="${item.is_read?'':'unread'}"><strong>${accountEscape(item.message)}</strong><span>${new Date(item.created_at).toLocaleString('bg-BG')}</span></article>
  `).join(''):'<p>Няма известия.</p>';
}

async function loadMe(){
  try{
    const result=await request('/api/me');
    renderAccountState(result.user,result.unreadNotifications);
    if(result.user) await loadProfileContent();
  }catch{
    renderAccountState(null);
  }
}

document.querySelectorAll('[data-auth-view]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('[data-auth-view]').forEach(item=>item.classList.toggle('active',item===button));
  document.querySelector('#loginForm').hidden=button.dataset.authView!=='login';
  document.querySelector('#registerForm').hidden=button.dataset.authView!=='register';
  document.querySelector('#forgotPasswordForm').hidden=true;
  authMessage.textContent='';
}));

document.querySelector('#showForgotPassword').addEventListener('click',()=>{
  document.querySelector('#loginForm').hidden=true;
  document.querySelector('#registerForm').hidden=true;
  document.querySelector('#forgotPasswordForm').hidden=false;
  authMessage.textContent='';
});

document.querySelector('#backToLogin').addEventListener('click',()=>{
  document.querySelector('#forgotPasswordForm').hidden=true;
  document.querySelector('#loginForm').hidden=false;
  authMessage.textContent='';
});

document.querySelector('#forgotPasswordForm').addEventListener('submit',async event=>{
  event.preventDefault();
  authMessage.textContent='Изпращаме линк...';
  try{
    const form=new FormData(event.currentTarget);
    const result=await request('/api/auth/forgot-password',{method:'POST',body:JSON.stringify(Object.fromEntries(form))});
    authMessage.textContent=result.message;
    event.currentTarget.reset();
  }catch(error){authMessage.textContent=error.message;}
});

document.querySelector('#loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  authMessage.textContent='Влизаме...';
  try{
    const form=new FormData(event.currentTarget);
    const result=await request('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(form))});
    renderAccountState(result.user);
    await loadProfileContent();
    authMessage.textContent='';
  }catch(error){authMessage.textContent=error.message;}
});

document.querySelector('#registerForm').addEventListener('submit',async event=>{
  event.preventDefault();
  authMessage.textContent='Създаваме профила...';
  try{
    const form=new FormData(event.currentTarget);
    const result=await request('/api/auth/register',{method:'POST',body:JSON.stringify(Object.fromEntries(form))});
    renderAccountState(result.user);
    await loadProfileContent();
    authMessage.textContent='';
    profileMessage.textContent=result.emailQueued?'Приветственият имейл се изпраща.':'Профилът е създаден, но имейлите не са настроени.';
  }catch(error){authMessage.textContent=error.message;}
});

document.querySelector('#profileForm').addEventListener('submit',async event=>{
  event.preventDefault();
  profileMessage.textContent='Запазваме...';
  try{
    const form=new FormData(event.currentTarget);
    const result=await request('/api/me',{method:'PATCH',body:JSON.stringify(Object.fromEntries(form))});
    renderAccountState(result.user);
    profileMessage.textContent='Профилът е запазен.';
  }catch(error){profileMessage.textContent=error.message;}
});

document.querySelector('#logoutButton').addEventListener('click',async()=>{
  await request('/api/auth/logout',{method:'POST'});
  renderAccountState(null);
  profileMessage.textContent='';
});

document.querySelector('#markNotificationsRead').addEventListener('click',async()=>{
  await request('/api/me/notifications/read',{method:'PATCH'});
  notificationCount.hidden=true;
  await loadProfileContent();
});

openAccountButton.addEventListener('click',openAccount);
closeAccountButton.addEventListener('click',closeAccount);
accountBackdrop.addEventListener('click',closeAccount);
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&accountDrawer.classList.contains('open')) closeAccount();});

loadMe();
setInterval(()=>{
  if(currentUser&&!document.hidden&&!accountDrawer.classList.contains('open')) loadMe();
},60*1000);
