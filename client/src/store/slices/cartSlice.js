import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  items: [],
  discount: 0,
  discountPct: null,
  paymentMode: 'cash',
  customerId: null,
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addItem(state, action) {
      const p = action.payload;
      const existing = state.items.find((i) => i.product_id === p.id);
      if (existing) {
        existing.qty += 1;
      } else {
        state.items.push({
          product_id: p.id,
          name: p.name,
          unit: p.unit,
          unit_price: p.selling_price,
          tax_percent: p.tax_percent,
          discount: 0,
          discount_pct: p.discount_pct > 0 ? p.discount_pct : null,
          qty: 1,
          stock_qty: p.stock_qty,
        });
      }
    },
    addItemQty(state, action) {
      const { product, qty } = action.payload;
      const add = Math.max(1, Math.floor(qty) || 1);
      const existing = state.items.find((i) => i.product_id === product.id);
      if (existing) {
        existing.qty += add;
      } else {
        state.items.push({
          product_id: product.id,
          name: product.name,
          unit: product.unit,
          unit_price: product.selling_price,
          tax_percent: product.tax_percent,
          discount: 0,
          discount_pct: product.discount_pct > 0 ? product.discount_pct : null,
          qty: add,
          stock_qty: product.stock_qty,
        });
      }
    },
    setItems(state, action) {
      state.items = action.payload;
    },
    updateQty(state, action) {
      const { product_id, qty } = action.payload;
      const item = state.items.find((i) => i.product_id === product_id);
      if (item) item.qty = Math.max(1, qty);
    },
    updateItemDiscount(state, action) {
      const { product_id, discount } = action.payload;
      const item = state.items.find((i) => i.product_id === product_id);
      if (item) {
        item.discount = Math.max(0, discount);
        if (item.discount > 0) item.discount_pct = null;
      }
    },
    updateItemDiscountPct(state, action) {
      const { product_id, discount_pct } = action.payload;
      const item = state.items.find((i) => i.product_id === product_id);
      if (item) {
        item.discount_pct = Math.max(0, discount_pct);
        if (item.discount_pct > 0) item.discount = 0;
      }
    },
    setItemPrice(state, action) {
      const { product_id, unit_price } = action.payload;
      const item = state.items.find((i) => i.product_id === product_id);
      if (item) item.unit_price = Math.max(0, Number(unit_price) || 0);
    },
    removeItem(state, action) {
      state.items = state.items.filter((i) => i.product_id !== action.payload);
    },
    setDiscount(state, action) {
      state.discount = Math.max(0, action.payload);
      if (state.discount > 0) state.discountPct = null;
    },
    setDiscountPct(state, action) {
      state.discountPct = Math.max(0, action.payload);
      if (state.discountPct > 0) state.discount = 0;
    },
    setPaymentMode(state, action) {
      state.paymentMode = action.payload;
    },
    setCustomerId(state, action) {
      state.customerId = action.payload;
    },
    clearCart(state) {
      state.items = [];
      state.discount = 0;
      state.discountPct = null;
      state.paymentMode = 'cash';
      state.customerId = null;
    },
  },
});

export const {
  addItem,
  addItemQty,
  setItems,
  updateQty,
  updateItemDiscount,
  updateItemDiscountPct,
  setItemPrice,
  removeItem,
  setDiscount,
  setDiscountPct,
  setPaymentMode,
  setCustomerId,
  clearCart,
} = cartSlice.actions;
export default cartSlice.reducer;
