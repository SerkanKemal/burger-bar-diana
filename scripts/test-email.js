require('dotenv').config();
const {sendWelcomeEmail,configured}=require('../src/email');

async function main(){
  const to=process.env.EMAIL_TEST_TO||process.env.SMTP_USER;
  if(!configured) throw new Error('SMTP is not configured in .env.');
  if(!to) throw new Error('Set EMAIL_TEST_TO or SMTP_USER in .env.');
  const result=await sendWelcomeEmail({to,name:'Тестов клиент'});
  if(!result.sent) throw new Error(`Email test failed: ${result.reason}`);
  console.log(`Test email sent successfully to ${to}.`);
}

main().catch(error=>{
  console.error(error.message);
  process.exitCode=1;
});
