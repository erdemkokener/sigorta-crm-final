const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true }, // Legacy ID support
  name: { type: String, required: true },
  phone: String,
  id_no: String,
  branch: { type: String, default: 'Akhisar' }, // Akhisar or Balıkesir
  email: String,
  profession: String,
  birth_date: String,
  salesperson_id: { type: Number },
  manual_debt: { type: Number, default: 0 },
  note: String
}, { timestamps: true });

module.exports = mongoose.model('Customer', CustomerSchema);
