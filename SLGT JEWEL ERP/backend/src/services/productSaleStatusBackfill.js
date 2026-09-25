/**
 * Align existing zero-qty tags with sold / deleted_p rules.
 * Hidden live invoices → deleted_p; visible live invoices → sold.
 * Idempotent: only rewrites status='available' rows with no remaining stock.
 */
export async function backfillSaleOutcomeStatuses(sequelize) {
  if (!sequelize) return { deleted_p: 0, sold: 0 };
  const dialect = sequelize.getDialect();
  const hiddenTrue = dialect === 'postgres' ? 'TRUE' : '1';
  const hiddenFalse = dialect === 'postgres' ? 'FALSE' : '0';

  const [hiddenResult] = await sequelize.query(`
    UPDATE products
    SET status = 'deleted_p', updated_at = CURRENT_TIMESTAMP
    WHERE deleted_at IS NULL
      AND CAST(stock_qty AS REAL) <= 0
      AND status = 'available'
      AND id IN (
        SELECT DISTINCT ii.product_id
        FROM invoice_items ii
        INNER JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.is_hidden = ${hiddenTrue}
          AND i.status != 'cancelled'
          AND (i.financial_mode IS NULL OR i.financial_mode != 'PRE_ACCOUNTS')
          AND ii.product_id IS NOT NULL
      )
  `);

  const [soldResult] = await sequelize.query(`
    UPDATE products
    SET status = 'sold', updated_at = CURRENT_TIMESTAMP
    WHERE deleted_at IS NULL
      AND CAST(stock_qty AS REAL) <= 0
      AND status = 'available'
      AND id IN (
        SELECT DISTINCT ii.product_id
        FROM invoice_items ii
        INNER JOIN invoices i ON i.id = ii.invoice_id
        WHERE (i.is_hidden = ${hiddenFalse} OR i.is_hidden IS NULL)
          AND i.status != 'cancelled'
          AND (i.financial_mode IS NULL OR i.financial_mode != 'PRE_ACCOUNTS')
          AND ii.product_id IS NOT NULL
      )
  `);

  const deletedP = Number(hiddenResult?.rowCount ?? hiddenResult?.changes ?? 0);
  const sold = Number(soldResult?.rowCount ?? soldResult?.changes ?? 0);
  return { deleted_p: deletedP, sold };
}
