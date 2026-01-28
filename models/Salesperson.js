const mongoose = require('mongoose');

const SalespersonSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  phone: String,
  email: String,
  note: String
}, { timestamps: true });

module.exports = mongoose.model('Salesperson', SalespersonSchema);
