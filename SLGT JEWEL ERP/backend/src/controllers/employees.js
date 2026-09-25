import { Op, fn, col } from 'sequelize';
import { Employee, User } from '../models/index.js';
import { likeOp } from '../db.js';
import { newId } from '../utils.js';

// GET /api/employees/departments
export const listDepartments = async (req, res, next) => {
  try {
    const rows = await Employee.findAll({
      attributes: [[fn('DISTINCT', col('department')), 'department']],
      where: { department: { [Op.not]: null } },
      order: [['department', 'ASC']],
      raw: true,
    });
    const departments = rows.map((r) => r.department).filter(Boolean);
    return res.json(departments);
  } catch (err) {
    next(err);
  }
};

// GET /api/employees/summary
export const getSummary = async (req, res, next) => {
  try {
    const [total, active, inactive, deptRows] = await Promise.all([
      Employee.count(),
      Employee.count({ where: { status: 'active' } }),
      Employee.count({ where: { status: 'inactive' } }),
      Employee.findAll({
        attributes: [[fn('COUNT', fn('DISTINCT', col('department'))), 'departments']],
        raw: true,
      }),
    ]);

    const departments = parseInt(deptRows[0]?.departments ?? 0, 10);
    return res.json({ total, active, inactive, departments });
  } catch (err) {
    next(err);
  }
};

// GET /api/employees
export const listEmployees = async (req, res, next) => {
  try {
    const { search, status, department } = req.query;
    const where = {};

    if (search) {
      where[Op.or] = [
        { name: { [likeOp]: `%${search}%` } },
        { mobile: { [likeOp]: `%${search}%` } },
        { department: { [likeOp]: `%${search}%` } },
      ];
    }

    if (status === 'active' || status === 'inactive') {
      where.status = status;
    }

    if (department) {
      where.department = { [likeOp]: `%${department}%` };
    }

    const employees = await Employee.findAll({ where, order: [['name', 'ASC']] });
    return res.json(employees.map((e) => e.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/employees
export const createEmployee = async (req, res, next) => {
  try {
    const {
      name,
      mobile,
      email,
      job_title,
      department,
      salary,
      commission_pct,
      commission_on,
      join_date,
      status,
      address,
      emergency_contact,
      notes,
    } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ detail: 'name and mobile are required' });
    }

    const user_id = req.body.user_id || null;

    const employee = await Employee.create({
      id: newId(),
      user_id,
      name,
      mobile,
      email: email || null,
      job_title: job_title || null,
      department: department || null,
      salary: salary ?? null,
      commission_pct: commission_pct ?? 0,
      commission_on: commission_on || 'making',
      join_date: join_date || null,
      status: status || 'active',
      address: address || null,
      emergency_contact: emergency_contact || null,
      notes: notes || null,
    });

    return res.status(201).json(employee.toJSON());
  } catch (err) {
    next(err);
  }
};

// GET /api/employees/:id
export const getEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ detail: 'Employee not found' });
    return res.json(employee.toJSON());
  } catch (err) {
    next(err);
  }
};

// PUT /api/employees/:id
export const updateEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ detail: 'Employee not found' });

    const {
      name,
      mobile,
      email,
      job_title,
      department,
      salary,
      commission_pct,
      commission_on,
      join_date,
      status,
      address,
      emergency_contact,
      notes,
      user_id,
    } = req.body;

    await employee.update({
      name,
      mobile,
      email,
      job_title,
      department,
      salary,
      commission_pct: commission_pct ?? employee.commission_pct,
      commission_on: commission_on || employee.commission_on || 'making',
      join_date,
      status,
      address,
      emergency_contact,
      notes,
      ...(user_id !== undefined ? { user_id: user_id || null } : {}),
    });

    return res.json(employee.toJSON());
  } catch (err) {
    next(err);
  }
};

// DELETE /api/employees/:id — hard delete; also removes the linked login account
export const deleteEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ detail: 'Employee not found' });

    const userId = employee.user_id;
    await employee.destroy();

    // Remove the linked user account so the email can be reused
    if (userId) {
      await User.destroy({ where: { id: userId } }).catch(() => {});
    }

    return res.json({ message: 'Employee deleted', id: req.params.id });
  } catch (err) {
    next(err);
  }
};
