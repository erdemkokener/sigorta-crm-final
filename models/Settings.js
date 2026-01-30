const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // e.g., 'admin_config'
  admin_user: String,
  admin_pass: String,
  // SMTP Configuration
  smtp_host: String,
  smtp_port: Number,
  smtp_user: String,
  smtp_pass: String,
  smtp_secure: Boolean, // true for 465, false for other ports usually
  smtp_from: String
});

module.exports = mongoose.model('Settings', SettingsSchema);
