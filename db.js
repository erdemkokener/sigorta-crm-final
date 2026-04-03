const mongoose = require('mongoose');

let isConnected = false;
let lastError = null;

async function connectDB() {
  if (isConnected) return;
  
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    lastError = 'MONGODB_URI tanımlı değil. Sistem geçici dosya modunda çalışıyor.';
    return;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    lastError = null;
    console.log('--- MONGODB BAĞLANTISI BAŞARILI ---');
  } catch (err) {
    isConnected = false;
    lastError = err.message;
    console.error('--- MONGODB BAĞLANTI HATASI ---', err.message);
  }
}

module.exports = { 
  connectDB, 
  isConnected: () => isConnected,
  getLastError: () => lastError 
};
