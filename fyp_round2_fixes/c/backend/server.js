const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const connectDB = require("./config/db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Connect DB
connectDB();

// API Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api", require("./routes/feedback"));
app.use("/api/analysis", require("./routes/analysis")); // ✅ ADD THIS

/** Parse JSON object from Python stdout (diagnostic lines may precede JSON). */
function parsePythonJsonOutput(stdout) {
  const trimmed = (stdout || "").trim();
  if (!trimmed) throw new Error("Empty Python stdout");
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const lines = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith("{") && !line.startsWith("[")) continue;
      try {
        return JSON.parse(line);
      } catch {
        /* continue */
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("No JSON object found in stdout");
  }
}

// Multer configuration for dataset uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Create unique filename with timestamp and original name
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}_${originalName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB for large Excel files
  }
});

// Dataset upload endpoint
app.post('/api/dataset/upload', (req, res, next) => {
  upload.single('dataset')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum upload size is 100MB.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const orgEmail = req.body.orgEmail;
    if (!orgEmail) {
      return res.status(400).json({ error: 'Organization email is required' });
    }

    console.log(`📤 Uploading dataset for ${orgEmail}: ${req.file.originalname}`);

    // Store file info for this organization
    const uploadInfo = {
      orgEmail: orgEmail,
      filename: req.file.filename,
      originalName: req.file.originalname,
      uploadDate: new Date(),
      filePath: req.file.path
    };

    // Create a simple file-based storage for uploaded datasets
    const datasetsFile = path.join(__dirname, 'uploads', 'datasets.json');
    let datasets = [];
    
    if (fs.existsSync(datasetsFile)) {
      const data = fs.readFileSync(datasetsFile, 'utf8');
      datasets = JSON.parse(data);
    }

    // Remove any existing dataset for this organization
    datasets = datasets.filter(d => d.orgEmail !== orgEmail);
    
    // Add new dataset
    datasets.push(uploadInfo);
    
    // Save updated datasets list
    fs.writeFileSync(datasetsFile, JSON.stringify(datasets, null, 2));

    console.log(`📁 Dataset saved: ${uploadInfo.filePath}`);

    // Immediately run Python analysis on the uploaded file to extract variables
    console.log(`🐍 Running Python analysis on uploaded file...`);
    
    const { spawn } = require('child_process');
    const scriptPath = path.join(__dirname, 'analysis_runner.py');
    const pythonBin = process.env.PYTHON_BIN || 'python';
    
    const payload = {
      action: "get-variables",
      excelPath: uploadInfo.filePath,
      orgEmail: orgEmail,
      source: "dataset",
      flexible: true,
    };
    
    console.log(`🐍 Python payload:`, JSON.stringify(payload, null, 2));
    
    const py = spawn(pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("close", (code) => {
      console.log(`🐍 Python analysis completed with code: ${code}`);
      console.log(`🐍 Python stdout:`, stdout);
      console.log(`🐍 Python stderr:`, stderr);
      
      if (code !== 0) {
        console.error(`❌ Python analysis failed: ${stderr}`);
        // Still return upload success, but note the analysis failed
        return res.json({
          success: true,
          message: 'Dataset uploaded successfully, but analysis failed',
          filename: req.file.filename,
          originalName: req.file.originalname,
          analysisError: stderr
        });
      }

      try {
        const result = parsePythonJsonOutput(stdout);
        console.log(`✅ Python analysis successful: ok=${result.ok}, variables=${result.variables?.length || 0}`);
        
        res.json({
          success: true,
          message: 'Dataset uploaded and analyzed successfully!',
          filename: req.file.filename,
          originalName: req.file.originalname,
          analysis: {
            ok: result.ok,
            variables: result.variables || [],
            rowCount: result.rowCount || 0,
          }
        });
        
      } catch (e) {
        console.error(`❌ Failed to parse Python output: ${e.message}`);
        res.json({
          success: true,
          message: 'Dataset uploaded successfully, but could not parse analysis results',
          filename: req.file.filename,
          originalName: req.file.originalname,
          parseError: e.message
        });
      }
    });

    // Send the payload to Python
    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// Get any available dataset (for fallback)
app.get('/api/dataset/info/any', async (req, res) => {
  try {
    const datasetsFile = path.join(__dirname, 'uploads', 'datasets.json');
    
    if (!fs.existsSync(datasetsFile)) {
      return res.json({ success: false, message: 'No datasets found' });
    }

    const data = fs.readFileSync(datasetsFile, 'utf8');
    const datasets = JSON.parse(data);
    
    if (datasets.length > 0) {
      return res.json({
        success: true,
        filename: datasets[0].filename,
        originalName: datasets[0].originalName,
        uploadDate: datasets[0].uploadDate,
        orgEmail: datasets[0].orgEmail
      });
    } else {
      return res.json({ success: false, message: 'No datasets found' });
    }

  } catch (error) {
    console.error('Get any dataset error:', error);
    res.status(500).json({ error: 'Failed to get dataset info' });
  }
});

// Get uploaded dataset info
app.get('/api/dataset/info/:orgEmail', async (req, res) => {
  try {
    const orgEmail = req.params.orgEmail;
    const datasetsFile = path.join(__dirname, 'uploads', 'datasets.json');
    
    if (!fs.existsSync(datasetsFile)) {
      return res.json({ success: false, message: 'No dataset found' });
    }

    const data = fs.readFileSync(datasetsFile, 'utf8');
    const datasets = JSON.parse(data);
    
    const dataset = datasets.find(d => d.orgEmail === orgEmail);
    
    if (!dataset) {
      return res.json({ success: false, message: 'No dataset found for this organization' });
    }

    res.json({
      success: true,
      filename: dataset.filename,
      originalName: dataset.originalName,
      uploadDate: dataset.uploadDate
    });

  } catch (error) {
    console.error('Get dataset info error:', error);
    res.status(500).json({ error: 'Failed to get dataset info' });
  }
});

// Download Excel files
app.get("/api/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, filename);
  
  // Security check - only allow .xlsx files
  if (!filename.endsWith('.xlsx')) {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Send file
  res.download(filePath, filename, (err) => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(500).json({ error: 'Error downloading file' });
    }
  });
});

// Serve uploaded avatar/logo images (only this subfolder — dataset uploads stay private)
app.use('/uploads/avatars', express.static(path.join(__dirname, 'uploads', 'avatars')));

// Serve frontend static files
app.use(express.static(path.join(__dirname, "..", "frontend")));

// SPA fallback route (FIXED — no wildcard crash)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
