const crypto=require('crypto');
const {promisify}=require('util');
const {pool}=require('./db');

const scrypt=promisify(crypto.scrypt);
const sessionCookie='diana_session';

async function hashPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const derived=await scrypt(password,salt,64);
  return `${salt}:${derived.toString('hex')}`;
}

async function verifyPassword(password,stored){
  const [salt,hash]=String(stored).split(':');
  if(!salt||!hash) return false;
  const derived=await scrypt(password,salt,64);
  return crypto.timingSafeEqual(Buffer.from(hash,'hex'),derived);
}

const hashToken=token=>crypto.createHash('sha256').update(token).digest('hex');

function readCookies(req){
  return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(part=>{
    const index=part.indexOf('=');
    return [part.slice(0,index).trim(),decodeURIComponent(part.slice(index+1))];
  }));
}

async function createSession(userId,res){
  const token=crypto.randomBytes(32).toString('hex');
  await pool.execute(
    'INSERT INTO user_sessions (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))',
    [userId,hashToken(token)]
  );
  res.cookie(sessionCookie,token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:30*24*60*60*1000,path:'/'});
}

async function optionalAuth(req,res,next){
  const token=readCookies(req)[sessionCookie];
  if(!token) return next();
  try{
    const [users]=await pool.execute(
      `SELECT u.id,u.name,u.email,u.phone,u.default_address
       FROM user_sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1`,
      [hashToken(token)]
    );
    req.user=users[0]||null;
  }catch(error){
    return next(error);
  }
  next();
}

function requireAuth(req,res,next){
  if(!req.user) return res.status(401).json({error:'Влез в профила си, за да продължиш.'});
  next();
}

async function destroySession(req,res){
  const token=readCookies(req)[sessionCookie];
  if(token) await pool.execute('DELETE FROM user_sessions WHERE token_hash=?',[hashToken(token)]);
  res.clearCookie(sessionCookie,{path:'/'});
}

module.exports={hashPassword,verifyPassword,createSession,optionalAuth,requireAuth,destroySession};
