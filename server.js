const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const db = require('./config/database');

// 加载环境变量
dotenv.config();

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// API请求和响应记录中间件
app.use(async (req, res, next) => {
  // 记录请求开始时间
  const start = Date.now();
  
  // 保存原始响应方法
  const originalJson = res.json;
  
  // 重写json方法以捕获响应
  res.json = function(data) {
    const responseTime = Date.now() - start;
    
    // 记录API调用到数据库（不阻塞）
    try {
      const endpoint = req.originalUrl;
      const method = req.method;
      const requestBody = JSON.stringify(req.body).substring(0, 1000); // 限制长度
      const responseCode = res.statusCode;
      
      // 异步记录日志，不等待完成
      db.query(
        'INSERT INTO api_logs (endpoint, method, request_body, response_code, response_time) VALUES (?, ?, ?, ?, ?)',
        [endpoint, method, requestBody, responseCode, responseTime]
      ).catch(err => console.error('记录API日志失败:', err));
      
      // 添加响应时间到日志
      console.log(`API ${method} ${endpoint} - ${responseCode} - ${responseTime}ms`);
    } catch (error) {
      console.error('记录API日志错误:', error);
    }
    
    // 调用原始方法
    return originalJson.call(this, data);
  };
  
  next();
});

// 服务健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/beds', require('./routes/beds'));
app.use('/api/members', require('./routes/members'));
app.use('/api/health', require('./routes/health'));

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  console.error(err.stack);
  
  // 将错误记录到数据库
  try {
    db.query(
      'INSERT INTO api_logs (endpoint, method, request_body, response_code, response_time) VALUES (?, ?, ?, ?, ?)',
      [req.originalUrl, req.method, JSON.stringify({error: true, body: req.body}).substring(0, 1000), 500, 0]
    ).catch(err => console.error('记录错误日志失败:', err));
  } catch (logError) {
    console.error('记录错误日志出错:', logError);
  }
  
  res.status(500).json({
    code: 500,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
}); 