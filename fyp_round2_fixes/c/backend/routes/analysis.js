const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const SurveyResponse = require("../models/SurveyResponse");
const Survey = require("../models/Survey");
const ExcelJS = require("exceljs");

const router = express.Router();

/**
 * ENV you should set in backend/.env:
 * ANALYSIS_EXCEL_PATH=../data/feedback.xlsx   (example)
 * PYTHON_BIN=python                           (or python3)
 */

function getExcelPath() {
  // Use the same path as Python script - relative to backend directory
  const envPath = process.env.ANALYSIS_EXCEL_PATH || "./exports/master_feedback.xlsx";
  return path.resolve(__dirname, "..", envPath);
}

function getPythonBin() {
  return process.env.PYTHON_BIN || "python";
}

// Function to map survey questions to construct variable names
function mapQuestionToVariable(questionText, questionIndex, sectionTitle) {
  const sectionMappings = {
    'Infrastructure Capabilities': 'IC',
    'Management Capabilities': 'MC', 
    'User Experience': 'UX',
    'System Quality': 'SQ',
    'Service Quality': 'SV'
  };
  
  const lowerQuestion = questionText.toLowerCase();
  const lowerSection = sectionTitle ? sectionTitle.toLowerCase() : '';
  
  // Check if this section has a specific mapping
  for (const [section, prefix] of Object.entries(sectionMappings)) {
    if (lowerSection.includes(section.toLowerCase())) {
      return `${prefix}${questionIndex + 1}`;
    }
  }
  
  // Fallback to keyword-based mapping
  const keywordMappings = {
    'IC': ['infrastructure', 'capability', 'capabilities', 'system', 'technology', 'platform', 'hardware', 'software', 'network', 'server'],
    'MC': ['management', 'leadership', 'strategy', 'planning', 'organization', 'administration'],
    'UX': ['user', 'experience', 'usability', 'interface', 'satisfied', 'ease'],
    'SQ': ['quality', 'performance', 'speed', 'reliable', 'available', 'stable'],
    'SV': ['service', 'support', 'help', 'assistance', 'response']
  };
  
  for (const [construct, keywords] of Object.entries(keywordMappings)) {
    for (const keyword of keywords) {
      if (lowerQuestion.includes(keyword)) {
        return `${construct}${questionIndex + 1}`;
      }
    }
  }
  
  return `I${questionIndex + 1}`;
}

function getUploadedDatasetPath(orgEmail) {
  const fs = require("fs");
  const datasetsFile = path.join(__dirname, "..", "uploads", "datasets.json");
  if (!fs.existsSync(datasetsFile)) return null;
  const datasets = JSON.parse(fs.readFileSync(datasetsFile, "utf8"));
  const dataset = datasets.find((d) => d.orgEmail === orgEmail);
  if (!dataset || !fs.existsSync(dataset.filePath)) return null;
  return dataset.filePath;
}

// Helper function to create Excel file from database responses
async function createExcelFromDatabase(surveyId = null) {
  try {
    console.log("Creating Excel file from database responses...", surveyId ? `surveyId=${surveyId}` : "all surveys");
    
    const query = surveyId ? { surveyId } : {};
    const responses = await SurveyResponse.find(query)
      .populate('surveyId')
      .sort({ submittedAt: 1 });
    
    console.log(`Found ${responses.length} survey responses in database`);
    
    if (responses.length === 0) {
      console.log("No survey responses found in database");
      return false;
    }
    
    // Debug: Log first response to see structure
    if (responses.length > 0) {
      console.log("First response structure:", JSON.stringify(responses[0], null, 2));
    }
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Survey Responses');
    
    // Collect all unique questions from all surveys, organized by sections
    const allQuestions = new Set();
    const sectionQuestions = new Map(); // section -> questions
    const questionToSection = new Map(); // question -> section
    
    responses.forEach(response => {
      console.log(`Processing response from: ${response.studentEmail}`);
      if (response.surveyId) {
        console.log(`Survey title: ${response.surveyId.title}`);
        if (response.surveyId.sections) {
          response.surveyId.sections.forEach(section => {
            if (section.questions) {
              const sectionTitle = section.title || 'Untitled Section';
              if (!sectionQuestions.has(sectionTitle)) {
                sectionQuestions.set(sectionTitle, []);
              }
              
              section.questions.forEach(question => {
                allQuestions.add(question.text);
                sectionQuestions.get(sectionTitle).push(question.text);
                questionToSection.set(question.text, sectionTitle);
              });
            }
          });
        }
      } else {
        console.log("No surveyId found for response");
      }
    });
    
    const questionArray = Array.from(allQuestions);
    console.log(`Found ${questionArray.length} unique questions across ${sectionQuestions.size} sections`);
    console.log('Sections:', Array.from(sectionQuestions.keys()));
    
    // Map questions to variable names with section information
    const questionToVariableMap = new Map();
    const variableNames = [];
    let questionIndex = 0;
    
    for (const [sectionTitle, questions] of sectionQuestions.entries()) {
      console.log(`Processing section: ${sectionTitle} with ${questions.length} questions`);
      
      for (const question of questions) {
        const variableName = mapQuestionToVariable(question, questionIndex, sectionTitle);
        console.log(`Mapping question "${question}" from section "${sectionTitle}" to "${variableName}"`);
        questionToVariableMap.set(question, variableName);
        variableNames.push(variableName);
        questionIndex++;
      }
    }
    
    console.log(`Final mapped variables:`, variableNames);
    console.log(`Mapped questions to variables:`, Object.fromEntries(questionToVariableMap));
    
    // Set up headers with variable names
    const headers = ['studentemail', 'orgemail', 'surveytitle', 'submittedat', ...variableNames];
    worksheet.columns = headers.map(header => ({
      header: header,
      key: header, // Use the actual header as key, not lowercase version
      width: 20
    }));
    
    // Add data rows
    responses.forEach(response => {
      const rowData = {
        studentemail: response.studentEmail,
        orgemail: response.orgEmail,
        surveytitle: response.surveyId?.title || 'Unknown',
        submittedat: new Date(response.submittedAt).toLocaleDateString()
      };
      
      // Add answers for each question using variable names
      if (response.answers && Array.isArray(response.answers)) {
        response.answers.forEach(answer => {
          const questionText = answer.question;
          if (questionText && questionToVariableMap.has(questionText)) {
            const variableName = questionToVariableMap.get(questionText);
            rowData[variableName] = answer.answer || ''; // Use the actual variable name as key
          }
        });
      } else {
        console.log(`No answers array found for response from ${response.studentEmail}`);
      }
      
      worksheet.addRow(rowData);
    });
    
    // Add mean columns for each construct (ICM, EUMM, IQM, etc.)
    console.log("Adding mean columns for constructs...");
    
    // Group variables by construct
    const constructGroups = {};
    for (const variableName of variableNames) {
      // Extract construct prefix (e.g., 'IC' from 'IC1')
      const match = variableName.match(/^([A-Za-z]+)\d+$/);
      if (match) {
        const construct = match[1];
        if (!constructGroups[construct]) {
          constructGroups[construct] = [];
        }
        constructGroups[construct].push(variableName);
      }
    }
    
    console.log("Construct groups found:", constructGroups);
    
    // Add section-specific mean columns (one mean per construct group)
    console.log("Adding section-specific mean columns (one per construct group)...");
    
    // Create one mean column per construct group found
    let sectionIndex = 1;
    for (const [construct, items] of Object.entries(constructGroups)) {
      if (items.length > 1) { // Only add mean if there are multiple items
        const sectionMeanName = `M${sectionIndex}`; // M1, M2, M3, M4, M5
        console.log(`Adding section mean column: ${sectionMeanName} for construct group "${construct}" with items: ${items.join(', ')}`);
        
        // Add the section mean column to the worksheet
        const meanColumn = worksheet.getColumn(variableNames.length + 5);
        meanColumn.eachCell((cell, rowNumber) => {
          if (rowNumber === 1) {
            // Header row
            cell.value = sectionMeanName;
          } else if (rowNumber > 1) {
            // Calculate mean for each row
            const row = worksheet.getRow(rowNumber);
            let sum = 0;
            let count = 0;
            
            for (const item of items) {
              const itemValue = row.getCell(item).value;
              if (itemValue !== null && itemValue !== undefined && itemValue !== '') {
                const numValue = parseFloat(itemValue);
                if (!isNaN(numValue)) {
                  sum += numValue;
                  count++;
                }
              }
            }
            
            cell.value = count > 0 ? sum / count : 0;
          }
        });
        
        // Add to variable names array for Python script to detect
        variableNames.push(sectionMeanName);
        sectionIndex++;
      }
    }
    
    // Save the file
    const excelPath = getExcelPath();
    const exportsDir = path.dirname(excelPath);
    
    // Ensure exports directory exists
    const fs = require('fs');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
      console.log(`Created directory: ${exportsDir}`);
    }
    
    await workbook.xlsx.writeFile(excelPath);
    console.log(`Excel file created successfully at: ${excelPath}`);
    console.log(`Total responses exported: ${responses.length}`);
    console.log(`Total questions found: ${questionArray.length}`);
    
    return true;
  } catch (error) {
    console.error("Error creating Excel from database:", error);
    return false;
  }
}

function runPython(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, "..", "analysis_runner.py");
    const timeoutMs = Number(process.env.PYTHON_TIMEOUT_MS || 600000);

    console.log(`🐍 Running Python with payload:`, JSON.stringify(payload, null, 2));

    const py = spawn(getPythonBin(), [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      py.kill("SIGTERM");
      reject(new Error("Analysis timed out. Try a smaller file or fewer columns."));
    }, timeoutMs);

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.log(`🐍 Python exited with code: ${code}`);
      console.log(`🐍 Python stdout:`, stdout);
      console.log(`🐍 Python stderr:`, stderr);
      
      if (code !== 0) {
        return reject(
          new Error(
            `Python exited with code ${code}\n${stderr || "No stderr"}`
          )
        );
      }

      try {
        const parsed = parsePythonJsonOutput(stdout);
        console.log(`✅ Python parsed result: ok=${parsed.ok}, variables=${parsed.variables?.length || 0}`);
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(
            `Failed to parse Python JSON output.\nOutput:\n${stdout}\nStderr:\n${stderr}`
          )
        );
      }
    });

    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

/** Parse JSON from Python stdout (logs may appear on stdout before the JSON line). */
function parsePythonJsonOutput(stdout) {
  const trimmed = (stdout || "").trim();
  if (!trimmed) throw new Error("Empty Python stdout");

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // Try each line from bottom (script prints one JSON object last)
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

/**
 * GET /api/analysis/debug
 * Debug endpoint to check database content
 */
router.get("/debug", async (req, res) => {
  try {
    console.log("Debug: Checking database content...");
    
    // Count survey responses
    const responseCount = await SurveyResponse.countDocuments();
    console.log(`Total survey responses in database: ${responseCount}`);
    
    // Get sample responses
    const responses = await SurveyResponse.find({})
      .populate('surveyId')
      .limit(3);
    
    console.log("Sample responses:");
    responses.forEach((response, index) => {
      console.log(`Response ${index + 1}:`, {
        studentEmail: response.studentEmail,
        orgEmail: response.orgEmail,
        surveyTitle: response.surveyId?.title,
        answersCount: response.answers?.length || 0,
        hasSections: response.surveyId?.sections?.length || 0
      });
    });
    
    // Check if Excel file exists
    const excelPath = getExcelPath();
    const fs = require('fs');
    const excelExists = fs.existsSync(excelPath);
    
    console.log(`Excel file exists: ${excelExists}`);
    if (excelExists) {
      const stats = fs.statSync(excelPath);
      console.log(`Excel file size: ${stats.size} bytes`);
      console.log(`Excel file modified: ${stats.mtime}`);
    }
    
    res.json({
      responseCount,
      sampleResponses: responses.map(r => ({
        studentEmail: r.studentEmail,
        orgEmail: r.orgEmail,
        surveyTitle: r.surveyId?.title,
        answersCount: r.answers?.length || 0,
        hasSections: r.surveyId?.sections?.length || 0
      })),
      excelExists,
      excelPath,
      excelSize: excelExists ? fs.statSync(excelPath).size : 0
    });
    
  } catch (err) {
    console.error("Debug error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analysis/metadata
 * Returns available variables (columns) from Excel.
 * Optional: orgEmail to filter (if your Excel includes orgEmail column).
 */
router.get("/metadata", async (req, res) => {
  try {
    const excelPath = getExcelPath();
    const orgEmail = req.query.orgEmail || null;

    console.log(`Metadata request for orgEmail: ${orgEmail}`);
    console.log(`Excel path: ${excelPath}`);

    // Check if Excel file exists, if not, try to create it
    const fs = require('fs');
    const forceRecreate = req.query.force === 'true';
    
    if (!fs.existsSync(excelPath) || forceRecreate) {
      if (forceRecreate) {
        console.log("Force recreating Excel file from database...");
        if (fs.existsSync(excelPath)) {
          fs.unlinkSync(excelPath); // Delete existing file
        }
      } else {
        console.log("Excel file not found, attempting to create from database...");
      }
      const created = await createExcelFromDatabase();
      if (!created) {
        console.log("Failed to create Excel from database");
        return res.json({ 
          ok: false, 
          message: "No survey data available. Please create surveys and collect responses first." 
        });
      }
    } else {
      console.log("Excel file exists, proceeding with metadata extraction");
    }

    console.log("Running Python metadata extraction...");
    const result = await runPython({
      action: "metadata",
      excelPath,
      orgEmail,
      skipStats: true,  // Skip heavy stats for faster variable loading
    });

    console.log("Python metadata result:", JSON.stringify(result, null, 2));

    res.json(result);
  } catch (err) {
    console.error("metadata error:", err.message);
    console.error("Full error:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/analysis/run-runner
 * body: {
 *   surveyId: string
 * }
 * Runs the analysis runner script and returns available variables (section means)
 */
router.post("/run-runner", async (req, res) => {
  try {
    const { surveyId, source, orgEmail } = req.body;
    const fs = require("fs");
    let excelPath;

    if (source === "dataset") {
      if (!orgEmail) {
        return res.status(400).json({ message: "Organization email is required for dataset analysis." });
      }
      excelPath = getUploadedDatasetPath(orgEmail);
      if (!excelPath) {
        return res.status(400).json({ message: "No dataset uploaded. Please upload a file first." });
      }
    } else {
      const created = await createExcelFromDatabase(surveyId || null);
      if (!created) {
        return res.status(400).json({
          message: "No survey data available for analysis. Please create surveys and collect responses first.",
        });
      }
      excelPath = getExcelPath();
    }

    const isDataset = source === "dataset";
    const result = await runPython({
      action: "get-variables",
      excelPath,
      surveyId: surveyId || null,
      source: source || "forms",
      detectOnly: isDataset,
    });

    const variables = result.variables || [];
    if (variables.length === 0) {
      return res.status(400).json({
        message:
          "No section means could be calculated. Name item columns by section + number "
          + "(e.g. IC1, IC2, MC1, MC2, SQ1, SQ2 — at least 2 items per section). "
          + "Means like M_IC are computed automatically; do not rely only on M1/M2 columns in the file.",
        rowCount: result.rowCount,
        columnCount: result.columnCount,
      });
    }

    res.json({ ok: true, variables, excelPath });
  } catch (err) {
    console.error("run-runner error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/analysis/run
 * body: {
 *   orgEmail,
 *   mode: "forms" | "students",
 *   limit: number,
 *   dependent: string,
 *   independents: string[]
 * }
 */
router.post("/run", async (req, res) => {
  try {
    const fs = require("fs");
    const {
      orgEmail,
      mode,
      limit,
      dependent,
      independents,
      vizTypes,
      source,
      surveyId,
    } = req.body;

    let excelPath;
    if (source === "dataset") {
      if (!orgEmail) {
        return res.status(400).json({ message: "Organization email is required." });
      }
      excelPath = getUploadedDatasetPath(orgEmail);
      if (!excelPath) {
        return res.status(400).json({ message: "No dataset uploaded. Please upload a file first." });
      }
    } else {
      excelPath = getExcelPath();
      if (!fs.existsSync(excelPath)) {
        const created = await createExcelFromDatabase(surveyId || null);
        if (!created) {
          return res.status(400).json({
            message: "No survey data available for analysis. Please create surveys and collect responses first.",
          });
        }
      }
    }

    if (!dependent) {
      return res.status(400).json({ message: "Dependent variable is required." });
    }
    if (!Array.isArray(independents) || independents.length === 0) {
      return res.status(400).json({ message: "Select at least 1 independent variable." });
    }

    const result = await runPython({
      action: "run",
      excelPath,
      orgEmail: orgEmail || null,
      mode: mode || "forms",
      limit: Number(limit || 0),
      dependent,
      independents,
      vizTypes: vizTypes || [],
      surveyId: surveyId || null,
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error("run-analysis error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/analysis/outlier-analysis
 * body: {
 *   orgEmail,
 *   column: string,
 *   method: "iqr" | "zscore",
 *   removeOutliers: boolean
 * }
 */
router.post("/outlier-analysis", async (req, res) => {
  try {
    const excelPath = getExcelPath();

    // Check if Excel file exists
    const fs = require('fs');
    if (!fs.existsSync(excelPath)) {
      console.log("Excel file not found, attempting to create from database...");
      const created = await createExcelFromDatabase();
      if (!created) {
        return res.status(400).json({ 
          message: "No survey data available for analysis. Please create surveys and collect responses first." 
        });
      }
    }

    const { orgEmail, column, method, removeOutliers } = req.body;

    if (!column) {
      return res.status(400).json({ message: "Column is required for outlier analysis." });
    }

    const result = await runPython({
      action: "outlier_analysis",
      excelPath,
      orgEmail: orgEmail || null,
      column,
      method: method || "iqr",
      removeOutliers: removeOutliers || false,
    });

    res.json(result);
  } catch (err) {
    console.error("outlier-analysis error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// Interactive visualizations endpoint
router.post("/interactive-viz", async (req, res) => {
  try {
    const startTime = Date.now();
    console.log(`🎨 Interactive visualization started at: ${new Date().toISOString()}`);
    
    const { orgEmail, dependent, independents, vizTypes, excelPath } = req.body;
    
    console.log(`📊 Request: dependent=${dependent}, independents=${independents.join(',')}, vizTypes=${vizTypes.join(',')}`);
    
    const result = await runPython({
      action: "interactive_viz",
      excelPath: excelPath || getExcelPath(),
      dependent,
      independents,
      vizTypes,
    });
    
    const endTime = Date.now();
    console.log(`🎨 Interactive visualization completed in ${endTime - startTime}ms`);
    
    if (result.ok) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    console.error("Interactive visualization error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// Analysis for uploaded datasets
router.post("/uploaded-dataset/run", async (req, res) => {
  try {
    const startTime = Date.now();
    console.log(`🚀 Uploaded dataset analysis started at: ${new Date().toISOString()}`);
    
    const { orgEmail, dependent, independents, vizTypes } = req.body;

    if (!orgEmail) {
      return res.status(400).json({ message: "Organization email is required." });
    }

    if (!dependent || !independents || independents.length === 0) {
      return res.status(400).json({ message: "Dependent and independent variables are required." });
    }

    console.log(`📊 Analysis parameters: orgEmail=${orgEmail}, dependent=${dependent}, independents=[${independents.join(', ')}]`);

    const fs = require('fs');
    const uploadedExcelPath = getUploadedDatasetPath(orgEmail);
    if (!uploadedExcelPath) {
      return res.status(400).json({ message: "No dataset found for this organization." });
    }
    console.log(`📁 Using dataset file: ${uploadedExcelPath}`);

    const pythonStartTime = Date.now();
    const result = await runPython({
      action: "run",
      excelPath: uploadedExcelPath,
      orgEmail: orgEmail || null,
      dependent,
      independents,
      vizTypes: vizTypes || [],
    });
    const pythonEndTime = Date.now();
    
    console.log(`⏱️ Python analysis completed in ${pythonEndTime - pythonStartTime}ms`);
    console.log(`📊 Python result ok: ${result.ok}, has visualizations: ${!!result.visualizations}`);

    const endTime = Date.now();
    console.log(`✅ Total uploaded dataset analysis completed in ${endTime - startTime}ms`);

    res.json(result);
  } catch (err) {
    console.error("❌ uploaded-dataset-run error:", err.message);
    console.error("❌ Full error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Get metadata for uploaded dataset
router.get("/uploaded-dataset/metadata/:orgEmail", async (req, res) => {
  try {
    const { orgEmail } = req.params;
    console.log(`🔍 Looking for dataset for orgEmail: ${orgEmail}`);

    if (!orgEmail) {
      return res.status(400).json({ message: "Organization email is required." });
    }

    // Get the uploaded dataset file path
    const fs = require('fs');
    const datasetsFile = path.join(__dirname, '..', 'uploads', 'datasets.json');
    
    console.log(`📁 Checking datasets file: ${datasetsFile}`);
    
    if (!fs.existsSync(datasetsFile)) {
      console.log('❌ Datasets file does not exist');
      return res.status(400).json({ message: "No dataset uploaded for this organization." });
    }

    const data = fs.readFileSync(datasetsFile, 'utf8');
    const datasets = JSON.parse(data);
    
    console.log(`📊 Found ${datasets.length} datasets:`, datasets.map(d => ({ orgEmail: d.orgEmail, filename: d.filename })));
    
    const dataset = datasets.find(d => d.orgEmail === orgEmail);
    
    if (!dataset) {
      console.log(`❌ No dataset found for ${orgEmail}`);
      return res.status(400).json({ message: "No dataset found for this organization." });
    }

    // Use the uploaded dataset file path
    const uploadedExcelPath = dataset.filePath;
    console.log(`📁 Using dataset file: ${uploadedExcelPath}`);

    const result = await runPython({
      action: "metadata",
      excelPath: uploadedExcelPath,
      orgEmail: orgEmail || null,
      skipStats: true,  // Skip heavy stats for faster variable loading
    });

    console.log(`✅ Python result: ok=${result.ok}, variables=${result.variables?.length || 0}`);
    res.json(result);
  } catch (err) {
    console.error("❌ uploaded-dataset-metadata error:", err.message);
    console.error("❌ Full error:", err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/analysis/detect-type
 * body: { orgEmail } OR { excelPath }
 * Inspects an uploaded file and suggests whether it's a sales/business dataset
 * or a Likert/survey dataset, plus candidate dimension/metric/date columns.
 */
router.post("/detect-type", async (req, res) => {
  try {
    const { orgEmail, excelPath: bodyExcelPath } = req.body;

    let excelPath = bodyExcelPath;
    if (!excelPath) {
      if (!orgEmail) {
        return res.status(400).json({ message: "Organization email is required." });
      }
      excelPath = getUploadedDatasetPath(orgEmail);
      if (!excelPath) {
        return res.status(400).json({ message: "No dataset uploaded. Please upload a file first." });
      }
    }

    const result = await runPython({ action: "detect_type", excelPath });
    res.json(result);
  } catch (err) {
    console.error("detect-type error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/analysis/sales/aggregate
 * body: { orgEmail, dimension, metric, aggregation, topN }
 * Groups the uploaded sales/business dataset by `dimension` and aggregates `metric`
 * — powers the "country wise / region wise / product wise …" breakdown charts.
 */
router.post("/sales/aggregate", async (req, res) => {
  try {
    const { orgEmail, dimension, metric, aggregation, topN } = req.body;

    if (!orgEmail) {
      return res.status(400).json({ message: "Organization email is required." });
    }
    if (!dimension || !metric) {
      return res.status(400).json({ message: "Both a dimension (group by) and a metric are required." });
    }

    const excelPath = getUploadedDatasetPath(orgEmail);
    if (!excelPath) {
      return res.status(400).json({ message: "No dataset uploaded. Please upload a file first." });
    }

    const result = await runPython({
      action: "sales_aggregate",
      excelPath,
      dimension,
      metric,
      aggregation: aggregation || "sum",
      topN: topN || 10,
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error("sales/aggregate error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/analysis/sales/forecast
 * body: { orgEmail, dateColumn, metric, freq, periods, filterColumn, filterValue }
 * Forecasts a sales metric forward in time (Holt-Winters / Holt linear trend,
 * falling back to linear regression for very short series).
 */
router.post("/sales/forecast", async (req, res) => {
  try {
    const { orgEmail, dateColumn, metric, freq, periods, filterColumn, filterValue } = req.body;

    if (!orgEmail) {
      return res.status(400).json({ message: "Organization email is required." });
    }
    if (!metric) {
      return res.status(400).json({ message: "A metric column is required for forecasting." });
    }

    const excelPath = getUploadedDatasetPath(orgEmail);
    if (!excelPath) {
      return res.status(400).json({ message: "No dataset uploaded. Please upload a file first." });
    }

    const result = await runPython({
      action: "forecast",
      excelPath,
      dateColumn: dateColumn || "Order_Date",
      metric,
      freq: freq || "M",
      periods: periods || 12,
      filterColumn: filterColumn || null,
      filterValue: filterValue ?? null,
    });

    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error("sales/forecast error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
