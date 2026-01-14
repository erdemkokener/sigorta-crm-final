const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true }, // Legacy ID support
  name: { type: String, required: true },
  phone: String,
  id_no: String,
  email: String,
  birth_date: String
}, { timestamps: true });

module.exports = mongoose.model('Customer', CustomerSchema);
