const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const User = require('../models/User');

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role, course, semester, department, address, phone, orgName } = req.body;
    
    console.log('Signup request:', req.body);
    
    // For students, use registration number as email if no email provided
    const userEmail = email || (role === 'student' ? `${name}@student.local` : null);
    
    if (!userEmail) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    let user = await User.findOne({ email: userEmail });
    if (user) return res.status(400).json({ message: 'User already exists' });

    // Validate Student must have an Org
    if (role === 'student' && !orgName) {
      return res.status(400).json({ message: 'Please select your Organization' });
    }

    user = new User({ 
      name, 
      email: userEmail, 
      password, 
      role, 
      course, semester, department, orgName,
      address, phone 
    });
    
    await user.save();
    res.status(201).json({ message: 'Signup successful' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body; 
    const user = await User.findOne({ 
      $or: [{ email: email }, { name: email }],
      role: role 
    });

    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    res.json({ message: 'Login successful', user });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/all-orgs', async (req, res) => {
  try {
    const orgs = await User.find({ role: 'organization' }).select('name email address phone');
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update profile (name, phone, address, department, semester, course).
// Email is intentionally NOT editable here — it's the key used to link
// surveys, datasets, and responses throughout the app, so changing it
// would orphan that linked data.
router.put('/update-profile', async (req, res) => {
  try {
    const { email, name, phone, address, department, semester, course } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required to identify the account.' });
    }

    const update = {};
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (address !== undefined) update.address = address;
    if (department !== undefined) update.department = department;
    if (semester !== undefined) update.semester = semester;
    if (course !== undefined) update.course = course;

    const user = await User.findOneAndUpdate({ email }, update, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'Account not found.' });
    }
    res.json({ message: 'Profile updated', user });
  } catch (err) {
    console.error('update-profile error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Avatar / logo upload
const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
    cb(null, avatarDir);
  },
  filename: (req, file, cb) => {
    const safeEmail = String(req.body.email || 'user').replace(/[^a-zA-Z0-9.-]/g, '_');
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${safeEmail}_${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error('Only image files are allowed (png, jpg, webp, gif).'));
    }
    cb(null, true);
  },
});

router.post('/upload-avatar', (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded.' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const user = await User.findOneAndUpdate({ email }, { avatarUrl }, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'Account not found.' });
    }
    res.json({ message: 'Avatar updated', avatarUrl, user });
  } catch (err) {
    console.error('upload-avatar error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
