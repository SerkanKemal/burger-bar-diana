const mysql=require('mysql2/promise');

const sslEnabled=String(process.env.DB_SSL).toLowerCase()==='true';

const pool=mysql.createPool({
  host:process.env.DB_HOST||'127.0.0.1',
  port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER||'root',
  password:process.env.DB_PASSWORD||'',
  database:process.env.DB_NAME||'burger_bar_diana',
  ssl:sslEnabled?{minVersion:'TLSv1.2',rejectUnauthorized:true}:undefined,
  waitForConnections:true,
  connectionLimit:10,
  decimalNumbers:true,
  timezone:'Z'
});

module.exports={pool};
