const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  customer_id: { type: Number, required: true },
  amount: { type: Number, required: true },
  note: String,
  date: String
}, { timestamps: true });

module.exports = mongoose.model('Payment', PaymentSchema);

