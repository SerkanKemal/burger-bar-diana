require('dotenv').config();
const {pool}=require('../src/db');

async function main(){
  const email=String(process.argv[2]||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    throw new Error('Usage: npm run admin:promote -- admin@example.com');
  }
  const [result]=await pool.execute("UPDATE users SET role='admin' WHERE email=?",[email]);
  if(!result.affectedRows) throw new Error('No registered profile was found with that email.');
  console.log(`The profile ${email} is now an administrator.`);
}

main()
  .catch(error=>{
    console.error(error.message);
    process.exitCode=1;
  })
  .finally(()=>pool.end());
