const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin } = require('../middleware/auth');

// 获取老人列表
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, name, gender, care_level, status, include_details, unassigned } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT m.*, b.bed_number, b.building, b.floor, b.room_number
      FROM members m
      LEFT JOIN beds b ON m.bed_id = b.id
      WHERE 1=1
    `;
    const params = [];
    
    if (name) {
      query += ' AND m.name LIKE ?';
      params.push(`%${name}%`);
    }
    if (gender) {
      query += ' AND m.gender = ?';
      params.push(gender);
    }
    if (care_level) {
      query += ' AND m.care_level = ?';
      params.push(care_level);
    }
    if (status) {
      query += ' AND m.status = ?';
      params.push(status);
    }
    if (unassigned === 'true') {
      query += ' AND m.bed_id IS NULL';
    }
    
    // 如果是获取详细信息，不使用分页
    if (include_details === 'true') {
      // 不添加LIMIT子句
    } else {
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);
    }
    
    const [members] = await db.query(query, params);
    
    // 数据清洗和映射
    const mappedMembers = members.map(member => {
      try {
        // 确保床位数据一致性
        if (!member.bed_id) {
          // 如果没有床位ID，确保所有床位相关字段为null
          member.bed_number = null;
          member.building = null;
          member.floor = null;
          member.room_number = null;
        }
        
        // 处理健康状况字段，确保返回字符串数组格式
        let healthConditions = [];
        try {
          // 尝试解析health_status字段中的JSON
          if (member.health_status && typeof member.health_status === 'string' && 
              member.health_status !== '获取失败' && 
              member.health_status !== '暂无记录') {
            try {
              const parsed = JSON.parse(member.health_status);
              if (Array.isArray(parsed)) {
                healthConditions = parsed.map(item => {
                  if (typeof item === 'string') {
                    return item;
                  } else if (typeof item === 'object' && item.name) {
                    return item.name;
                  } else {
                    return String(item);
                  }
                });
              } else if (typeof parsed === 'object') {
                // 单个对象，提取名称
                healthConditions = parsed.name ? [parsed.name] : [String(parsed)];
              } else {
                // 其他类型转为字符串
                healthConditions = [String(parsed)];
              }
            } catch (e) {
              console.error('解析health_status为JSON失败:', e);
              // 如果解析失败，表示不是JSON格式，而是普通文本
              if (member.health_status && typeof member.health_status === 'string') {
                healthConditions = member.health_status
                  .split(',')
                  .filter(item => item.trim())
                  .map(name => name.trim());
              }
            }
          }
        } catch (e) {
          console.error('处理健康状况字段时出错:', e);
          healthConditions = [];
        }
        
        // 映射字段为前端友好格式
        return {
          ...member,
          gender: member.gender === 'male' ? '男' : '女',
          care_level: member.care_level === 'self-care' ? '自理' : 
                     member.care_level === 'semi-care' ? '介助' : 
                     member.care_level === 'full-care' ? '全护理' : 
                     member.care_level === 'special-care' ? '特护' : member.care_level,
          status: member.status === 'active' ? '在住' : 
                 member.status === 'on_leave' ? '离开' : 
                 member.status === 'inactive' ? '离开' : 
                 member.status === 'deceased' ? '过世' : member.status,
          // 添加床位信息的格式化
          bed_info: member.bed_number ? 
            `${member.building || ''}-${member.floor || ''}-${member.room_number || ''}-${member.bed_number}` : 
            '未分配',
          // 添加责任护工和健康状况的处理
          caregiver: member.responsibility_worker || '未分配',
          // 始终以一致的格式返回健康状况
          health_conditions: healthConditions,
          // 保持health_status字段用于向后兼容
          health_status: healthConditions.length > 0 ? healthConditions.join(', ') : '暂无记录'
        };
      } catch (error) {
        console.error(`映射会员${member.id || '未知'}数据出错:`, error);
        // 返回基本数据，防止整个列表因为单个会员数据问题而失败
        return {
          ...member,
          gender: member.gender === 'male' ? '男' : '女',
          status: '数据错误',
          bed_info: '未知',
          caregiver: '未知',
          health_conditions: [],
          health_status: '数据错误'
        };
      }
    });
    
    try {
      // 获取总数
      const [total] = await db.query(
        'SELECT COUNT(*) as total FROM members'
      );
      
      res.json({
        code: 200,
        data: {
          total: total[0].total,
          page: parseInt(page),
          limit: parseInt(limit),
          members: mappedMembers
        }
      });
    } catch (countError) {
      console.error('获取会员总数出错:', countError);
      res.json({
        code: 200,
        data: {
          total: members.length,
          page: parseInt(page),
          limit: parseInt(limit),
          members: mappedMembers
        }
      });
    }
  } catch (error) {
    console.error('获取老人列表错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
});

// 创建老人信息
router.post('/', async (req, res) => {
  try {
    const {
      name,
      gender,
      age,
      id_card,
      phone,
      emergency_contact,
      emergency_phone,
      care_level,
      status,
      responsibility_worker,    // 添加责任护工
      caregiver,               // 兼容前端字段
      health_status,            // 添加健康状况
      health_conditions,        // 健康状况数组
      health_notes,             // 健康备注
      health_detail,            // 健康详情字段
      ...restFields
    } = req.body;
    
    // 性别映射
    const genderMap = {
      '男': 'male',
      '女': 'female',
      'male': 'male',
      'female': 'female'
    };
    
    // 照护级别映射
    const careLevelMap = {
      '自理': 'self-care',
      '介助': 'semi-care', // 添加"介助"映射
      '介护': 'full-care',
      '特护': 'special-care',
      '半自理': 'semi-care',
      '全护理': 'full-care',
      'self-care': 'self-care',
      'semi-care': 'semi-care',
      'full-care': 'full-care',
      'special-care': 'special-care'
    };
    
    // 状态映射
    const statusMap = {
      '在住': 'active',
      '离开': 'inactive',
      '过世': 'deceased',
      'active': 'active',
      'inactive': 'inactive',
      'deceased': 'deceased'
    };
    
    const mappedGender = genderMap[gender] || 'male';
    const mappedCareLevel = careLevelMap[care_level] || 'self-care';
    const mappedStatus = status ? (statusMap[status] || 'active') : 'active';
    
    // 处理责任护工字段（支持前端caregiver和后端responsibility_worker两种字段名）
    const workerName = responsibility_worker || caregiver || null;
    
    // 处理健康状况，始终存储为JSON字符串
    let healthConditionsArray = [];
    let healthStatusValue = null;
    
    // 1. 首选health_conditions数组
    if (health_conditions && Array.isArray(health_conditions)) {
      // 确保每项都是简单的字符串
      healthConditionsArray = health_conditions.map(item => {
        if (typeof item === 'string') {
          return item;
        } else if (typeof item === 'object' && item.name) {
          return item.name;
        } else {
          return String(item);
        }
      });
      healthStatusValue = JSON.stringify(healthConditionsArray);
    } 
    // 2. 如果没有health_conditions但有health_status
    else if (health_status) {
      try {
        // 尝试解析health_status为JSON
        const parsed = JSON.parse(health_status);
        if (Array.isArray(parsed)) {
          // 如果是对象数组，提取name属性
          healthConditionsArray = parsed.map(item => {
            if (typeof item === 'string') {
              return item;
            } else if (typeof item === 'object' && item.name) {
              return item.name;
            } else {
              return String(item);
            }
          });
        } else if (typeof parsed === 'object' && parsed.name) {
          // 单个对象，提取name属性
          healthConditionsArray = [parsed.name];
        } else {
          // 其他情况转为字符串
          healthConditionsArray = [String(parsed)];
        }
      } catch (e) {
        // 不是JSON，按逗号分割为字符串数组
        healthConditionsArray = health_status
          .split(',')
          .filter(item => item.trim())
          .map(name => name.trim());
      }
      healthStatusValue = JSON.stringify(healthConditionsArray);
    }
    // 3. 如果只有health_notes
    else if (health_notes) {
      healthConditionsArray = [health_notes];
      healthStatusValue = JSON.stringify(healthConditionsArray);
    }
    
    // 确保必填字段存在
    if (!name || !age) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要字段(姓名、年龄)'
      });
    }
    
    console.log('创建老人，映射后的数据:', {
      name,
      gender: mappedGender,
      age,
      care_level: mappedCareLevel,
      status: mappedStatus,
      responsibility_worker: workerName,
      health_status: healthStatusValue
    });
    
    // 执行插入
    const [result] = await db.query(
      `INSERT INTO members (
        name, gender, age, id_card, phone, 
        emergency_contact, emergency_phone, care_level, status,
        responsibility_worker, health_status, health_detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, mappedGender, age, id_card, phone, 
        emergency_contact, emergency_phone, mappedCareLevel, mappedStatus,
        workerName, healthStatusValue, health_detail || null
      ]
    );
    
    res.status(201).json({
      code: 201,
      message: '老人信息创建成功',
      data: {
        id: result.insertId,
        member: {
          id: result.insertId,
          name,
          gender: mappedGender,
          age,
          care_level: mappedCareLevel,
          responsibility_worker: workerName,
          caregiver: workerName, // 添加前端字段
          health_status: healthConditionsArray.length > 0 ? 
            healthConditionsArray.join(', ') : 
            '暂无记录',
          health_conditions: healthConditionsArray,
          health_detail: health_detail || null
        }
      }
    });
  } catch (error) {
    console.error('创建老人错误详情:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误: ' + (error.message || '未知错误')
    });
  }
});

// 更新老人信息
router.put('/:id', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    const {
      name,
      gender,
      age,
      id_card,
      phone,
      emergency_contact,
      emergency_phone,
      care_level,
      status,
      responsibility_worker,
      caregiver,           // 兼容前端caregiver字段
      health_status,
      health_conditions,   // 接收但不直接保存到会员表
      health_detail,       // 健康详情字段
      health_notes,        // 健康备注字段
      ...restFields
    } = req.body;

    // 首先获取当前老人信息
    const [currentMember] = await connection.query(
      'SELECT * FROM members WHERE id = ?',
      [id]
    );

    if (currentMember.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '未找到该老人'
      });
    }

    const current = currentMember[0];
    
    // 性别映射
    const genderMap = {
      '男': 'male',
      '女': 'female',
      'male': 'male',
      'female': 'female'
    };
    
    // 照护级别映射
    const careLevelMap = {
      '自理': 'self-care',
      '介助': 'semi-care',
      '介护': 'full-care',
      '特护': 'special-care',
      '半自理': 'semi-care',
      '全护理': 'full-care',
      'self-care': 'self-care',
      'semi-care': 'semi-care',
      'full-care': 'full-care',
      'special-care': 'special-care'
    };
    
    // 状态映射
    const statusMap = {
      '在住': 'active',
      '离开': 'inactive',
      '过世': 'deceased',
      'active': 'active',
      'inactive': 'inactive',
      'deceased': 'deceased'
    };

    // 构建更新数据对象
    const updateData = {
      name: name || current.name,
      gender: gender ? (genderMap[gender] || current.gender) : current.gender,
      age: age || current.age,
      id_card: id_card !== undefined ? id_card : current.id_card,
      phone: phone !== undefined ? phone : current.phone,
      emergency_contact: emergency_contact !== undefined ? emergency_contact : current.emergency_contact,
      emergency_phone: emergency_phone !== undefined ? emergency_phone : current.emergency_phone,
      care_level: care_level ? (careLevelMap[care_level] || current.care_level) : current.care_level,
      status: status ? (statusMap[status] || current.status) : current.status,
      responsibility_worker: (responsibility_worker || caregiver) !== undefined ? (responsibility_worker || caregiver) : current.responsibility_worker
    };

    // 处理健康状况
    let healthConditionsArray = [];
    if (health_conditions || health_status) {
      if (health_conditions) {
        // 处理数组格式的健康状况输入
        if (Array.isArray(health_conditions)) {
          healthConditionsArray = health_conditions.map(item => {
            // 如果是字符串，转为对象格式
            if (typeof item === 'string') {
              return {
                id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                name: item,
                severity: 'moderate'
              };
            }
            // 如果是对象但没有ID，添加ID
            if (typeof item === 'object' && !item.id) {
              return {
                id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                name: item.name || String(item),
                severity: item.severity || 'moderate'
              };
            }
            // 返回已有对象
            return item;
          });
        } else if (typeof health_conditions === 'string') {
          try {
            // 尝试解析JSON字符串
            const parsed = JSON.parse(health_conditions);
            if (Array.isArray(parsed)) {
              healthConditionsArray = parsed.map(item => {
                // 确保每个对象都有id
                if (typeof item === 'string') {
                  return {
                    id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                    name: item,
                    severity: 'moderate'
                  };
                }
                if (!item.id) {
                  return {
                    ...item,
                    id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
                  };
                }
                return item;
              });
            } else if (typeof parsed === 'object') {
              // 单个对象，确保有id
              const id = parsed.id || `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
              healthConditionsArray = [{...parsed, id}];
            } else {
              healthConditionsArray = [{
                id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                name: String(parsed),
                severity: 'moderate'
              }];
            }
          } catch (e) {
            // 不是JSON格式，按逗号分隔
            healthConditionsArray = health_conditions.split(',').map(s => ({
              id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
              name: s.trim(),
              severity: 'moderate'
            }));
          }
        }
      } else if (health_status) {
        try {
          const parsed = JSON.parse(health_status);
          if (Array.isArray(parsed)) {
            healthConditionsArray = parsed.map(item => {
              if (typeof item === 'string') {
                return {
                  id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                  name: item,
                  severity: 'moderate'
                };
              }
              if (!item.id) {
                return {
                  ...item,
                  id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
                };
              }
              return item;
            });
          } else if (typeof parsed === 'object') {
            const id = parsed.id || `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
            healthConditionsArray = [{...parsed, id}];
          } else {
            healthConditionsArray = [{
              id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
              name: String(parsed),
              severity: 'moderate'
            }];
          }
        } catch (e) {
          // 不是JSON格式，按逗号分隔
          healthConditionsArray = typeof health_status === 'string' ? 
            health_status.split(',').map(s => ({
              id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
              name: s.trim(),
              severity: 'moderate'
            })) :
            [{
              id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
              name: String(health_status),
              severity: 'moderate'
            }];
        }
      }
      updateData.health_status = JSON.stringify(healthConditionsArray);
    }

    if (health_detail !== undefined) {
      updateData.health_detail = health_detail;
    }

    // 构建 SQL 更新语句
    const updates = Object.entries(updateData)
      .filter(([key, value]) => value !== undefined)
      .map(([key, _]) => `${key} = ?`);
    
    const values = Object.entries(updateData)
      .filter(([key, value]) => value !== undefined)
      .map(([key, value]) => value);

    // 添加 ID 到值数组
    values.push(id);

    // 执行更新
    await connection.query(
      `UPDATE members SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    // 获取更新后的数据
    const [updatedMember] = await connection.query(
      `SELECT m.*, b.bed_number, b.building, b.floor, b.room_number
       FROM members m
       LEFT JOIN beds b ON m.bed_id = b.id
       WHERE m.id = ?`,
      [id]
    );

    if (updatedMember.length === 0) {
      throw new Error('更新后未能获取老人信息');
    }

    const member = updatedMember[0];

    // 处理返回的健康状况数据
    let healthConditions = [];
    try {
      if (member.health_status) {
        healthConditions = JSON.parse(member.health_status);
      }
    } catch (e) {
      console.error('解析健康状况JSON失败:', e);
    }

    res.json({
      code: 200,
      message: '老人信息更新成功',
      data: {
        member: {
          ...member,
          gender: member.gender === 'male' ? '男' : '女',
          care_level: member.care_level === 'self-care' ? '自理' : 
                     member.care_level === 'semi-care' ? '介助' : 
                     member.care_level === 'full-care' ? '全护理' : 
                     member.care_level === 'special-care' ? '特护' : member.care_level,
          status: member.status === 'active' ? '在住' : 
                 member.status === 'inactive' ? '离开' : 
                 member.status === 'deceased' ? '过世' : member.status,
          bed_info: member.bed_number ? 
            `${member.building}-${member.floor}-${member.room_number}-${member.bed_number}` : 
            '未分配',
          caregiver: member.responsibility_worker || '未分配',
          health_conditions: healthConditions,
          health_status: healthConditions.length > 0 ? 
            healthConditions.map(c => typeof c === 'object' ? c.name : String(c)).join(', ') : 
            '暂无记录'
        }
      }
    });
  } catch (error) {
    console.error('更新老人信息错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// 删除老人信息
router.delete('/:id', isAdmin, async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();
    
    // 1. 先获取老人的床位信息
    const [members] = await connection.query(
      'SELECT bed_id FROM members WHERE id = ?',
      [id]
    );
    
    if (members.length > 0 && members[0].bed_id) {
      // 2. 如果有床位，先更新床位状态为可用
      await connection.query(
        'UPDATE beds SET status = ?, current_member_id = NULL WHERE id = ?',
        ['available', members[0].bed_id]
      );
    }
    
    // 3. 删除老人记录
    await connection.query(
      'DELETE FROM members WHERE id = ?',
      [id]
    );
    
    await connection.commit();
    
    res.json({
      code: 200,
      message: '老人信息删除成功'
    });
  } catch (error) {
    await connection.rollback();
    console.error('删除老人信息错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// 获取单个老人信息
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [members] = await db.query(
      `SELECT m.*, b.bed_number, b.building, b.floor, b.room_number
       FROM members m
       LEFT JOIN beds b ON m.bed_id = b.id
       WHERE m.id = ?`,
      [id]
    );
    
    if (members.length === 0) {
      return res.status(404).json({
        code: 404,
        message: '未找到该老人信息'
      });
    }
    
    const member = members[0];
    
    // 检查床位数据一致性
    if (!member.bed_id) {
      // 清除可能存在的错误床位数据
      member.bed_number = null;
      member.building = null;
      member.floor = null;
      member.room_number = null;
    } else {
      // 额外验证床位和老人关联是否一致
      const [bedCheck] = await db.query(
        'SELECT current_member_id FROM beds WHERE id = ?',
        [member.bed_id]
      );
      
      if (bedCheck.length === 0 || bedCheck[0].current_member_id != id) {
        // 发现不一致，自动修复
        console.warn(`发现老人ID ${id} 的床位关联不一致，正在修复...`);
        
        // 清除老人的床位关联
        await db.query(
          'UPDATE members SET bed_id = NULL WHERE id = ?',
          [id]
        );
        
        // 更新返回数据
        member.bed_id = null;
        member.bed_number = null;
        member.building = null;
        member.floor = null;
        member.room_number = null;
      }
    }
    
    // 处理健康状况，确保格式为简单字符串数组
    let healthConditions = [];
    
    // 如果会员有health_status字段，尝试从中获取健康状况
    if (member.health_status) {
      try {
        const parsed = JSON.parse(member.health_status);
        if (Array.isArray(parsed)) {
          healthConditions = parsed.map(item => {
            if (typeof item === 'string') {
              return item;
            } else if (typeof item === 'object' && item.name) {
              return item.name;
            } else {
              return String(item);
            }
          });
        } else if (typeof parsed === 'object' && parsed.name) {
          healthConditions = [parsed.name];
        } else {
          healthConditions = [String(parsed)];
        }
      } catch (e) {
        // 如果解析失败，表示不是JSON格式，按逗号分割
        if (typeof member.health_status === 'string') {
          healthConditions = member.health_status
            .split(',')
            .filter(item => item.trim())
            .map(name => name.trim());
        }
      }
    }
    
    // 返回格式化后的老人信息
    res.json({
      code: 200,
      data: {
        member: {
          ...member,
          gender: member.gender === 'male' ? '男' : '女',
          care_level: member.care_level === 'self-care' ? '自理' : 
                     member.care_level === 'semi-care' ? '介助' : 
                     member.care_level === 'full-care' ? '全护理' : 
                     member.care_level === 'special-care' ? '特护' : member.care_level,
          status: member.status === 'active' ? '在住' : 
                 member.status === 'inactive' ? '离开' : 
                 member.status === 'deceased' ? '过世' : member.status,
          bed_info: member.bed_number ? 
            `${member.building}-${member.floor}-${member.room_number}-${member.bed_number}` : 
            '未分配',
          caregiver: member.responsibility_worker || '未分配',
          health_conditions: healthConditions,
          health_status: healthConditions.length > 0 ? healthConditions.join(', ') : '暂无记录'
        }
      }
    });
  } catch (error) {
    console.error('获取老人信息错误:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
});

module.exports = router; 