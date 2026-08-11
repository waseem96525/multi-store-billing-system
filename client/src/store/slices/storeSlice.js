import { createSlice } from '@reduxjs/toolkit';

const storedStoreId = localStorage.getItem('storeId');

const initialState = {
  stores: [],
  currentStoreId: storedStoreId ? Number(storedStoreId) : null,
  currentStore: null,
};

const storeSlice = createSlice({
  name: 'store',
  initialState,
  reducers: {
    setStores(state, action) {
      state.stores = action.payload;
      const fallback = action.payload[0] ? action.payload[0].id : null;
      if (!state.currentStoreId && fallback) {
        state.currentStoreId = fallback;
        localStorage.setItem('storeId', String(fallback));
      }
    },
    setCurrentStore(state, action) {
      state.currentStoreId = action.payload;
      localStorage.setItem('storeId', String(action.payload));
      state.currentStore = state.stores.find((s) => s.id === action.payload) || null;
    },
    setCurrentStoreInfo(state, action) {
      state.currentStore = action.payload;
    },
  },
});

export const { setStores, setCurrentStore, setCurrentStoreInfo } = storeSlice.actions;
export default storeSlice.reducer;
