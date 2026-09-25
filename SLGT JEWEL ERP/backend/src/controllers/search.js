import { Op } from 'sequelize';
import { Customer, Product, Invoice } from '../models/index.js';
import { likeOp } from '../db.js';
import { withNotHidden } from '../utils/invoiceVisibility.js';

// GET /api/search
export const globalSearch = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ customers: [], products: [], invoices: [] });
    }

    const searchTerm = `%${q.trim()}%`;

    const [customers, products, invoices] = await Promise.all([
      Customer.findAll({
        where: {
          deleted_at: null,
          [Op.or]: [
            { name: { [likeOp]: searchTerm } },
            { mobile: { [likeOp]: searchTerm } },
            { email: { [likeOp]: searchTerm } },
          ],
        },
        attributes: ['id', 'name', 'mobile', 'email'],
        limit: 5,
      }),

      Product.findAll({
        where: {
          [Op.or]: [
            { name: { [likeOp]: searchTerm } },
            { code: { [likeOp]: searchTerm } },
            { barcode: { [likeOp]: searchTerm } },
          ],
        },
        attributes: ['id', 'name', 'code', 'barcode', 'stock_qty', 'selling_price'],
        limit: 5,
      }),

      Invoice.findAll({
        where: withNotHidden({
          [Op.or]: [
            { invoice_no: { [likeOp]: searchTerm } },
            { customer_name: { [likeOp]: searchTerm } },
            { customer_mobile: { [likeOp]: searchTerm } },
          ],
        }),
        // 'created_at' (the raw DB column) isn't a real attribute on this
        // underscored model, only 'createdAt' — leaving it in `attributes`
        // silently made the field come back undefined. Only 5 rows here, so
        // just drop the restriction rather than juggle attribute aliases.
        limit: 5,
      }),
    ]);

    res.json({ customers, products, invoices });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
