const mongoose = require('mongoose');

const ReminderSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  note: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  email: { type: String, required: true }, // Email to send to
  notified_morning: { type: Boolean, default: false },
  notified_afternoon: { type: Boolean, default: false },
  created_at: { type: String, default: () => new Date().toISOString() }
}, { timestamps: true });

module.exports = mongoose.model('Reminder', ReminderSchema);
