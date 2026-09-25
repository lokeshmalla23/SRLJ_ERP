/**
 * node tests/csvParse.test.js
 */
import assert from 'assert';
import { parseCsv, detectDelimiter, looksLikeSpreadsheet } from '../../shared/domain/csvParse.js';

const inventoryExport = [
  'code,barcode,name,design_no,category_name,subcategory_name,metal_name,purity_name,gross_weight,net_weight,stock_qty,status',
  '10001,10001,Gold Ring,,Rings,Daily Wear,Gold,22K,3.850,3.600,1,available',
  '10002,10002,,,"Necklaces","Bridal Set",Gold,22K,22.54,20.80,1,available',
].join('\n');

{
  const { headers, rows } = parseCsv(inventoryExport);
  assert.strictEqual(headers[0], 'code');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].name, 'Gold Ring');
  assert.strictEqual(rows[0].category_name, 'Rings');
  assert.strictEqual(rows[0].stock_qty, '1');
  assert.strictEqual(rows[1].name, '');
  assert.strictEqual(rows[1].subcategory_name, 'Bridal Set');
}

{
  const labeled = [
    'Product Name,Code,Barcode,Category,Sub Category,Metal,Purity,Gross Weight (g),Stock Qty',
    '"22K Floral Necklace","GN-001","TAG001","Necklaces","Bridal","Gold","22K","22.540","1"',
  ].join('\r\n');
  const { rows } = parseCsv(labeled);
  assert.strictEqual(rows[0]['Product Name'], '22K Floral Necklace');
  assert.strictEqual(rows[0]['Sub Category'], 'Bridal');
  assert.strictEqual(rows[0]['Gross Weight (g)'], '22.540');
}

{
  const semi = 'Product Name;Code;Stock Qty\nRing;R1;1';
  assert.strictEqual(detectDelimiter(semi), ';');
  const { rows } = parseCsv(semi);
  assert.strictEqual(rows[0]['Product Name'], 'Ring');
  assert.strictEqual(rows[0].Code, 'R1');
}

{
  const bom = '\uFEFF' + 'name,code\nRing,R1';
  const { rows } = parseCsv(bom);
  assert.strictEqual(rows[0].name, 'Ring');
}

{
  const quoted = 'name,notes\n"Ring, Gold","He said ""hello"""';
  const { rows } = parseCsv(quoted);
  assert.strictEqual(rows[0].name, 'Ring, Gold');
  assert.strictEqual(rows[0].notes, 'He said "hello"');
}

assert.strictEqual(looksLikeSpreadsheet('inventory.xlsx', ''), true);
assert.strictEqual(looksLikeSpreadsheet('inventory.csv', 'code,name'), false);
assert.strictEqual(looksLikeSpreadsheet('inventory.csv', 'PK\x03\x04'), true);

console.log('csvParse.test.js OK');
