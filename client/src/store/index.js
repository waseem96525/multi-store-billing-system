import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import cartReducer from './slices/cartSlice';
import storeReducer from './slices/storeSlice';

const store = configureStore({
  reducer: {
    auth: authReducer,
    cart: cartReducer,
    store: storeReducer,
  },
});

export default store;
