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
    password:process.env.DB_PASSWORD||'',
    ssl:String(process.env.DB_SSL).toLowerCase()==='true'
      ?{minVersion:'TLSv1.2',rejectUnauthorized:true}
      :undefined
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
  const [orderUserColumns]=await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='orders' AND COLUMN_NAME='user_id'`,
    [database]
  );
  if(!orderUserColumns.length){
    await connection.query('ALTER TABLE orders ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id');
    await connection.query('ALTER TABLE orders ADD INDEX idx_orders_user_created (user_id, created_at)');
    await connection.query('ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL');
  }
  const [roleColumns]=await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='role'`,
    [database]
  );
  if(!roleColumns.length){
    await connection.query("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'customer' AFTER password_hash");
  }
  const [currencyColumns]=await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='orders' AND COLUMN_NAME='currency'`,
    [database]
  );
  if(!currencyColumns.length){
    await connection.query("ALTER TABLE orders ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'BGN' AFTER total");
  }
  const [paymentColumns]=await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='orders'
       AND COLUMN_NAME IN ('customer_email','payment_method','payment_status','stripe_session_id')`,
    [database]
  );
  const paymentColumnNames=new Set(paymentColumns.map(column=>column.COLUMN_NAME));
  if(!paymentColumnNames.has('customer_email')){
    await connection.query('ALTER TABLE orders ADD COLUMN customer_email VARCHAR(190) NULL AFTER customer_name');
  }
  if(!paymentColumnNames.has('payment_method')){
    await connection.query("ALTER TABLE orders ADD COLUMN payment_method ENUM('cash','card') NOT NULL DEFAULT 'cash' AFTER currency");
  }
  if(!paymentColumnNames.has('payment_status')){
    await connection.query("ALTER TABLE orders ADD COLUMN payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending' AFTER payment_method");
    await connection.query("UPDATE orders SET payment_status=IF(status='completed','paid','pending') WHERE payment_method='cash'");
  }
  if(!paymentColumnNames.has('stripe_session_id')){
    await connection.query('ALTER TABLE orders ADD COLUMN stripe_session_id VARCHAR(255) NULL AFTER payment_status');
    await connection.query('ALTER TABLE orders ADD UNIQUE INDEX idx_orders_stripe_session (stripe_session_id)');
  }
  await connection.end();
  console.log('MySQL database and order tables are ready.');
}

main().catch(error=>{
  console.error('Could not initialize MySQL:',error.message);
  process.exitCode=1;
});
