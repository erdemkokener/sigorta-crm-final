const mongoose = require('mongoose');

const PolicySchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true }, // Legacy ID support
  customer_id: { type: Number, required: true },
  insurer: String,
  policy_number: String,
  policy_type: String,
  issue_date: String,
  start_date: String,
  end_date: String,
  description: String,
  status: { type: String, default: 'active' },
  premium: Number,
  notified_14: { type: Boolean, default: false },
  notified_end: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Policy', PolicySchema);
