const path=require('path');
const crypto=require('crypto');
const express=require('express');
const {rateLimit}=require('express-rate-limit');
require('dotenv').config();
const {pool}=require('./src/db');
const {products}=require('./src/catalog');
const {hashPassword,verifyPassword,createSession,optionalAuth,requireAuth,destroySession}=require('./src/auth');
const {
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  configured:emailConfigured,
  provider:emailProvider
}=require('./src/email');

const app=express();
const port=process.env.PORT||3000;
const publicDirectory=path.join(__dirname,'burger-bar-diana');

app.disable('x-powered-by');
app.use(express.json({limit:'100kb'}));
app.use(express.static(publicDirectory));
app.use(optionalAuth);

const orderStatuses=new Set(['received','confirmed','preparing','ready','completed','cancelled']);
const orderLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
const adminLimiter=rateLimit({windowMs:15*60*1000,limit:100,standardHeaders:'draft-8',legacyHeaders:false});
const authLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
const clean=value=>typeof value==='string'?value.trim():'';
const normalizePhone=value=>clean(value).replace(/[^\d+]/g,'');

function queueEmail(label,send){
  setImmediate(async()=>{
    try{
      await send();
    }catch(error){
      console.error(`${label} email could not be sent:`,error);
    }
  });
}

function createOrderNumber(){
  return `DIA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function requireAdmin(req,res,next){
  const expected=process.env.ADMIN_TOKEN;
  const supplied=req.get('x-admin-token');
  if(!expected||!supplied||supplied!==expected){
    return res.status(401).json({error:'Неоторизиран достъп.'});
  }
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
      user:{id:result.insertId,name,email,phone,default_address:null},
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
      'SELECT id,name,email,phone,default_address,password_hash FROM users WHERE email=? LIMIT 1',
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
    `SELECT order_number,status,total,fulfillment_type,delivery_address,requested_time,created_at,updated_at
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
      emailProvider
    });
  }catch{
    return res.status(503).json({status:'error',database:'disconnected'});
  }
});

app.post('/api/orders',orderLimiter,async(req,res)=>{
  const name=clean(req.body.name);
  const email=clean(req.body.email).toLowerCase();
  const phone=normalizePhone(req.body.phone);
  const fulfillmentType=req.body.fulfillmentType;
  const address=clean(req.body.address);
  const requestedTime=clean(req.body.requestedTime);
  const note=clean(req.body.note);
  const requestedItems=Array.isArray(req.body.items)?req.body.items:[];

  if(name.length<2||name.length>100) return res.status(400).json({error:'Въведи валидно име.'});
  if(!req.user&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Въведи валиден имейл за потвърждението.'});
  if(phone.length<7||phone.length>20) return res.status(400).json({error:'Въведи валиден телефон.'});
  if(!['pickup','delivery'].includes(fulfillmentType)) return res.status(400).json({error:'Избери начин на получаване.'});
  if(fulfillmentType==='delivery'&&(address.length<8||address.length>255)){
    return res.status(400).json({error:'Въведи валиден адрес за доставка.'});
  }
  if(note.length>500||requestedTime.length>50) return res.status(400).json({error:'Въведените данни са прекалено дълги.'});
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
       (user_id,order_number,customer_name,customer_phone,fulfillment_type,delivery_address,requested_time,note,total)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.user?.id||null,orderNumber,name,phone,fulfillmentType,fulfillmentType==='delivery'?address:null,requestedTime||null,note||null,total]
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
    if(req.user){
      await connection.execute(
        'INSERT INTO notifications (user_id,order_id,message) VALUES (?,?,?)',
        [req.user.id,savedOrderId,`Поръчка ${orderNumber} е получена.`]
      );
    }
    await connection.commit();
    connection.release();
    connection=null;
    const recipient=req.user?.email||email;
    if(recipient&&emailConfigured){
      queueEmail('Order confirmation',()=>sendOrderConfirmationEmail({
        to:recipient,
        name,
        orderNumber,
        total,
        items,
        fulfillmentType,
        address:fulfillmentType==='delivery'?address:'',
        requestedTime
      }));
    }
    return res.status(201).json({
      orderNumber,
      status:'received',
      total,
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
      `SELECT order_number,status,total,fulfillment_type,delivery_address,requested_time,created_at,updated_at
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
    const [orders]=await pool.execute(
      `SELECT id,order_number,customer_name,customer_phone,fulfillment_type,delivery_address,
              requested_time,note,status,total,created_at,updated_at
       FROM orders ORDER BY created_at DESC LIMIT 100`
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
    return res.json({orders});
  }catch(error){
    console.error('Could not load admin orders:',error);
    return res.status(503).json({error:'Поръчките не са достъпни в момента.'});
  }
});

app.patch('/api/admin/orders/:orderNumber',adminLimiter,requireAdmin,async(req,res)=>{
  const status=req.body.status;
  if(!orderStatuses.has(status)) return res.status(400).json({error:'Невалиден статус.'});
  try{
    const [orders]=await pool.execute('SELECT id,user_id FROM orders WHERE order_number=? LIMIT 1',[req.params.orderNumber]);
    if(!orders.length) return res.status(404).json({error:'Поръчката не е намерена.'});
    const order=orders[0];
    const [result]=await pool.execute(
      'UPDATE orders SET status=? WHERE id=?',
      [status,order.id]
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
