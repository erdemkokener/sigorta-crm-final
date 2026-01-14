const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // e.g., 'admin_config'
  admin_user: String,
  admin_pass: String
});

module.exports = mongoose.model('Settings', SettingsSchema);
