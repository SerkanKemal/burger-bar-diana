const fs=require('fs');
const path=require('path');
const mysql=require('mysql2/promise');
require('dotenv').config();

async function main(){
  const database=process.env.DB_NAME||'burger_bar_diana';
  if(!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('DB_NAME may contain only letters, numbers and underscores.');
  const config={
    host:process.env.DB_HOST||'127.0.0.1',
    port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER||'root',
    password:process.env.DB_PASSWORD||''
  };
  const setupConnection=await mysql.createConnection(config);
  try{
    await setupConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  }catch(error){
    console.warn('Database creation was skipped:',error.message);
  }finally{
    await setupConnection.end();
  }

  const connection=await mysql.createConnection({...config,database,multipleStatements:true});
  const schema=fs.readFileSync(path.join(__dirname,'..','database','schema.sql'),'utf8');
  await connection.query(schema);
  const [columns]=await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='orders' AND COLUMN_NAME='user_id'`,
    [database]
  );
  if(!columns.length){
    await connection.query('ALTER TABLE orders ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id');
    await connection.query('ALTER TABLE orders ADD INDEX idx_orders_user_created (user_id, created_at)');
    await connection.query('ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL');
  }
  await connection.end();
  console.log('MySQL database and order tables are ready.');
}

main().catch(error=>{
  console.error('Could not initialize MySQL:',error.message);
  process.exitCode=1;
});
