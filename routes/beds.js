const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin } = require('../middleware/auth');

// 获取床位列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, building, floor, room_number, status } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT b.*, m.name as member_name, m.gender, m.age, m.care_level
      FROM beds b
      LEFT JOIN members m ON b.current_member_id = m.id
      WHERE 1=1
    `;
    const params = [];
    
    if (building) {
      query += ' AND b.building = ?';
      params.push(building);
    }
    if (floor) {
      query += ' AND b.floor = ?';
      params.push(floor);
    }
    if (room_number) {
      query += ' AND b.room_number = ?';
      params.push(room_number);
    }
    if (status) {
      query += ' AND b.status = ?';
      params.push(status);
    }
    
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    const [beds] = await db.query(query, params);
    
    // 获取总数
    const [total] = await db.query(
      'SELECT COUNT(*) as total FROM beds'
    );
    
    res.json({
      code: 200,
      data: {
        total: total[0].total,
        page: parseInt(page),
        limit: parseInt(limit),
        beds
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误'
    });
  }
});

// 获取床位统计
router.get('/statistics', async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
      FROM beds
    `);
    
    const occupancyRate = (stats[0].occupied / stats[0].total) * 100;
    
    res.json({
      code: 200,
      data: {
        ...stats[0],
        occupancyRate: occupancyRate.toFixed(2)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误'
    });
  }
});

// 创建床位
router.post('/', async (req, res) => {
  try {
    const { bed_number, building, floor, room_number, status, description } = req.body;
    
    const [result] = await db.query(
      'INSERT INTO beds (bed_number, building, floor, room_number, status, description) VALUES (?, ?, ?, ?, ?, ?)',
      [bed_number, building, floor, room_number, status, description]
    );
    
    res.status(201).json({
      code: 201,
      message: '床位创建成功',
      data: {
        id: result.insertId
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误'
    });
  }
});

// 更新床位
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { bed_number, building, floor, room_number, status, description } = req.body;
    
    await db.query(
      'UPDATE beds SET bed_number = ?, building = ?, floor = ?, room_number = ?, status = ?, description = ? WHERE id = ?',
      [bed_number, building, floor, room_number, status, description, id]
    );
    
    res.json({
      code: 200,
      message: '床位更新成功'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误'
    });
  }
});

// 分配床位
router.post('/assign', async (req, res) => {
  try {
    const { member_id, bed_id } = req.body;
    
    // 验证参数
    if (!member_id || !bed_id) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数'
      });
    }
    
    // 1. 检查床位是否可用
    const [beds] = await db.query(
      'SELECT status, current_member_id FROM beds WHERE id = ?',
      [bed_id]
    );
    
    if (beds.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '床位不存在'
      });
    }
    
    if (beds[0].status !== 'available') {
      return res.status(400).json({
        code: 400,
        message: '床位不可用'
      });
    }
    
    // 2. 检查老人是否存在
    const [members] = await db.query(
      'SELECT bed_id FROM members WHERE id = ?',
      [member_id]
    );
    
    if (members.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '老人信息不存在'
      });
    }
    
    // 3. 检查老人是否已有床位，如有则先取消原床位分配
    if (members[0].bed_id) {
      const oldBedId = members[0].bed_id;
      
      // 验证老人当前的床位分配是否有效
      const [oldBeds] = await db.query(
        'SELECT current_member_id FROM beds WHERE id = ?', 
        [oldBedId]
      );
      
      if (oldBeds.length > 0 && oldBeds[0].current_member_id == member_id) {
        console.log(`老人ID ${member_id} 已有床位ID ${oldBedId}，先取消原分配`);
        
        // 取消原有床位分配
        await db.query(
          'UPDATE beds SET status = ?, current_member_id = NULL WHERE id = ?',
          ['available', oldBedId]
        );
      }
    }
    
    // 4. 使用事务保证数据一致性
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      // 5. 更新床位状态
      await connection.query(
        'UPDATE beds SET status = ?, current_member_id = ? WHERE id = ?',
        ['occupied', member_id, bed_id]
      );
      
      // 6. 更新老人的床位信息
      await connection.query(
        'UPDATE members SET bed_id = ? WHERE id = ?',
        [bed_id, member_id]
      );
      
      // 7. 提交事务
      await connection.commit();
      
      res.json({
        code: 200,
        message: '床位分配成功'
      });
    } catch (error) {
      // 8. 如果出错，回滚事务
      await connection.rollback();
      throw error;
    } finally {
      // 9. 释放连接
      connection.release();
    }
  } catch (error) {
    console.error('分配床位错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误: ' + (error.message || '未知错误')
    });
  }
});

// 取消床位分配
router.post('/:id/unassign', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. 获取当前床位信息，找到关联的老人ID
    const [beds] = await db.query(
      'SELECT current_member_id FROM beds WHERE id = ?',
      [id]
    );
    
    if (beds.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '床位不存在'
      });
    }
    
    const memberId = beds[0].current_member_id;
    
    // 如果床位没有分配给任何人，直接返回成功
    if (!memberId) {
      return res.json({
        code: 200,
        message: '床位未分配，无需取消'
      });
    }
    
    // 2. 使用事务保证数据一致性
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      // 3. 更新床位状态
      await connection.query(
        'UPDATE beds SET status = ?, current_member_id = NULL WHERE id = ?',
        ['available', id]
      );
      
      // 4. 更新老人的床位关联
      await connection.query(
        'UPDATE members SET bed_id = NULL WHERE id = ?',
        [memberId]
      );
      
      // 5. 提交事务
      await connection.commit();
      
      res.json({
        code: 200,
        message: '床位分配已取消'
      });
    } catch (error) {
      // 6. 如果出错，回滚事务
      await connection.rollback();
      throw error;
    } finally {
      // 7. 释放连接
      connection.release();
    }
  } catch (error) {
    console.error('取消床位分配错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误: ' + (error.message || '未知错误')
    });
  }
});

// 删除床位
router.delete('/:id', isAdmin, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();
    
    // 1. 先获取床位信息，检查是否有老人
    const [beds] = await connection.query(
      'SELECT current_member_id FROM beds WHERE id = ?',
      [id]
    );
    
    if (beds.length > 0 && beds[0].current_member_id) {
      // 2. 如果床位上有老人，先更新老人的床位信息为空
      await connection.query(
        'UPDATE members SET bed_id = NULL WHERE id = ?',
        [beds[0].current_member_id]
      );
    }
    
    // 3. 删除床位记录
    await connection.query(
      'DELETE FROM beds WHERE id = ?',
      [id]
    );
    
    await connection.commit();
    
    res.json({
      code: 200,
      message: '床位删除成功'
    });
  } catch (error) {
    await connection.rollback();
    console.error('删除床位错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

module.exports = router; 