const $=(s,p=document)=>p.querySelector(s);
const $$=(s,p=document)=>[...p.querySelectorAll(s)];

const header=$('.header');
window.addEventListener('scroll',()=>header.classList.toggle('scrolled',scrollY>30));

const toggle=$('.menu-toggle');
const nav=$('.nav');
function setMenuOpen(open){
  nav.classList.toggle('open',open);
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'Затвори меню':'Отвори меню');
}
if(toggle){
  toggle.addEventListener('click',()=>{
    setMenuOpen(!nav.classList.contains('open'));
  });
}
$$('.nav a').forEach(a=>a.addEventListener('click',()=>setMenuOpen(false)));

const io=new IntersectionObserver(entries=>entries.forEach(e=>{
  if(e.isIntersecting){
    e.target.classList.add('in-view');
    if(e.target.matches('.stats')) countUp(e.target);
    io.unobserve(e.target);
  }
}),{threshold:.15});
$$('.reveal,.reveal-scale,.stats').forEach(el=>io.observe(el));

function countUp(box){
  $$('[data-count]',box).forEach(el=>{
    const end=+el.dataset.count;
    const start=performance.now();
    const dur=1300;
    function tick(t){
      const p=Math.min((t-start)/dur,1);
      el.textContent=Math.floor(end*(1-Math.pow(1-p,3)));
      if(p<1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

const glow=$('.cursor-glow');
if(glow){
  window.addEventListener('pointermove',e=>{
    glow.style.left=e.clientX+'px';
    glow.style.top=e.clientY+'px';
  });
}

window.addEventListener('scroll',()=>{
  $$('[data-parallax]').forEach(el=>{
    const r=el.getBoundingClientRect();
    const speed=+el.dataset.parallax;
    el.style.setProperty('--parallax-offset',`${(innerHeight/2-r.top)*speed}px`);
  });
},{passive:true});

$$('.tilt').forEach(card=>{
  card.addEventListener('pointermove',e=>{
    const r=card.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5;
    const y=(e.clientY-r.top)/r.height-.5;
    card.style.transform=`perspective(900px) rotateX(${-y*5}deg) rotateY(${x*6}deg) translateY(-4px)`;
  });
  card.addEventListener('pointerleave',()=>card.style.transform='');
});

$$('.tab').forEach(tab=>tab.addEventListener('click',()=>{
  $$('.tab').forEach(t=>{
    t.classList.remove('active');
    t.setAttribute('aria-pressed','false');
  });
  tab.classList.add('active');
  tab.setAttribute('aria-pressed','true');
  const f=tab.dataset.filter;
  $$('.menu-card').forEach(c=>c.classList.toggle('hidden',c.dataset.category!==f));
  $$('[data-section-category]').forEach(heading=>{
    const category=heading.dataset.sectionCategory;
    heading.classList.toggle('hidden',category!==f);
  });
}));

let current=0;
let reviews=$$('.review');
const idx=$('#reviewIndex');
function showReview(n){
  if(!reviews.length) return;
  reviews[current].classList.remove('active');
  current=(n+reviews.length)%reviews.length;
  reviews[current].classList.add('active');
  idx.textContent=`${String(current+1).padStart(2,'0')} / ${String(reviews.length).padStart(2,'0')}`;
}
$('#nextReview')?.addEventListener('click',()=>showReview(current+1));
$('#prevReview')?.addEventListener('click',()=>showReview(current-1));
if(reviews.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  setInterval(()=>{
    if(!document.hidden) showReview(current+1);
  },7000);
}

function createReviewElement(review,index){
  const article=document.createElement('article');
  article.className=`review${index===0?' active':''}`;

  const text=document.createElement('p');
  text.textContent=`„${review.text}“`;

  const footer=document.createElement('footer');
  const author=review.authorUri?document.createElement('a'):document.createElement('strong');
  author.textContent=review.author;
  if(review.authorUri){
    author.href=review.authorUri;
    author.target='_blank';
    author.rel='noopener';
  }

  const meta=document.createElement('span');
  const stars='★'.repeat(Math.max(0,Math.min(5,Math.round(review.rating))));
  meta.textContent=[stars,review.relativeTime].filter(Boolean).join(' · ');

  footer.append(author,meta);
  article.append(text,footer);
  return article;
}

function updateGoogleReviews(data){
  $$('[data-google-rating]').forEach(el=>el.textContent=Number(data.rating).toFixed(1));
  $$('[data-google-count]').forEach(el=>{
    el.textContent=data.userRatingCount;
    if(el.hasAttribute('data-count')) el.dataset.count=data.userRatingCount;
  });

  const mapsLink=$('#googleReviewsLink');
  if(data.googleMapsUri) mapsLink.href=data.googleMapsUri;

  const liveReviews=(data.reviews||[]).filter(review=>review.text);
  if(!liveReviews.length) return;

  reviews.forEach(review=>review.remove());
  const controls=$('.slider-controls');
  liveReviews.forEach((review,index)=>{
    controls.before(createReviewElement(review,index));
  });
  reviews=$$('.review');
  current=0;
  idx.textContent=`01 / ${String(reviews.length).padStart(2,'0')}`;
}

async function loadGoogleReviews(){
  try{
    const response=await fetch('/api/google-reviews',{cache:'no-store'});
    if(!response.ok) return;
    updateGoogleReviews(await response.json());
  }catch{
    // Keep the built-in reviews when the API or server is unavailable.
  }
}

loadGoogleReviews();
setInterval(loadGoogleReviews,15*60*1000);

$$('.magnetic').forEach(btn=>{
  btn.addEventListener('pointermove',e=>{
    const r=btn.getBoundingClientRect();
    btn.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.08}px,${(e.clientY-r.top-r.height/2)*.12}px)`;
  });
  btn.addEventListener('pointerleave',()=>btn.style.transform='');
});

const lightbox=$('#lightbox');
const lightboxImage=$('#lightboxImage');
const lightboxCaption=$('#lightboxCaption');
const closeLightbox=$('#closeLightbox');
let lightboxTrigger=null;

function openLightbox(image, caption=''){
  lightboxTrigger=document.activeElement;
  lightboxImage.src=image.src;
  lightboxImage.alt=image.alt||caption;
  lightboxCaption.textContent=caption || image.alt || '';
  lightbox.classList.add('open');
  lightbox.removeAttribute('inert');
  lightbox.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  closeLightbox.focus();
}
function closeLb(){
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden','true');
  lightbox.setAttribute('inert','');
  document.body.style.overflow='';
  lightboxTrigger?.focus();
  lightboxTrigger=null;
}
$$('[data-lightbox]').forEach(card=>{
  card.addEventListener('click',()=>{
    const image=$('img',card);
    const caption=($('h3',card)?.textContent || $('span',card)?.textContent || image.alt || '').trim();
    openLightbox(image,caption);
  });
});
closeLightbox?.addEventListener('click',closeLb);
lightbox?.addEventListener('click',e=>{ if(e.target===lightbox) closeLb(); });
window.addEventListener('keydown',e=>{
  if(!lightbox?.classList.contains('open')) return;
  if(e.key==='Escape') closeLb();
  if(e.key==='Tab'){
    e.preventDefault();
    closeLightbox.focus();
  }
});

const openCartButton=$('#openCart');
const closeCartButton=$('#closeCart');
const cartDrawer=$('#cartDrawer');
const cartBackdrop=$('#cartBackdrop');
const cartItems=$('#cartItems');
const cartCount=$('#cartCount');
const cartTotal=$('#cartTotal');
const orderForm=$('#orderForm');
const orderMessage=$('#orderMessage');
const deliveryAddressLabel=$('#deliveryAddressLabel');
const deliveryAddress=$('#deliveryAddress');
const trackOrderForm=$('#trackOrderForm');
const trackOrderResult=$('#trackOrderResult');
let cart=[];

try{
  cart=JSON.parse(localStorage.getItem('diana-cart'))||[];
}catch{
  cart=[];
}
cart=Array.isArray(cart)?cart.filter(item=>
  typeof item?.id==='string' &&
  typeof item?.name==='string' &&
  Number.isFinite(item?.price) &&
  Number.isInteger(item?.quantity) &&
  item.quantity>0
):[];

const formatPrice=value=>`${value.toFixed(2).replace('.',',')} лв.`;
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#039;'
})[char]);

function saveCart(){
  localStorage.setItem('diana-cart',JSON.stringify(cart));
}

function renderCart(){
  const count=cart.reduce((sum,item)=>sum+item.quantity,0);
  const total=cart.reduce((sum,item)=>sum+item.price*item.quantity,0);
  cartCount.textContent=count;
  cartCount.setAttribute('aria-label',`${count} продукта`);
  cartTotal.textContent=formatPrice(total);
  orderForm.querySelector('.order-submit').disabled=!cart.length;

  if(!cart.length){
    cartItems.innerHTML='<p class="cart-empty">Количката е празна. Добави нещо вкусно от менюто.</p>';
    saveCart();
    return;
  }

  cartItems.innerHTML=cart.map(item=>`
    <article class="cart-item">
      <div><strong>${escapeHtml(item.name)}</strong><span>${formatPrice(item.price)}</span></div>
      <div class="quantity-controls">
        <button type="button" data-cart-action="decrease" data-id="${escapeHtml(item.id)}" aria-label="Намали ${escapeHtml(item.name)}">−</button>
        <span>${item.quantity}</span>
        <button type="button" data-cart-action="increase" data-id="${escapeHtml(item.id)}" aria-label="Увеличи ${escapeHtml(item.name)}">+</button>
        <button class="remove-item" type="button" data-cart-action="remove" data-id="${escapeHtml(item.id)}">Премахни</button>
      </div>
    </article>
  `).join('');
  saveCart();
}

function openCart(){
  cartDrawer.classList.add('open');
  cartDrawer.removeAttribute('inert');
  cartDrawer.setAttribute('aria-hidden','false');
  cartBackdrop.hidden=false;
  openCartButton.setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';
  closeCartButton.focus();
}

function closeCart(){
  cartDrawer.classList.remove('open');
  cartDrawer.setAttribute('inert','');
  cartDrawer.setAttribute('aria-hidden','true');
  cartBackdrop.hidden=true;
  openCartButton.setAttribute('aria-expanded','false');
  document.body.style.overflow='';
  openCartButton.focus();
}

$$('.add-to-cart').forEach(button=>button.addEventListener('click',()=>{
  const product=button.closest('[data-id]');
  const existing=cart.find(item=>item.id===product.dataset.id);
  if(existing){
    existing.quantity+=1;
  }else{
    cart.push({
      id:product.dataset.id,
      name:product.dataset.name,
      price:Number(product.dataset.price),
      quantity:1
    });
  }
  renderCart();
  button.textContent='Добавено ✓';
  setTimeout(()=>button.textContent='Добави в количката',900);
}));

cartItems.addEventListener('click',event=>{
  const button=event.target.closest('[data-cart-action]');
  if(!button) return;
  const item=cart.find(entry=>entry.id===button.dataset.id);
  if(!item) return;
  if(button.dataset.cartAction==='increase') item.quantity+=1;
  if(button.dataset.cartAction==='decrease') item.quantity-=1;
  if(button.dataset.cartAction==='remove' || item.quantity<=0){
    cart=cart.filter(entry=>entry.id!==item.id);
  }
  renderCart();
});

openCartButton.addEventListener('click',openCart);
closeCartButton.addEventListener('click',closeCart);
cartBackdrop.addEventListener('click',closeCart);

$$('input[name="fulfillmentType"]').forEach(input=>input.addEventListener('change',()=>{
  const isDelivery=input.value==='delivery'&&input.checked;
  if(!isDelivery&&input.checked){
    deliveryAddressLabel.hidden=true;
    deliveryAddress.required=false;
  }
  if(isDelivery){
    deliveryAddressLabel.hidden=false;
    deliveryAddress.required=true;
  }
}));

const statusLabels={
  received:'Получена',
  confirmed:'Потвърдена',
  preparing:'Приготвя се',
  ready:'Готова',
  completed:'Приключена',
  cancelled:'Отказана'
};

orderForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!cart.length) return;
  const submitButton=orderForm.querySelector('.order-submit');
  const name=$('#customerName').value.trim();
  const email=$('#customerEmail').value.trim();
  const phone=$('#customerPhone').value.trim();
  const note=$('#orderNote').value.trim();
  const fulfillmentType=$('input[name="fulfillmentType"]:checked').value;
  orderMessage.textContent='Записваме поръчката...';
  submitButton.disabled=true;

  try{
    const response=await fetch('/api/orders',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        name,
        email,
        phone,
        note,
        fulfillmentType,
        address:deliveryAddress.value.trim(),
        requestedTime:$('#requestedTime').value,
        items:cart.map(item=>({id:item.id,quantity:item.quantity}))
      })
    });
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Поръчката не може да бъде записана.');

    orderMessage.textContent=`Поръчката е записана! Номер: ${result.orderNumber}. ${result.emailSent?'Изпратихме потвърждение по имейл.':'Потвърждението по имейл не беше изпратено.'}`;
    $('#trackOrderNumber').value=result.orderNumber;
    $('#trackOrderPhone').value=phone;
    cart=[];
    renderCart();
    orderForm.reset();
    deliveryAddressLabel.hidden=true;
    deliveryAddress.required=false;
  }catch(error){
    orderMessage.textContent=error.message;
  }finally{
    submitButton.disabled=!cart.length;
  }
});

trackOrderForm.addEventListener('submit',async event=>{
  event.preventDefault();
  trackOrderResult.textContent='Проверяваме...';
  const orderNumber=$('#trackOrderNumber').value.trim();
  const phone=$('#trackOrderPhone').value.trim();
  try{
    const response=await fetch(`/api/orders/${encodeURIComponent(orderNumber)}?phone=${encodeURIComponent(phone)}`);
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Поръчката не е намерена.');
    const method=result.fulfillment_type==='delivery'?'Доставка':'Вземане от място';
    trackOrderResult.textContent=`${statusLabels[result.status]||result.status} · ${method} · ${formatPrice(Number(result.total))}`;
  }catch(error){
    trackOrderResult.textContent=error.message;
  }
});

window.addEventListener('keydown',event=>{
  if(event.key==='Escape' && cartDrawer.classList.contains('open')) closeCart();
});

renderCart();

$('#year').textContent=new Date().getFullYear();
