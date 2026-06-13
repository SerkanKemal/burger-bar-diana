const nodemailer=require('nodemailer');

const smtpConfigured=Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD);
const fromValue=process.env.EMAIL_FROM||`Burger Bar Diana <${process.env.SMTP_USER||''}>`;
const fromMatch=fromValue.match(/^(.*?)\s*<([^>]+)>$/);
const sender={
  name:(fromMatch?.[1]||'Burger Bar Diana').trim(),
  email:(fromMatch?.[2]||fromValue).trim()
};
const apiConfigured=Boolean(process.env.BREVO_API_KEY&&sender.email);
const configured=apiConfigured||smtpConfigured;
const provider=apiConfigured?'brevo':smtpConfigured?'smtp':'none';
const transporter=smtpConfigured?nodemailer.createTransport({
  host:process.env.SMTP_HOST,
  port:Number(process.env.SMTP_PORT||587),
  secure:String(process.env.SMTP_SECURE).toLowerCase()==='true',
  auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},
  connectionTimeout:10000,
  greetingTimeout:10000,
  socketTimeout:20000
}):null;

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
})[char]);
const formatPrice=(value,currency='EUR')=>new Intl.NumberFormat('bg-BG',{
  style:'currency',
  currency
}).format(Number(value));

function layout(title,content){
  return `<!doctype html><html lang="bg"><body style="margin:0;background:#f4f0e7;font-family:Arial,sans-serif;color:#151512">
    <div style="max-width:620px;margin:0 auto;padding:32px 18px">
      <div style="background:#151512;color:#fff;border-radius:20px 20px 0 0;padding:24px"><strong style="font-size:22px">Burger Bar &amp; Bagel Diana</strong></div>
      <div style="background:#fff;border-radius:0 0 20px 20px;padding:28px">
        <h1 style="font-size:28px;margin:0 0 18px;color:#ff5b2d">${escapeHtml(title)}</h1>${content}
        <p style="margin:28px 0 0;font-size:12px;color:#706d65">Burger Bar &amp; Bagel Diana · Балчик · 089 526 5217</p>
      </div>
    </div></body></html>`;
}

async function sendMail(message){
  if(apiConfigured){
    try{
      const response=await fetch('https://api.brevo.com/v3/smtp/email',{
        method:'POST',
        headers:{
          'accept':'application/json',
          'api-key':process.env.BREVO_API_KEY,
          'content-type':'application/json'
        },
        body:JSON.stringify({
          sender,
          to:[{email:message.to}],
          subject:message.subject,
          textContent:message.text,
          htmlContent:message.html
        }),
        signal:AbortSignal.timeout(20000)
      });
      if(!response.ok){
        const details=await response.text();
        throw new Error(`Brevo API ${response.status}: ${details}`);
      }
      return {sent:true,provider:'brevo'};
    }catch(error){
      console.error('Email could not be sent with Brevo:',error.message);
      return {sent:false,reason:'send_failed'};
    }
  }
  if(!transporter){
    console.warn('Email skipped: SMTP is not configured.');
    return {sent:false,reason:'not_configured'};
  }
  try{
    await transporter.sendMail({
      from:fromValue,
      ...message
    });
    return {sent:true,provider:'smtp'};
  }catch(error){
    console.error('Email could not be sent:',error.message);
    return {sent:false,reason:'send_failed'};
  }
}

function sendWelcomeEmail({to,name}){
  return sendMail({
    to,
    subject:'Добре дошли в Burger Bar & Bagel Diana!',
    text:`Здравейте, ${name}! Благодарим Ви, че се регистрирахте в Burger Bar & Bagel Diana.`,
    html:layout('Добре дошли!',`
      <p style="font-size:17px;line-height:1.7">Здравейте, <strong>${escapeHtml(name)}</strong>!</p>
      <p style="font-size:16px;line-height:1.7">Благодарим Ви, че се регистрирахте в нашия сайт. В профила си можете да следите поръчките и известията за техния статус.</p>
      <p style="font-size:16px;line-height:1.7">Очакваме Ви за нещо вкусно!</p>
    `)
  });
}

function sendOrderConfirmationEmail({to,name,orderNumber,total,currency='EUR',items,fulfillmentType,address,requestedTime}){
  const itemText=items.map(item=>`${item.quantity} x ${item.name} - ${formatPrice(item.lineTotal,currency)}`).join('\n');
  const itemRows=items.map(item=>`<tr><td style="padding:8px 0">${item.quantity} × ${escapeHtml(item.name)}</td><td style="padding:8px 0;text-align:right">${formatPrice(item.lineTotal,currency)}</td></tr>`).join('');
  const method=fulfillmentType==='delivery'?'Доставка':'Вземане от място';
  return sendMail({
    to,
    subject:`Поръчка ${orderNumber} е получена`,
    text:`Здравейте, ${name}! Поръчката Ви ${orderNumber} е записана успешно.\n${itemText}\nОбщо: ${formatPrice(total,currency)}\nПолучаване: ${method}`,
    html:layout('Поръчката е получена!',`
      <p style="font-size:16px;line-height:1.7">Здравейте, <strong>${escapeHtml(name)}</strong>! Благодарим Ви за поръчката.</p>
      <p style="font-size:16px"><strong>Номер:</strong> ${escapeHtml(orderNumber)}<br><strong>Получаване:</strong> ${method}${requestedTime?`<br><strong>Желан час:</strong> ${escapeHtml(requestedTime)}`:''}${address?`<br><strong>Адрес:</strong> ${escapeHtml(address)}`:''}</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #ddd;border-bottom:1px solid #ddd">${itemRows}</table>
      <p style="font-size:20px;text-align:right"><strong>Общо: ${formatPrice(total,currency)}</strong></p>
      <p style="font-size:13px;color:#706d65">Поръчката влиза в сила след потвърждение от заведението.</p>
    `)
  });
}

function sendPasswordResetEmail({to,name,resetUrl}){
  return sendMail({
    to,
    subject:'Нова парола за Burger Bar & Bagel Diana',
    text:`Здравейте, ${name}! Отворете този линк до 30 минути, за да зададете нова парола: ${resetUrl}`,
    html:layout('Задаване на нова парола',`
      <p style="font-size:16px;line-height:1.7">Здравейте, <strong>${escapeHtml(name)}</strong>!</p>
      <p style="font-size:16px;line-height:1.7">Получихме заявка за нова парола. Линкът е валиден 30 минути и може да бъде използван само веднъж.</p>
      <p style="margin:26px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#ff5b2d;color:#fff;text-decoration:none;padding:14px 20px;border-radius:10px;font-weight:700">Задай нова парола</a></p>
      <p style="font-size:13px;line-height:1.6;color:#706d65">Ако не сте поискали промяната, можете да пренебрегнете този имейл.</p>
    `)
  });
}

module.exports={sendWelcomeEmail,sendOrderConfirmationEmail,sendPasswordResetEmail,configured,provider};
