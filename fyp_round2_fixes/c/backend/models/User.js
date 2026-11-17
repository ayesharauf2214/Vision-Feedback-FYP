const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true }, // RegNo (Student) or Org Name (Org)
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['student', 'organization'], required: true },
  
  // Student Specific
  orgName: { type: String }, // Links student to specific Org
  course: String, 
  semester: String, 
  department: String,
  
  // Organization Specific
  address: String, 
  phone: String,

  avatarUrl: { type: String, default: '' }, // profile photo (student) / logo (organization)

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
