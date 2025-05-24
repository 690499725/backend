const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'mysql.sqlpub.com',
  user: 'test_fu',
  password: 'xXleALIT4ivlfmT3',
  database: 'yunyanglao',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// const pool = mysql.createPool({
//   host: process.env.DB_HOST || 'localhost',
//   user: process.env.DB_USER || 'root',
//   password: process.env.DB_PASSWORD || '334645',
//   database: process.env.DB_NAME || 'yang002',
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0
// });

module.exports = pool;