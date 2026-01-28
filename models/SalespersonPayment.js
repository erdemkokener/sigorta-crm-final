const mongoose = require('mongoose');

const SalespersonPaymentSchema = new mongoose.Schema({
  salesperson_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  payment_date: { type: String, required: true }, // YYYY-MM-DD
  description: String,
  created_at: { type: String, default: () => new Date().toISOString() }
}, { timestamps: true });

module.exports = mongoose.model('SalespersonPayment', SalespersonPaymentSchema);
