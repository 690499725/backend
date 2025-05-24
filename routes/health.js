const express = require('express');
const router = express.Router();
const db = require('../config/database');

// 获取健康数据
router.get('/monitor', async (req, res) => {
  try {
    const { member_id } = req.query;
    
    // 先获取老人的基本信息
    let memberInfo = null;
    if (member_id) {
      try {
        const [members] = await db.query(
          `SELECT id, name, responsibility_worker, health_status, health_detail 
           FROM members WHERE id = ?`,
          [member_id]
        );
        
        if (members && members.length > 0) {
          memberInfo = members[0];
          
          // 尝试解析老人的健康状况为对象数组格式
          let healthConditions = [];
          if (memberInfo.health_status) {
            try {
              // 尝试解析为JSON数组
              const parsed = JSON.parse(memberInfo.health_status);
              if (Array.isArray(parsed)) {
                healthConditions = parsed.map(item => {
                  // 确保每个对象都有id
                  if (typeof item === 'object' && !item.id) {
                    return {
                      ...item,
                      id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
                    };
                  } else if (typeof item === 'string') {
                    return {
                      id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                      name: item,
                      severity: 'moderate'
                    };
                  }
                  return item;
                });
              } else if (typeof parsed === 'object') {
                // 单个对象，确保有id
                const id = parsed.id || `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
                healthConditions = [{...parsed, id}];
              } else {
                // 非对象类型，创建对象
                healthConditions = [{
                  id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                  name: String(parsed),
                  severity: 'moderate'
                }];
              }
            } catch (e) {
              console.error('解析老人健康状态JSON出错:', e);
              // 如果解析失败，将文本分割为数组
              if (typeof memberInfo.health_status === 'string') {
                healthConditions = memberInfo.health_status
                  .split(',')
                  .filter(item => item.trim())
                  .map(name => ({
                    id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
                    name: name.trim(),
                    severity: 'moderate'
                  }));
              }
            }
          } else {
            healthConditions = [];
          }
          
          // 更新老人信息，添加健康状况数组
          memberInfo.health_conditions = healthConditions;
          // 为向后兼容，保留文本格式的健康状况
          memberInfo.health_status_text = healthConditions.length > 0 ? 
            healthConditions.map(c => typeof c === 'object' && c.name ? c.name : String(c)).join(', ') : 
            '暂无记录';
        }
      } catch (memberError) {
        console.error('获取老人信息出错:', memberError);
        memberInfo = {
          id: member_id,
          name: '获取失败',
          responsibility_worker: '未知',
          health_status: '获取失败',
          health_conditions: [],
          health_status_text: '获取失败'
        };
      }
    }
    
    res.json({
      code: 200,
      data: {
        member_info: memberInfo
      }
    });
  } catch (error) {
    console.error('获取健康监测数据出错:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
});

// 添加健康数据
router.post('/monitor', async (req, res) => {
  try {
    const { 
      member_id, 
      health_status, 
      responsibility_worker,
      health_conditions,
      health_detail
    } = req.body;
    
    if (!member_id) {
      return res.status(400).json({
        code: 400,
        message: '缺少老人ID参数'
      });
    }
    
    // 处理健康状况值，标准化为JSON字符串格式
    let healthStatusValue = null;
    let healthConditionsArray = [];
    
    // 处理所有可能的健康状况输入格式
    // 1. 首选health_conditions数组
    if (health_conditions) {
      if (Array.isArray(health_conditions)) {
        healthConditionsArray = health_conditions.map(item => {
          // 确保每个项都是对象格式
          if (typeof item === 'string') {
            return {
              id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
              name: item,
              severity: 'moderate'
            };
          }
          // 如果已有对象但没有id字段，添加id
          if (typeof item === 'object' && !item.id) {
            return {
              id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
              name: item.name || String(item),
              severity: item.severity || 'moderate'
            };
          }
          // 使用已有对象
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
              name: health_conditions,
              severity: 'moderate'
            }];
          }
        } catch (e) {
          // 不是JSON格式
          healthConditionsArray = [{
            id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
            name: health_conditions,
            severity: 'moderate'
          }];
        }
      }
      
      healthStatusValue = JSON.stringify(healthConditionsArray);
    } 
    // 2. 如果没有health_conditions但有health_status
    else if (health_status) {
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
        healthStatusValue = JSON.stringify(healthConditionsArray);
      } catch (e) {
        // 不是JSON格式，按逗号分隔
        healthConditionsArray = health_status.split(',').map(name => ({
          id: `hc-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
          name: name.trim(),
          severity: 'moderate'
        }));
        healthStatusValue = JSON.stringify(healthConditionsArray);
      }
    }
    
    // 更新老人表的健康状况
    const updates = [];
    const params = [];
    
    if (responsibility_worker) {
      updates.push('responsibility_worker = ?');
      params.push(responsibility_worker);
    }
    
    if (healthStatusValue) {
      updates.push('health_status = ?');
      params.push(healthStatusValue);
    }
    
    if (health_detail !== undefined) {
      updates.push('health_detail = ?');
      params.push(health_detail);
    }
    
    let memberUpdated = false;
    
    if (updates.length > 0) {
      params.push(member_id);
      await db.query(
        `UPDATE members SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      memberUpdated = true;
    }
    
    res.status(201).json({
      code: 201,
      message: '健康数据添加成功',
      data: {
        id: Date.now(),
        status: 'normal',
        member_updated: memberUpdated,
        health_conditions: healthConditionsArray,
        health_status_text: healthConditionsArray.length > 0 ?
          healthConditionsArray.map(c => typeof c === 'object' && c.name ? c.name : String(c)).join(', ') :
          '暂无记录'
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      error: error.message
    });
  }
});

module.exports = router; 