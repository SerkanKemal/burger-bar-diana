const path=require('path');
const crypto=require('crypto');
const express=require('express');
const Stripe=require('stripe');
const {rateLimit}=require('express-rate-limit');
require('dotenv').config();
const {pool}=require('./src/db');
const {products}=require('./src/catalog');
const {getOrderHoursStatus,isValidRequestedTime}=require('./src/opening-hours');
const {buildOrderFilter}=require('./src/order-filters');
const {hashPassword,verifyPassword,createSession,optionalAuth,requireAuth,destroySession}=require('./src/auth');
const {
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendPasswordResetEmail,
  configured:emailConfigured,
  provider:emailProvider
}=require('./src/email');

const app=express();
const port=process.env.PORT||3000;
const publicDirectory=path.join(__dirname,'burger-bar-diana');
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;

app.disable('x-powered-by');
app.set('trust proxy',1);
app.post('/api/stripe/webhook',express.raw({type:'application/json'}),async(req,res)=>{
  if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET){
    return res.status(503).send('Stripe webhook is not configured.');
  }
  let event;
  try{
    event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);
  }catch(error){
    console.error('Invalid Stripe webhook:',error.message);
    return res.status(400).send('Invalid webhook signature.');
  }
  try{
    const session=event.data.object;
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&session.payment_status==='paid'){
      await completeCardPayment(session);
    }
    if(['checkout.session.expired','checkout.session.async_payment_failed'].includes(event.type)){
      await pool.execute(
        "UPDATE orders SET payment_status='failed',status='cancelled' WHERE stripe_session_id=? AND payment_status='pending'",
        [session.id]
      );
    }
    return res.json({received:true});
  }catch(error){
    console.error('Stripe webhook processing failed:',error);
    return res.status(500).send('Webhook processing failed.');
  }
});
app.use(express.json({limit:'100kb'}));
app.use(express.static(publicDirectory));
app.use(optionalAuth);

const orderStatuses=new Set(['received','confirmed','preparing','ready','completed','cancelled']);
const orderLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
const adminLimiter=rateLimit({windowMs:15*60*1000,limit:100,standardHeaders:'draft-8',legacyHeaders:false});
const authLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
const clean=value=>typeof value==='string'?value.trim():'';
const normalizePhone=value=>clean(value).replace(/[^\d+]/g,'');
const hashToken=token=>crypto.createHash('sha256').update(token).digest('hex');

function queueEmail(label,send){
  setImmediate(async()=>{
    try{
      await send();
    }catch(error){
      console.error(`${label} email could not be sent:`,error);
    }
  });
}

async function completeCardPayment(session){
  const orderNumber=session.metadata?.orderNumber;
  if(!orderNumber) throw new Error('Stripe session does not contain an order number.');
  const [[order]]=await pool.execute(
    `SELECT id,user_id,order_number,customer_name,customer_email,fulfillment_type,
            delivery_address,requested_time,total,currency,payment_status,stripe_session_id
     FROM orders WHERE order_number=? LIMIT 1`,
    [orderNumber]
  );
  if(!order||order.payment_status==='paid') return;
  if(session.id!==order.stripe_session_id||session.currency?.toUpperCase()!==order.currency||
      session.amount_total!==Math.round(Number(order.total)*100)){
    throw new Error(`Stripe payment details do not match order ${orderNumber}.`);
  }
  const [result]=await pool.execute(
    `UPDATE orders SET payment_status='paid'
     WHERE order_number=? AND stripe_session_id=? AND payment_status='pending'`,
    [orderNumber,session.id]
  );
  if(!result.affectedRows) return;
  const [items]=await pool.execute(
    'SELECT product_name name,quantity,line_total lineTotal FROM order_items WHERE order_id=? ORDER BY id',
    [order.id]
  );
  if(order.user_id){
    await pool.execute(
      'INSERT INTO notifications (user_id,order_id,message) VALUES (?,?,?)',
      [order.user_id,order.id,`Плащането за поръчка ${orderNumber} е успешно.`]
    );
  }
  if(order.customer_email&&emailConfigured){
    queueEmail('Paid order confirmation',()=>sendOrderConfirmationEmail({
      to:order.customer_email,
      name:order.customer_name,
      orderNumber,
      total:order.total,
      currency:order.currency,
      items,
      fulfillmentType:order.fulfillment_type,
      address:order.delivery_address||'',
      requestedTime:order.requested_time||''
    }));
  }
}

function createOrderNumber(){
  return `DIA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function csvCell(value){
  let text=String(value??'');
  if(/^[=+\-@]/.test(text)) text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}

function csvDate(value){
  return new Intl.DateTimeFormat('bg-BG',{
    timeZone:'Europe/Sofia',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit'
  }).format(new Date(value));
}

function requireAdmin(req,res,next){
  if(!req.user) return res.status(401).json({error:'Влез с администраторския профил.'});
  if(req.user.role!=='admin') return res.status(403).json({error:'Този профил няма администраторски достъп.'});
  next();
}

app.post('/api/auth/register',authLimiter,async(req,res)=>{
  const name=clean(req.body.name);
  const email=clean(req.body.email).toLowerCase();
  const phone=normalizePhone(req.body.phone);
  const password=String(req.body.password||'');
  if(name.length<2||name.length>100) return res.status(400).json({error:'Въведи валидно име.'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190) return res.status(400).json({error:'Въведи валиден имейл.'});
  if(phone.length<7||phone.length>20) return res.status(400).json({error:'Въведи валиден телефон.'});
  if(password.length<8||password.length>100) return res.status(400).json({error:'Паролата трябва да бъде поне 8 символа.'});
  try{
    const passwordHash=await hashPassword(password);
    const [result]=await pool.execute(
      'INSERT INTO users (name,email,phone,password_hash) VALUES (?,?,?,?)',
      [name,email,phone,passwordHash]
    );
    await createSession(result.insertId,res);
    if(emailConfigured) queueEmail('Welcome',()=>sendWelcomeEmail({to:email,name}));
    return res.status(201).json({
      user:{id:result.insertId,name,email,phone,default_address:null,role:'customer'},
      emailQueued:emailConfigured
    });
  }catch(error){
    if(error.code==='ER_DUP_ENTRY') return res.status(409).json({error:'Вече има профил с този имейл.'});
    console.error('Could not register user:',error);
    return res.status(503).json({error:'Регистрацията не е достъпна в момента.'});
  }
});

app.post('/api/auth/login',authLimiter,async(req,res)=>{
  const email=clean(req.body.email).toLowerCase();
  const password=String(req.body.password||'');
  try{
    const [users]=await pool.execute(
      'SELECT id,name,email,phone,default_address,role,password_hash FROM users WHERE email=? LIMIT 1',
      [email]
    );
    const user=users[0];
    if(!user||!await verifyPassword(password,user.password_hash)){
      return res.status(401).json({error:'Грешен имейл или парола.'});
    }
    await createSession(user.id,res);
    delete user.password_hash;
    return res.json({user});
  }catch(error){
    console.error('Could not login user:',error);
    return res.status(503).json({error:'Входът не е достъпен в момента.'});
  }
});

app.post('/api/auth/forgot-password',authLimiter,async(req,res)=>{
  const email=clean(req.body.email).toLowerCase();
  const genericMessage='Ако има профил с този имейл, ще получиш линк за нова парола.';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190){
    return res.json({message:genericMessage});
  }
  try{
    const [users]=await pool.execute('SELECT id,name,email FROM users WHERE email=? LIMIT 1',[email]);
    const user=users[0];
    if(user&&emailConfigured){
      const token=crypto.randomBytes(32).toString('hex');
      await pool.execute('DELETE FROM password_reset_tokens WHERE user_id=? OR expires_at<NOW()',[user.id]);
      await pool.execute(
        'INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
        [user.id,hashToken(token)]
      );
      const resetUrl=`${req.protocol}://${req.get('host')}/reset-password.html?token=${encodeURIComponent(token)}`;
      queueEmail('Password reset',()=>sendPasswordResetEmail({to:user.email,name:user.name,resetUrl}));
    }
    return res.json({message:genericMessage});
  }catch(error){
    console.error('Could not create password reset:',error);
    return res.status(503).json({error:'Заявката не е достъпна в момента. Опитай отново.'});
  }
});

app.post('/api/auth/reset-password',authLimiter,async(req,res)=>{
  const token=clean(req.body.token);
  const password=String(req.body.password||'');
  if(!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({error:'Линкът за нова парола е невалиден.'});
  if(password.length<8||password.length>100) return res.status(400).json({error:'Паролата трябва да бъде поне 8 символа.'});
  let connection;
  try{
    connection=await pool.getConnection();
    await connection.beginTransaction();
    const [tokens]=await connection.execute(
      `SELECT id,user_id FROM password_reset_tokens
       WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW() LIMIT 1 FOR UPDATE`,
      [hashToken(token)]
    );
    const reset=tokens[0];
    if(!reset){
      await connection.rollback();
      return res.status(400).json({error:'Линкът е изтекъл или вече е използван.'});
    }
    const passwordHash=await hashPassword(password);
    await connection.execute('UPDATE users SET password_hash=? WHERE id=?',[passwordHash,reset.user_id]);
    await connection.execute('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=?',[reset.id]);
    await connection.execute('DELETE FROM user_sessions WHERE user_id=?',[reset.user_id]);
    await connection.commit();
    return res.json({message:'Паролата е сменена успешно. Вече можеш да влезеш.'});
  }catch(error){
    if(connection) await connection.rollback();
    console.error('Could not reset password:',error);
    return res.status(503).json({error:'Паролата не може да бъде сменена в момента.'});
  }finally{
    connection?.release();
  }
});

app.post('/api/auth/logout',async(req,res)=>{
  try{
    await destroySession(req,res);
    return res.status(204).end();
  }catch(error){
    return res.status(503).json({error:'Изходът не е достъпен в момента.'});
  }
});

app.get('/api/me',async(req,res)=>{
  if(!req.user) return res.json({user:null,unreadNotifications:0});
  const [[count]]=await pool.execute(
    'SELECT COUNT(*) unreadNotifications FROM notifications WHERE user_id=? AND is_read=FALSE',
    [req.user.id]
  );
  return res.json({user:req.user,unreadNotifications:count.unreadNotifications});
});

app.patch('/api/me',requireAuth,async(req,res)=>{
  const name=clean(req.body.name);
  const phone=normalizePhone(req.body.phone);
  const address=clean(req.body.defaultAddress);
  if(name.length<2||name.length>100||phone.length<7||phone.length>20||address.length>255){
    return res.status(400).json({error:'Провери данните в профила.'});
  }
  await pool.execute('UPDATE users SET name=?,phone=?,default_address=? WHERE id=?',[name,phone,address||null,req.user.id]);
  return res.json({user:{...req.user,name,phone,default_address:address||null}});
});

app.get('/api/me/orders',requireAuth,async(req,res)=>{
  const [orders]=await pool.execute(
    `SELECT order_number,status,total,currency,payment_method,payment_status,fulfillment_type,delivery_address,requested_time,created_at,updated_at
     FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  return res.json({orders});
});

app.get('/api/me/notifications',requireAuth,async(req,res)=>{
  const [notifications]=await pool.execute(
    `SELECT id,message,is_read,created_at FROM notifications
     WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50`,
    [req.user.id]
  );
  return res.json({notifications});
});

app.patch('/api/me/notifications/read',requireAuth,async(req,res)=>{
  await pool.execute('UPDATE notifications SET is_read=TRUE WHERE user_id=?',[req.user.id]);
  return res.status(204).end();
});

app.get('/api/health',async(req,res)=>{
  try{
    await pool.query('SELECT 1');
    return res.json({
      status:'ok',
      database:'connected',
      email:emailConfigured?'configured':'not_configured',
      emailProvider,
      stripe:stripe?'configured':'not_configured',
      stripeWebhook:process.env.STRIPE_WEBHOOK_SECRET?'configured':'not_configured'
    });
  }catch{
    return res.status(503).json({status:'error',database:'disconnected'});
  }
});

app.get('/api/order-hours',(req,res)=>{
  res.set('Cache-Control','no-store');
  return res.json(getOrderHoursStatus());
});

app.get('/api/payment-config',(req,res)=>{
  res.set('Cache-Control','no-store');
  return res.json({cardEnabled:Boolean(stripe&&process.env.STRIPE_WEBHOOK_SECRET)});
});

app.post('/api/orders',orderLimiter,async(req,res)=>{
  const name=clean(req.body.name);
  const email=clean(req.body.email).toLowerCase();
  const phone=normalizePhone(req.body.phone);
  const fulfillmentType=req.body.fulfillmentType;
  const paymentMethod=req.body.paymentMethod;
  const address=clean(req.body.address);
  const requestedTime=clean(req.body.requestedTime);
  const note=clean(req.body.note);
  const requestedItems=Array.isArray(req.body.items)?req.body.items:[];
  const orderHours=getOrderHoursStatus();

  if(!orderHours.open) return res.status(403).json({error:orderHours.message});
  if(name.length<2||name.length>100) return res.status(400).json({error:'Въведи валидно име.'});
  if(!req.user&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Въведи валиден имейл за потвърждението.'});
  if(phone.length<7||phone.length>20) return res.status(400).json({error:'Въведи валиден телефон.'});
  if(!['pickup','delivery'].includes(fulfillmentType)) return res.status(400).json({error:'Избери начин на получаване.'});
  if(!['cash','card'].includes(paymentMethod)) return res.status(400).json({error:'Избери начин на плащане.'});
  if(paymentMethod==='card'&&(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)){
    return res.status(503).json({error:'Плащането с карта още не е настроено.'});
  }
  if(fulfillmentType==='delivery'&&(address.length<8||address.length>255)){
    return res.status(400).json({error:'Въведи валиден адрес за доставка.'});
  }
  if(note.length>500||requestedTime.length>50) return res.status(400).json({error:'Въведените данни са прекалено дълги.'});
  if(!isValidRequestedTime(requestedTime)) return res.status(400).json({error:'Желаният час трябва да бъде между 11:30 и 22:30 ч.'});
  if(!requestedItems.length||requestedItems.length>50) return res.status(400).json({error:'Количката е празна или прекалено голяма.'});

  const items=[];
  for(const requestedItem of requestedItems){
    const product=products.get(requestedItem.id);
    const quantity=Number(requestedItem.quantity);
    if(!product||!Number.isInteger(quantity)||quantity<1||quantity>20){
      return res.status(400).json({error:'Количката съдържа невалиден продукт или количество.'});
    }
    items.push({
      id:requestedItem.id,
      name:product.name,
      price:product.price,
      quantity,
      lineTotal:Number((product.price*quantity).toFixed(2))
    });
  }

  const total=Number(items.reduce((sum,item)=>sum+item.lineTotal,0).toFixed(2));
  const orderNumber=createOrderNumber();
  let connection;
  let savedOrderId;

  try{
    connection=await pool.getConnection();
    await connection.beginTransaction();
    const [result]=await connection.execute(
      `INSERT INTO orders
       (user_id,order_number,customer_name,customer_email,customer_phone,fulfillment_type,delivery_address,
        requested_time,note,total,currency,payment_method,payment_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user?.id||null,orderNumber,name,req.user?.email||email,phone,fulfillmentType,
        fulfillmentType==='delivery'?address:null,requestedTime||null,note||null,total,'EUR',
        paymentMethod,'pending']
    );
    savedOrderId=result.insertId;
    for(const item of items){
      await connection.execute(
        `INSERT INTO order_items
         (order_id,product_id,product_name,unit_price,quantity,line_total)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId,item.id,item.name,item.price,item.quantity,item.lineTotal]
      );
    }
    if(req.user&&paymentMethod==='cash'){
      await connection.execute(
        'INSERT INTO notifications (user_id,order_id,message) VALUES (?,?,?)',
        [req.user.id,savedOrderId,`Поръчка ${orderNumber} е получена.`]
      );
    }
    await connection.commit();
    connection.release();
    connection=null;
    const recipient=req.user?.email||email;
    if(paymentMethod==='card'){
      try{
        const baseUrl=`${req.protocol}://${req.get('host')}`;
        const session=await stripe.checkout.sessions.create({
          mode:'payment',
          locale:'bg',
          customer_email:recipient,
          line_items:items.map(item=>({
            quantity:item.quantity,
            price_data:{
              currency:'eur',
              unit_amount:Math.round(item.price*100),
              product_data:{name:item.name}
            }
          })),
          metadata:{orderNumber},
          payment_intent_data:{metadata:{orderNumber}},
          success_url:`${baseUrl}/?payment=success&order=${encodeURIComponent(orderNumber)}`,
          cancel_url:`${baseUrl}/?payment=cancelled&order=${encodeURIComponent(orderNumber)}`
        });
        await pool.execute('UPDATE orders SET stripe_session_id=? WHERE id=?',[session.id,savedOrderId]);
        return res.status(201).json({
          orderNumber,
          status:'received',
          paymentStatus:'pending',
          total,
          currency:'EUR',
          checkoutUrl:session.url
        });
      }catch(error){
        await pool.execute("UPDATE orders SET payment_status='failed',status='cancelled' WHERE id=?",[savedOrderId]);
        console.error('Could not create Stripe Checkout session:',error);
        return res.status(503).json({error:'Платежната страница не може да бъде отворена в момента. Опитай отново.'});
      }
    }
    if(recipient&&emailConfigured){
      queueEmail('Order confirmation',()=>sendOrderConfirmationEmail({
        to:recipient,
        name,
        orderNumber,
        total,
        currency:'EUR',
        items,
        fulfillmentType,
        address:fulfillmentType==='delivery'?address:'',
        requestedTime
      }));
    }
    return res.status(201).json({
      orderNumber,
      status:'received',
      paymentStatus:'pending',
      total,
      currency:'EUR',
      emailQueued:Boolean(recipient&&emailConfigured)
    });
  }catch(error){
    if(connection) await connection.rollback();
    console.error('Could not save order:',error);
    return res.status(503).json({error:'Поръчката не може да бъде записана в момента. Опитай отново.'});
  }finally{
    connection?.release();
  }
});

app.get('/api/orders/:orderNumber',orderLimiter,async(req,res)=>{
  const phone=normalizePhone(req.query.phone);
  if(phone.length<7) return res.status(400).json({error:'Въведи телефона от поръчката.'});
  try{
    const [orders]=await pool.execute(
      `SELECT order_number,status,total,currency,payment_method,payment_status,fulfillment_type,delivery_address,requested_time,created_at,updated_at
       FROM orders WHERE order_number=? AND customer_phone=? LIMIT 1`,
      [req.params.orderNumber,phone]
    );
    if(!orders.length) return res.status(404).json({error:'Поръчката не е намерена.'});
    return res.json(orders[0]);
  }catch(error){
    console.error('Could not load order:',error);
    return res.status(503).json({error:'Статусът не е достъпен в момента.'});
  }
});

app.get('/api/admin/orders',adminLimiter,requireAdmin,async(req,res)=>{
  try{
    const filter=buildOrderFilter(clean(req.query.filter));
    const [orders]=await pool.execute(
      `SELECT id,order_number,customer_name,customer_phone,fulfillment_type,delivery_address,
              requested_time,note,status,total,currency,payment_method,payment_status,created_at,updated_at
       FROM orders ${filter.where} ORDER BY created_at DESC LIMIT 500`,
      filter.values
    );
    if(orders.length){
      const ids=orders.map(order=>order.id);
      const placeholders=ids.map(()=>'?').join(',');
      const [items]=await pool.execute(
        `SELECT order_id,product_name,unit_price,quantity,line_total
         FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`,
        ids
      );
      orders.forEach(order=>{
        order.items=items.filter(item=>item.order_id===order.id).map(({order_id,...item})=>item);
        delete order.id;
      });
    }
    return res.json({orders,filter:filter.selected});
  }catch(error){
    console.error('Could not load admin orders:',error);
    return res.status(503).json({error:'Поръчките не са достъпни в момента.'});
  }
});

app.get('/api/admin/orders.csv',adminLimiter,requireAdmin,async(req,res)=>{
  try{
    const filter=buildOrderFilter(clean(req.query.filter));
    const [rows]=await pool.execute(
      `SELECT o.id,o.order_number,o.customer_name,o.customer_phone,o.fulfillment_type,
              o.delivery_address,o.requested_time,o.note,o.status,o.total,o.currency,
              o.payment_method,o.payment_status,o.created_at,
              GROUP_CONCAT(CONCAT(oi.quantity,' x ',oi.product_name,' (',oi.line_total,' ',o.currency,')')
                ORDER BY oi.id SEPARATOR ' | ') items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id=o.id
       ${filter.where}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 5000`,
      filter.values
    );
    const statusLabels={received:'Получена',confirmed:'Потвърдена',preparing:'Приготвя се',ready:'Готова',completed:'Приключена',cancelled:'Отказана'};
    const header=['Номер','Дата','Клиент','Телефон','Получаване','Адрес','Желан час','Статус','Плащане','Платежен статус','Продукти','Бележка','Общо','Валута'];
    const lines=[header,...rows.map(order=>[
      order.order_number,
      csvDate(order.created_at),
      order.customer_name,
      order.customer_phone,
      order.fulfillment_type==='delivery'?'Доставка':'Вземане от място',
      order.delivery_address||'',
      order.requested_time||'',
      statusLabels[order.status]||order.status,
      order.payment_method==='card'?'Карта':'В брой',
      order.payment_method==='cash'?(order.payment_status==='paid'?'Платена в брой':'При получаване'):order.payment_status,
      order.items||'',
      order.note||'',
      Number(order.total).toFixed(2),
      order.currency
    ])].map(row=>row.map(csvCell).join(';'));
    const date=new Date().toISOString().slice(0,10);
    res.set({
      'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="burger-diana-orders-${filter.selected}-${date}.csv"`,
      'Cache-Control':'no-store'
    });
    return res.send(`\uFEFF${lines.join('\r\n')}`);
  }catch(error){
    console.error('Could not export admin orders:',error);
    return res.status(503).json({error:'CSV файлът не може да бъде създаден в момента.'});
  }
});

app.patch('/api/admin/orders/:orderNumber',adminLimiter,requireAdmin,async(req,res)=>{
  const status=req.body.status;
  if(!orderStatuses.has(status)) return res.status(400).json({error:'Невалиден статус.'});
  try{
    const [orders]=await pool.execute('SELECT id,user_id,payment_method,payment_status FROM orders WHERE order_number=? LIMIT 1',[req.params.orderNumber]);
    if(!orders.length) return res.status(404).json({error:'Поръчката не е намерена.'});
    const order=orders[0];
    if(order.payment_method==='card'&&order.payment_status!=='paid'&&status!=='cancelled'){
      return res.status(409).json({error:'Поръчката не може да се обработва, преди плащането с карта да бъде потвърдено.'});
    }
    const [result]=await pool.execute(
      `UPDATE orders
       SET status=?,payment_status=IF(payment_method='cash' AND ?='completed','paid',payment_status)
       WHERE id=?`,
      [status,status,order.id]
    );
    if(order.user_id){
      const labels={received:'получена',confirmed:'потвърдена',preparing:'се приготвя',ready:'е готова',completed:'е приключена',cancelled:'е отказана'};
      await pool.execute(
        'INSERT INTO notifications (user_id,order_id,message) VALUES (?,?,?)',
        [order.user_id,order.id,`Поръчка ${req.params.orderNumber} ${labels[status]}.`]
      );
    }
    if(!result.affectedRows) return res.status(404).json({error:'Поръчката не е намерена.'});
    return res.json({orderNumber:req.params.orderNumber,status});
  }catch(error){
    console.error('Could not update order:',error);
    return res.status(503).json({error:'Статусът не може да бъде променен в момента.'});
  }
});

app.get('/api/google-reviews',async(req,res)=>{
  const apiKey=process.env.GOOGLE_PLACES_API_KEY;
  const placeId=process.env.GOOGLE_PLACE_ID;

  if(!apiKey||!placeId){
    return res.status(503).json({
      error:'Google Places API is not configured.'
    });
  }

  try{
    const response=await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=bg`,
      {
        headers:{
          'X-Goog-Api-Key':apiKey,
          'X-Goog-FieldMask':'rating,userRatingCount,reviews,googleMapsUri'
        }
      }
    );

    if(!response.ok){
      const details=await response.text();
      console.error('Google Places API error:',response.status,details);
      return res.status(502).json({error:'Google reviews are temporarily unavailable.'});
    }

    const place=await response.json();
    const reviews=(place.reviews||[]).map(review=>({
      author:review.authorAttribution?.displayName||'Google потребител',
      authorUri:review.authorAttribution?.uri||'',
      photoUri:review.authorAttribution?.photoUri||'',
      rating:review.rating||0,
      text:review.text?.text||review.originalText?.text||'',
      relativeTime:review.relativePublishTimeDescription||'',
      publishTime:review.publishTime||''
    }));

    res.set('Cache-Control','no-store');
    return res.json({
      rating:place.rating||0,
      userRatingCount:place.userRatingCount||0,
      googleMapsUri:place.googleMapsUri||'',
      reviews,
      updatedAt:new Date().toISOString()
    });
  }catch(error){
    console.error('Could not load Google reviews:',error);
    return res.status(502).json({error:'Google reviews are temporarily unavailable.'});
  }
});

app.get('*path',(req,res)=>{
  res.sendFile(path.join(publicDirectory,'index.html'));
});

app.listen(port,()=>{
  console.log(`Burger Bar Diana is running at http://localhost:${port}`);
});
