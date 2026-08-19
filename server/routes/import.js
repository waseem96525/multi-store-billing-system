const express = require('express');
const db = require('../db');
const { authenticate, requirePerm } = require('../middleware/auth');
const { attachStore } = require('../middleware/store');
const { prepareLog } = require('../utils/activity');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(authenticate, attachStore);

// Normalize a header/key: lowercase, strip anything that isn't a letter/number.
// So "Cost Price", "cost_price", "CostPrice" all become "costprice".
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELD_ALIASES = {
  name: ['name', 'productname', 'product', 'item', 'itemname', 'productname'],
  sku: ['sku', 'productcode', 'itemcode', 'code'],
  barcode: ['barcode', 'barcodenumber', 'upc', 'ean'],
  category: ['category', 'categoryname', 'department'],
  unit: ['unit', 'uom', 'units'],
  cost_price: ['costprice', 'cost', 'purchaseprice', 'buyingprice'],
  selling_price: ['sellingprice', 'price', 'selling', 'saleprice', 'rate'],
  mrp: ['mrp', 'maxretailprice'],
  tax_percent: ['tax', 'taxpercent', 'gst', 'gstpercent', 'vat'],
  discount_pct: ['discountpct', 'discount', 'disc', 'offpercent', 'itemdiscount', 'itemdiscountpct', 'discountpercent'],
  stock_qty: ['stock', 'stockqty', 'quantity', 'qty', 'openingstock', 'currentstock'],
  reorder_level: ['reorderlevel', 'reorder', 'minstock', 'min', 'reorderpoint'],
  hsn_code: ['hsncode', 'hsn', 'gstcode'],
  expiry_date: ['expirydate', 'expiry', 'expdate'],
  location: ['location', 'shelf', 'rack', 'bin', 'aisle'],
  brand: ['brand', 'make'],
  description: ['description', 'desc', 'details', 'notes'],
};

const FIELD_BY_NORM = {};
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const a of aliases) FIELD_BY_NORM[norm(a)] = field;
}

const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

const has = (row, field) =>
  row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== '';

const MAX_ROWS = 5000;

// Bulk import products and stock. Each row is matched against existing
// products by barcode, then SKU, then name. Matches are updated; unknown
// products are created. Stock changes are recorded as stock adjustments.
// All writes for the whole batch are committed in ONE multi-path update.
router.post('/products', requirePerm('inventory.edit'), asyncHandler(async (req, res) => {
  const { rows } = req.body || {};
  const mode = (req.body || {}).stock_mode === 'set' ? 'set' : 'add';
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows required' });
  }
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows (max ${MAX_ROWS})` });
  }

  // One round of reads for the whole batch
  const [products, categories, stockRows, stores] = await Promise.all([
    db.all('products'),
    db.all('categories'),
    db.where('product_stock', (r) => Number(r.store_id) === Number(req.storeId)),
    db.all('stores'),
  ]);
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode, p]));
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku, p]));
  const byName = new Map(products.map((p) => [String(p.name).toLowerCase(), p]));
  const catByName = new Map(categories.map((c) => [String(c.name).toLowerCase(), c]));
  const stockMap = new Map(stockRows.map((r) => [Number(r.product_id), r]));

  // Pass 1: parse + validate every row, count new products/categories
  const entries = [];
  const newCategoryNames = new Map(); // lowercase -> name
  let newProductCount = 0;
  for (const [i, raw] of rows.entries()) {
    const rowNo = i + 2; // line 1 is the header
    const row = {};
    for (const [k, v] of Object.entries(raw || {})) {
      const field = FIELD_BY_NORM[norm(k)];
      if (field && row[field] === undefined) row[field] = v;
    }
    const name = row.name === undefined || row.name === null ? '' : String(row.name).trim();
    const entry = { rowNo, name };
    try {
      if (!name) throw new Error('Name is required');
      entry.cost = num(row.cost_price);
      entry.price = num(row.selling_price);
      entry.mrp = num(row.mrp);
      entry.tax = num(row.tax_percent);
      entry.disc = num(row.discount_pct);
      entry.reorder = num(row.reorder_level);
      entry.qty = num(row.stock_qty);
      if (entry.cost !== null && Number.isNaN(entry.cost)) throw new Error('Invalid cost price');
      if (entry.price !== null && Number.isNaN(entry.price)) throw new Error('Invalid selling price');
      if (entry.mrp !== null && Number.isNaN(entry.mrp)) throw new Error('Invalid MRP');
      if (entry.tax !== null && Number.isNaN(entry.tax)) throw new Error('Invalid tax %');
      if (entry.disc !== null && Number.isNaN(entry.disc)) throw new Error('Invalid discount %');
      if (entry.reorder !== null && Number.isNaN(entry.reorder)) throw new Error('Invalid reorder level');
      if (entry.qty !== null && Number.isNaN(entry.qty)) throw new Error('Invalid stock qty');

      entry.sku = has(row, 'sku') ? String(row.sku).trim() : null;
      entry.barcode = has(row, 'barcode') ? String(row.barcode).trim() : null;
      entry.categoryName = has(row, 'category') ? String(row.category).trim() : '';
      if (entry.categoryName && !catByName.has(entry.categoryName.toLowerCase())) {
        if (!newCategoryNames.has(entry.categoryName.toLowerCase())) {
          newCategoryNames.set(entry.categoryName.toLowerCase(), entry.categoryName);
        }
      }

      let existing = null;
      if (entry.barcode) existing = byBarcode.get(entry.barcode);
      if (!existing && entry.sku) existing = bySku.get(entry.sku);
      if (!existing) existing = byName.get(name.toLowerCase());
      entry.existing = existing;
      entry.unit = has(row, 'unit') ? String(row.unit).trim() : 'pcs';
      entry.description = has(row, 'description') ? String(row.description).trim() : null;
      entry.brand = has(row, 'brand') ? String(row.brand).trim() : null;
      entry.hsn_code = has(row, 'hsn_code') ? String(row.hsn_code).trim() : null;
      entry.expiry_date = has(row, 'expiry_date') ? String(row.expiry_date).trim() : null;
      entry.location = has(row, 'location') ? String(row.location).trim() : null;
      entry.reorderLevel = entry.reorder === null ? 0 : entry.reorder;

      if (existing) {
        entry.productId = existing.id;
        entry.status = 'updated';
      } else {
        newProductCount++;
        entry.status = 'created';
      }
      entries.push(entry);
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message;
      entries.push(entry);
    }
  }

  // Reserve ids for all new categories and products in a few round trips
  const [categoryIds, productIds] = await Promise.all([
    newCategoryNames.size ? db.reserveIds('categories', newCategoryNames.size) : Promise.resolve([]),
    newProductCount ? db.reserveIds('products', newProductCount) : Promise.resolve([]),
  ]);
  let catIdx = 0;
  let prodIdx = 0;

  const paths = {};
  const adjustments = [];
  const results = [];
  let created = 0;
  let updated = 0;
  let failed = 0;
  const now = db.now();

  // Pass 2: build the multi-path write
  for (const entry of entries) {
    if (entry.status === 'error') {
      failed++;
      results.push({ row: entry.rowNo, status: 'error', name: entry.name, error: entry.error });
      continue;
    }
    const {
      name,
      cost,
      price,
      mrp,
      tax,
      disc,
      qty,
      sku,
      barcode,
      categoryName,
      unit,
      existing,
      description,
      brand,
      hsn_code,
      expiry_date,
      location,
      reorderLevel,
    } = entry;

    let categoryId = null;
    if (categoryName) {
      const lower = categoryName.toLowerCase();
      const known = catByName.get(lower);
      if (known) {
        categoryId = known.id;
      } else {
        categoryId = categoryIds[catIdx++];
        paths[`categories/${categoryId}`] = { id: categoryId, name: categoryName };
        catByName.set(lower, { id: categoryId });
      }
    }

    if (entry.status === 'updated') {
      const cur = stockMap.get(entry.productId);
      const curQty = cur ? cur.stock_qty : 0;
      const newQty = qty === null ? curQty : mode === 'add' ? curQty + qty : qty;
      const delta = newQty - curQty;
      paths[`products/${entry.productId}`] = {
        id: entry.productId,
        name,
        sku: sku !== null ? sku : existing.sku,
        barcode: barcode !== null ? barcode : existing.barcode,
        category_id: categoryId !== null ? categoryId : existing.category_id,
        unit: unit !== 'pcs' || !existing.unit ? unit : existing.unit,
        cost_price: cost !== null ? cost : existing.cost_price,
        selling_price: price !== null ? price : existing.selling_price,
        tax_percent: tax !== null ? tax : existing.tax_percent,
        discount_pct: disc !== null ? disc : existing.discount_pct,
        description: description !== null ? description : existing.description,
        brand: brand !== null ? brand : existing.brand,
        hsn_code: hsn_code !== null ? hsn_code : existing.hsn_code,
        mrp: mrp !== null ? mrp : existing.mrp,
        expiry_date: expiry_date !== null ? expiry_date : existing.expiry_date,
        location: location !== null ? location : existing.location,
        created_at: existing.created_at,
        updated_at: now,
      };
      paths[`product_stock/${db.stockKey(entry.productId, req.storeId)}`] = {
        product_id: entry.productId,
        store_id: req.storeId,
        stock_qty: newQty,
        reorder_level: entry.reorder === null ? (cur ? cur.reorder_level : 0) : reorderLevel,
      };
      if (delta !== 0) {
        adjustments.push({
          product_id: entry.productId,
          change_qty: delta,
          reason: `Bulk import (${mode === 'add' ? 'add to stock' : 'set stock'})`,
        });
      }
      updated++;
      results.push({ row: entry.rowNo, status: 'updated', name, product_id: entry.productId });
    } else {
      const newId = productIds[prodIdx++];
      paths[`products/${newId}`] = {
        id: newId,
        name,
        sku,
        barcode,
        category_id: categoryId,
        unit,
        cost_price: cost !== null ? cost : 0,
        selling_price: price !== null ? price : 0,
        tax_percent: tax !== null ? tax : 0,
        discount_pct: disc !== null ? disc : 0,
        description,
        brand,
        hsn_code,
        mrp: mrp !== null ? mrp : 0,
        expiry_date,
        location,
        created_at: now,
        updated_at: now,
      };
      for (const s of stores) {
        paths[`product_stock/${db.stockKey(newId, s.id)}`] = {
          product_id: newId,
          store_id: s.id,
          stock_qty: 0,
          reorder_level: 0,
        };
      }
      const stockQty = qty === null ? 0 : qty;
      paths[`product_stock/${db.stockKey(newId, req.storeId)}`] = {
        product_id: newId,
        store_id: req.storeId,
        stock_qty: stockQty,
        reorder_level: reorderLevel,
      };
      if (stockQty !== 0) {
        adjustments.push({ product_id: newId, change_qty: stockQty, reason: 'Bulk import (new product)' });
      }
      created++;
      results.push({ row: entry.rowNo, status: 'created', name, product_id: newId });
    }
  }

  // Record one stock adjustment per changed product + the activity log entry
  // (all ids reserved in one round trip)
  const adjIds = adjustments.length ? await db.reserveIds('stock_adjustments', adjustments.length) : [];
  adjustments.forEach((a, i) => {
    const adjId = adjIds[i];
    paths[`stock_adjustments/${adjId}`] = {
      id: adjId,
      product_id: a.product_id,
      change_qty: a.change_qty,
      reason: a.reason,
      adjusted_by: req.user.id,
      store_id: req.storeId,
      created_at: db.now(),
    };
  });
  const log = await prepareLog(
    req.user,
    'bulk_import',
    `Bulk import (${mode}): ${created} created, ${updated} updated, ${failed} failed`,
    req.storeId
  );
  paths[log.key] = log.value;

  if (Object.keys(paths).length) await db.patchMulti(paths);

  res.json({ summary: { created, updated, failed }, results });
}));

module.exports = router;