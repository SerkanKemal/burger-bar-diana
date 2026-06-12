const form=document.querySelector('#resetPasswordForm');
const message=document.querySelector('#resetMessage');
const token=new URLSearchParams(location.search).get('token')||'';

if(!token){
  form.hidden=true;
  message.textContent='Линкът за нова парола е невалиден.';
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  const data=new FormData(form);
  if(data.get('password')!==data.get('confirmPassword')){
    message.textContent='Двете пароли не съвпадат.';
    return;
  }
  const button=form.querySelector('button');
  button.disabled=true;
  message.textContent='Сменяме паролата...';
  try{
    const response=await fetch('/api/auth/reset-password',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token,password:data.get('password')})
    });
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'Паролата не може да бъде сменена.');
    form.hidden=true;
    message.textContent=result.message;
  }catch(error){
    message.textContent=error.message;
    button.disabled=false;
  }
});
