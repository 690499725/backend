const jwt = require('jsonwebtoken');
const db = require('../config/database');

// 检查用户是否为管理员
const isAdmin = async (req, res, next) => {
  try {
    // 从请求头获取 token
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        code: 401,
        message: '未登录或登录已过期'
      });
    }
    
    // 验证 token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 从数据库获取用户信息
    const [users] = await db.query(
      'SELECT role FROM users WHERE id = ?',
      [decoded.id]
    );
    
    if (users.length === 0) {
      return res.status(401).json({
        code: 401,
        message: '用户不存在'
      });
    }
    
    // 检查用户角色
    const user = users[0];
    if (user.role !== 'admin') {
      return res.status(403).json({
        code: 403,
        message: '权限不足'
      });
    }
    
    // 将用户信息添加到请求对象中
    req.user = {
      ...decoded,
      role: user.role
    };
    
    next();
  } catch (error) {
    console.error('权限验证错误:', error);
    res.status(401).json({
      code: 401,
      message: '未登录或登录已过期'
    });
  }
};

module.exports = {
  isAdmin
}; 