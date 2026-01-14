const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  
  const uri = process.env.MONGODB_URI;
  if (!uri) return; // No URI, running in file mode

  try {
    await mongoose.connect(uri);
    isConnected = true;
    console.log('MongoDB bağlantısı başarılı.');
  } catch (err) {
    console.error('MongoDB bağlantı hatası:', err);
  }
}

module.exports = { connectDB, isConnected: () => isConnected };
