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
  notified_end: { type: Boolean, default: false },
  policy_details: {
    plate: String,
    registration_no: String,
    profession: String,
    area_sqm: String,
    building_age: String,
    total_floors: String,
    floor_no: String,
    address_code: String,
    health_persons: [
      {
        name: String,
        id_no: String,
        birth_date: String,
        relation: String
      }
    ]
  }
}, { timestamps: true });

module.exports = mongoose.model('Policy', PolicySchema);
