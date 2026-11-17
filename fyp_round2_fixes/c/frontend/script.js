// ========== APP STATE ==========
const AppState = {
  isAuthenticated: false,
  currentUser: null,
  currentRole: 'student', // 'student' | 'organization'
  currentPage: 'dashboard',
  sidebarCollapsed: false,
  darkMode: false,
  aiResult: null,
  aiLoading: false,
  selectedForm: null,
  selectedDependentVar: null,
  selectedIndependentVars: [],
  analysisResults: null,
  analyticsStep: 1, // 1: source, 2: variables, 3: viz, 4: results
  selectedVisualizations: [],
  analysisSource: 'forms', // 'forms' | 'dataset'
  analysisLoading: false,
  recentAnalysis: null,
  // ---- Sales / Business dataset analytics ----
  datasetFlowStage: 'upload', // 'upload' | 'choose-type' | 'survey' | 'sales'
  datasetTypeInfo: null,      // result of /api/analysis/detect-type
  datasetTypeChosen: null,    // 'survey' | 'sales'
  salesStep: 1,                // 1: metric+agg, 2: chart type, 3: dimension, 4: results
  salesConfig: { metric: null, aggregation: 'sum', chartType: 'bar', dimension: null },
  salesResult: null,
  salesLoading: false,
  salesDashboard: [],
  forecastConfig: { metric: null, dateColumn: null, freq: 'M', periods: 12 },
  forecastResult: null,
  forecastLoading: false,
  showForecastPanel: false,
  profileSaving: false,
  avatarUploading: false,
};

function goToDatasetStage(stage) {
  AppState.datasetFlowStage = stage;
  renderPage();
}

function getApiBase() {
  const origin = window.location.origin;
  if (!origin || origin === 'null' || origin.startsWith('file:')) {
    return 'http://localhost:3000';
  }
  return origin;
}
const API_BASE = getApiBase();

// ========== REAL DATA STORAGE ==========
let realOrganizations = [];
let realStudents = [];
let realForms = [];
let realHistory = [];
let datasetVariables = [];

// ========== NAVIGATION CONFIG ==========
const studentNav = [
  { id: "dashboard", label: "Dashboard", icon: "🏠" },
  { id: "forms", label: "Fill Forms", icon: "📋" },
  { id: "feedback", label: "General Feedback", icon: "💬" },
  { id: "history", label: "History", icon: "🕒" },
  { id: "profile", label: "Profile", icon: "👤" },
];

const orgNav = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "forms", label: "Manage Forms", icon: "📝" },
  { id: "students", label: "View Students", icon: "🎓" },
  { id: "analytics", label: "Analytics", icon: "📈" },
  { id: "dataset", label: "Upload Dataset", icon: "🗄️" },
  { id: "feedback", label: "General Feedback", icon: "💬" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

// ========== UTILITY FUNCTIONS ==========
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== API FUNCTIONS ==========
async function apiRequest(endpoint, options = {}) {
  let res;
  try {
    res = await fetch(API_BASE + endpoint, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch {
    throw new Error('Cannot connect to server. Run: cd backend && npm start');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Invalid server response');
  }
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

// ========== AUTH FUNCTIONS ==========
async function loadOrganizations() {
  try {
    const orgsRes = await apiRequest('/api/auth/all-orgs');
    realOrganizations = orgsRes.map(org => org.name);
    
    // Update the organization dropdown in signup form
    const orgSelect = document.getElementById('signup-org');
    if (orgSelect) {
      orgSelect.innerHTML = '<option value="">-- Select organization --</option>' +
        realOrganizations.map(org => `<option value="${org}">${org}</option>`).join('');
    }
  } catch (error) {
    console.error('Error loading organizations:', error);
  }
}

function initAuth() {
  // Load organizations on page load
  loadOrganizations();
  
  // Role toggle
  document.getElementById('role-student').addEventListener('click', () => {
    document.getElementById('role-student').classList.add('active');
    document.getElementById('role-org').classList.remove('active');
    document.getElementById('username-label').textContent = 'Username';
    document.getElementById('login-username').placeholder = 'ahmed_raza';
  });

  document.getElementById('role-org').addEventListener('click', () => {
    document.getElementById('role-org').classList.add('active');
    document.getElementById('role-student').classList.remove('active');
    document.getElementById('username-label').textContent = 'Email';
    document.getElementById('login-username').placeholder = 'admin@university.edu';
  });

  // Password toggle
  document.getElementById('login-password-toggle').addEventListener('click', () => {
    const input = document.getElementById('login-password');
    const btn = document.getElementById('login-password-toggle');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🙈';
    } else {
      input.type = 'password';
      btn.textContent = '👁️';
    }
  });

  // Login submit
  document.getElementById('login-submit').addEventListener('click', handleLogin);

  // Signup navigation
  document.getElementById('goto-student-signup').addEventListener('click', () => {
    document.getElementById('login-form-container').style.display = 'none';
    document.getElementById('student-signup-container').style.display = 'block';
  });

  document.getElementById('goto-org-signup').addEventListener('click', () => {
    document.getElementById('login-form-container').style.display = 'none';
    document.getElementById('org-signup-container').style.display = 'block';
  });

  document.getElementById('back-to-login').addEventListener('click', () => {
    document.getElementById('student-signup-container').style.display = 'none';
    document.getElementById('login-form-container').style.display = 'block';
  });

  document.getElementById('back-to-login-org').addEventListener('click', () => {
    document.getElementById('org-signup-container').style.display = 'none';
    document.getElementById('login-form-container').style.display = 'block';
  });

  // Signup submits
  document.getElementById('student-signup-submit').addEventListener('click', handleStudentSignup);
  document.getElementById('org-signup-submit').addEventListener('click', handleOrgSignup);
}

async function handleLogin() {
  const role = document.getElementById('role-student').classList.contains('active') ? 'student' : 'organization';
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  console.log('Login attempt:', { role, username, passwordLength: password?.length });

  if (!username || !password) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  try {
    const res = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: username, password, role })
    });

    console.log('Login response:', res);

    AppState.isAuthenticated = true;
    AppState.currentRole = role;
    AppState.currentUser = res.user;

    showPage('dashboard-layout');
    document.getElementById('auth-page').classList.remove('active');
    document.getElementById('dashboard-layout').style.display = 'flex';
    
    // Load real data based on role
    await loadRealData();
    
    await initDashboard();
    showToast('Login successful!', 'success');
  } catch (error) {
    console.error('Login error:', error);
    showToast(error.message || 'Login failed', 'error');
  }
}

async function handleStudentSignup() {
  const username = document.getElementById('signup-username').value;
  const department = document.getElementById('signup-department').value;
  const email = document.getElementById('signup-email').value;
  const org = document.getElementById('signup-org').value;
  const password = document.getElementById('signup-password').value;

  if (!username || !department || !email || !password) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  try {
    await apiRequest('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: username,
        email: email,
        password: password,
        role: 'student',
        department: department,
        orgName: org
      })
    });

    showToast('Account created successfully!', 'success');
    document.getElementById('student-signup-container').style.display = 'none';
    document.getElementById('login-form-container').style.display = 'block';
  } catch (error) {
    showToast(error.message || 'Signup failed', 'error');
  }
}

async function handleOrgSignup() {
  const name = document.getElementById('org-signup-name').value;
  const email = document.getElementById('org-signup-email').value;
  const location = document.getElementById('org-signup-location').value;
  const password = document.getElementById('org-signup-password').value;

  if (!name || !email || !password) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  try {
    await apiRequest('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: name,
        email: email,
        password: password,
        role: 'organization',
        address: location
      })
    });

    showToast('Organization registered successfully!', 'success');
    document.getElementById('org-signup-container').style.display = 'none';
    document.getElementById('login-form-container').style.display = 'block';
  } catch (error) {
    showToast(error.message || 'Signup failed', 'error');
  }
}

// ========== DASHBOARD FUNCTIONS ==========
async function loadRealData() {
  try {
    if (AppState.currentRole === 'student') {
      // Get organization email from organization name
      const orgsRes = await apiRequest('/api/auth/all-orgs');
      const org = orgsRes.find(o => o.name === AppState.currentUser.orgName);
      const orgEmail = org ? org.email : AppState.currentUser.orgName;
      
      // Load forms available to this student
      const formsRes = await apiRequest(`/api/org-surveys?orgEmail=${orgEmail}&studentEmail=${AppState.currentUser.email}`);
      realForms = formsRes.surveys || [];
      
      // Load student's survey history
      const historyRes = await apiRequest(`/api/student-survey-history?studentEmail=${AppState.currentUser.email}`);
      realHistory = historyRes.history || [];
      
    } else if (AppState.currentRole === 'organization') {
      // Load students for this organization
      const studentsRes = await apiRequest(`/api/my-students?orgName=${AppState.currentUser.name}`);
      realStudents = studentsRes.students || [];
      
      // Load forms created by this organization
      const formsRes = await apiRequest(`/api/org-surveys?orgEmail=${AppState.currentUser.email}`);
      realForms = formsRes.surveys || [];
    }
  } catch (error) {
    console.error('Error loading real data:', error);
    showToast('Failed to load some data', 'error');
  }
}

async function initDashboard() {
  updateSidebar();
  updateUserInfo();
  if (AppState.currentRole === 'organization') {
    loadRecentAnalysis();
  }
  await renderPage();
  
  // Sidebar toggle
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', AppState.sidebarCollapsed);
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    AppState.darkMode = !AppState.darkMode;
    document.body.classList.toggle('dark-mode', AppState.darkMode);
    try { localStorage.setItem('visionFeedback_theme', AppState.darkMode ? 'dark' : 'light'); } catch { /* ignore */ }
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = AppState.darkMode ? '☀️' : '🌙';
    showToast(AppState.darkMode ? 'Dark mode enabled' : 'Light mode enabled', 'info');
    renderPage();
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

function updateSidebar() {
  const nav = AppState.currentRole === 'student' ? studentNav : orgNav;
  const navContainer = document.getElementById('sidebar-nav');
  navContainer.innerHTML = '';

  nav.forEach(item => {
    const button = document.createElement('button');
    button.className = AppState.currentPage === item.id ? 'active' : '';
    button.innerHTML = `
      <span class="sidebar-nav-icon">${item.icon}</span>
      <span class="sidebar-nav-label">${item.label}</span>
    `;
    button.addEventListener('click', async () => {
      AppState.currentPage = item.id;
      // Reset analytics step when navigating to analytics
      if (item.id === 'analytics') {
        resetAnalysisState('forms');
      }
      if (item.id === 'dataset') {
        resetAnalysisState('dataset');
      }
      updateSidebar();
      await renderPage();
      if (item.id === 'feedback') {
        initFeedbackPage();
      }
    });
    navContainer.appendChild(button);
  });
}

function updateUserInfo() {
  const user = AppState.currentUser;
  if (!user) return;

  const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase();
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = user.avatarUrl
      ? `<img src="${API_BASE}${user.avatarUrl}" alt="avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
      : initials;
  }
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-role').textContent = AppState.currentRole === 'student' ? 'Student' : 'Organization';
}

function handleLogout() {
  AppState.isAuthenticated = false;
  AppState.currentUser = null;
  AppState.currentPage = 'dashboard';
  
  document.getElementById('dashboard-layout').style.display = 'none';
  document.getElementById('auth-page').classList.add('active');
  
  showToast('Logged out successfully', 'info');
}

// ========== PAGE RENDERING ==========
async function renderPage() {
  const pageContent = document.getElementById('page-content');
  const pageTitle = document.getElementById('page-title');
  
  const titles = {
    dashboard: "Dashboard",
    forms: AppState.currentRole === 'organization' ? "Manage Forms" : "Fill Forms",
    students: "View Students",
    analytics: "Analytics",
    dataset: "Upload Dataset",
    feedback: "General Feedback",
    settings: "Settings",
    profile: "My Profile",
    history: "Submission History",
  };

  pageTitle.textContent = titles[AppState.currentPage] || "Dashboard";

  switch (AppState.currentPage) {
    case 'dashboard':
      pageContent.innerHTML = AppState.currentRole === 'student' ? renderStudentDashboard() : renderOrgDashboard();
      initOrgDashboardCharts();
      break;
    case 'forms':
      pageContent.innerHTML = renderFormsPage();
      initFormsPage();
      break;
    case 'students':
      pageContent.innerHTML = renderStudentsPage();
      break;
    case 'analytics':
      pageContent.innerHTML = renderAnalyticsPage();
      break;
    case 'dataset':
      pageContent.innerHTML = renderDatasetPage();
      initDatasetUpload();
      initSalesCharts();
      break;
    case 'feedback':
      pageContent.innerHTML = renderFeedbackPage();
      break;
    case 'history':
      pageContent.innerHTML = renderHistoryPage();
      break;
    case 'profile':
    case 'settings':
      pageContent.innerHTML = renderProfilePage();
      break;
    default:
      pageContent.innerHTML = renderStudentDashboard();
  }
}

// ========== PAGE COMPONENTS ==========
function renderStudentDashboard() {
  const completedForms = realHistory.length;
  const availableForms = realForms.length;
  const pendingForms = availableForms - completedForms;
  
  return `
    <div class="welcome-hero">
      <div class="welcome-hero-text">
        <p>Welcome back,</p>
        <h2>${AppState.currentUser?.name || 'Student'} 👋</h2>
        <p>You have ${pendingForms > 0 ? pendingForms : 'no'} pending forms to complete</p>
      </div>
      <div class="welcome-hero-stats">
        <div class="welcome-stat">
          <p>Forms Filled</p>
          <p class="welcome-stat-value">${completedForms}</p>
        </div>
        <div class="welcome-stat">
          <p>Pending</p>
          <p class="welcome-stat-value">${pendingForms}</p>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Total Responses</span>
          <span class="stat-card-icon" style="background: var(--indigo-light); color: var(--indigo);">📝</span>
        </div>
        <span class="stat-card-value">${completedForms}</span>
        <span class="stat-card-sub">Completed surveys</span>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Forms</span>
          <span class="stat-card-icon" style="background: #f3e8ff; color: var(--violet);">📋</span>
        </div>
        <span class="stat-card-value">${availableForms}</span>
        <span class="stat-card-sub">Available now</span>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Organization</span>
          <span class="stat-card-icon" style="background: #d1fae5; color: var(--success);">🏫</span>
        </div>
        <span class="stat-card-value">${AppState.currentUser?.orgName || 'N/A'}</span>
        <span class="stat-card-sub">Your institution</span>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Department</span>
          <span class="stat-card-icon" style="background: #cffafe; color: var(--cyan);">�</span>
        </div>
        <span class="stat-card-value">${AppState.currentUser?.department || 'N/A'}</span>
        <span class="stat-card-sub">Your department</span>
      </div>
    </div>

    <h3 class="section-header">Recent Questionnaires</h3>
    <div class="cards-grid">
      ${realForms.slice(0, 3).map(f => `
        <div class="card">
          <div class="card-header">
            <span class="status-badge active">Active</span>
          </div>
          <h4 class="card-title">${f.title}</h4>
          <p class="card-subtitle">${f.description || 'No description'}</p>
          <p class="card-meta">${f.sections?.length || 0} sections · ${countFormQuestions(f)} questions</p>
          <button type="button" class="card-btn" data-action="fill-form" data-id="${f._id}">Start Form →</button>
        </div>
      `).join('')}
      ${realForms.length === 0 ? '<p style="color: var(--muted);">No forms available yet.</p>' : ''}
    </div>
  `;
}

function getRecentAnalysisStorageKey() {
  return `visionFeedback_recent_${AppState.currentUser?.email || 'org'}`;
}

function loadRecentAnalysis() {
  try {
    const raw = localStorage.getItem(getRecentAnalysisStorageKey());
    AppState.recentAnalysis = raw ? JSON.parse(raw) : null;
  } catch {
    AppState.recentAnalysis = null;
  }
}

function saveRecentAnalysis(results) {
  if (!results || AppState.currentRole !== 'organization') return;
  const viz = results.visualizations || {};
  const plotOrder = [
    'qqplot', 'ppplot', 'combined_ppplot', 'histogram', 'combined_histogram',
    'correlation_heatmap', 'correlation', 'regression_plot', 'regression',
    'residuals_plot', 'residuals', 'coefficients_plot', 'cronbach_alpha', 'ave_values'
  ];
  const skipDashboard = new Set(['model_summary']);
  const trimmedViz = {};
  const keys = [...new Set([...plotOrder, ...Object.keys(viz)])];
  let n = 0;
  for (const k of keys) {
    if (viz[k] && !skipDashboard.has(k) && n < 12) {
      trimmedViz[k] = viz[k];
      n++;
    }
  }
  const payload = {
    savedAt: new Date().toISOString(),
    visualizations: trimmedViz,
    dependent: results.dependent,
    independents: results.independents || [],
    r2: results.r2,
    adjR2: results.adjR2,
    pValue: results.pValue,
    fullResults: !!results.fullResults,
    coefficients: results.coefficients
  };
  try {
    localStorage.setItem(getRecentAnalysisStorageKey(), JSON.stringify(payload));
    AppState.recentAnalysis = payload;
  } catch {
    payload.visualizations = {};
    try {
      localStorage.setItem(getRecentAnalysisStorageKey(), JSON.stringify(payload));
      AppState.recentAnalysis = payload;
    } catch { /* storage full */ }
  }
  if (AppState.currentPage === 'dashboard') {
    renderPage();
  }
}

const DASHBOARD_CHART_SKIP = new Set(['model_summary']);

function getChartDisplayMeta(key) {
  const meta = {
    qqplot: { label: 'Q-Q Plot', icon: '◈', hue: '#6366f1' },
    ppplot: { label: 'P-P Plot', icon: '◇', hue: '#7c3aed' },
    combined_ppplot: { label: 'P-P Plot', icon: '◇', hue: '#7c3aed' },
    histogram: { label: 'Histogram', icon: '▥', hue: '#0891b2' },
    combined_histogram: { label: 'Histogram', icon: '▥', hue: '#0891b2' },
    correlation: { label: 'Correlation', icon: '◫', hue: '#059669' },
    correlation_heatmap: { label: 'Correlation Matrix', icon: '◫', hue: '#059669' },
    regression: { label: 'Regression', icon: '↗', hue: '#db2777' },
    regression_plot: { label: 'Regression', icon: '↗', hue: '#db2777' },
    residuals: { label: 'Residuals', icon: '〜', hue: '#ea580c' },
    residuals_plot: { label: 'Residuals', icon: '〜', hue: '#ea580c' },
    coefficients_plot: { label: 'Coefficients', icon: '▮', hue: '#4f46e5' },
    cronbach_alpha: { label: 'Reliability', icon: 'α', hue: '#0d9488' },
    ave_values: { label: 'Validity (AVE)', icon: '✓', hue: '#2563eb' },
  };
  return meta[key] || { label: formatVizTitle(key), icon: '◆', hue: '#6366f1' };
}

function getDashboardPlotEntries(viz) {
  return Object.entries(viz || {}).filter(
    ([key, b64]) => b64 && !DASHBOARD_CHART_SKIP.has(key)
  );
}

function renderDashboardRecentPlots() {
  const recent = AppState.recentAnalysis;
  if (!recent) {
    return `
      <section class="dashboard-charts">
        <div class="dashboard-charts-empty">
          <div class="dashboard-charts-empty-icon">📊</div>
          <p>Your charts will appear here after you run an analysis.</p>
          <button type="button" class="btn-primary" onclick="AppState.currentPage='analytics'; updateSidebar(); renderPage();">Go to Analytics</button>
        </div>
      </section>
    `;
  }

  const entries = getDashboardPlotEntries(recent.visualizations);
  const timeLabel = recent.savedAt
    ? new Date(recent.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  if (entries.length === 0) {
    return `
      <section class="dashboard-charts">
        <div class="dashboard-charts-empty">
          <div class="dashboard-charts-empty-icon">🖼️</div>
          <p>No plots in the last run. In Analytics, choose charts or <strong>Complete Results</strong>.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="dashboard-charts">
      <div class="dashboard-charts-head">
        <div class="dashboard-charts-head-text">
          <h3 class="dashboard-charts-title">Survey Regression Charts</h3>
          ${timeLabel ? `<span class="dashboard-charts-time">${timeLabel}</span>` : ''}
        </div>
        <button type="button" class="dashboard-charts-expand" onclick="openRecentAnalysisFull()" title="Open in Analytics">
          Expand ↗
        </button>
      </div>
      <div class="dashboard-charts-gallery">
        ${entries.map(([key, b64], idx) => {
          const m = getChartDisplayMeta(key);
          const hero = idx === 0 ? ' chart-card--hero' : '';
          return `
            <article class="chart-card${hero}" style="--chart-accent: ${m.hue}">
              <div class="chart-card__top">
                <span class="chart-card__icon" aria-hidden="true">${m.icon}</span>
                <span class="chart-card__label">${m.label}</span>
              </div>
              <div class="chart-card__frame">
                <img src="data:image/png;base64,${b64}" alt="${m.label}" loading="lazy">
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function openRecentAnalysisFull() {
  if (!AppState.recentAnalysis) return;
  AppState.analysisResults = { ...AppState.recentAnalysis, ok: true };
  AppState.currentPage = 'analytics';
  AppState.analyticsStep = 4;
  updateSidebar();
  renderPage();
}

function renderOrgDashboard() {
  loadRecentAnalysis();
  const totalForms = realForms.length;
  const totalStudents = realStudents.length;
  const totalResponses = realForms.reduce((acc, f) => acc + (f.responseCount || 0), 0);
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return `
    <div class="dashboard-welcome">
      <div>
        <h2 class="dashboard-welcome__title">Welcome back, ${AppState.currentUser?.name || 'there'} 👋</h2>
        <p class="dashboard-welcome__date">${todayLabel}</p>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Total Forms</span>
          <span class="stat-card-icon" style="background: var(--indigo-light); color: var(--indigo);">📝</span>
        </div>
        <span class="stat-card-value">${totalForms}</span>
        <span class="stat-card-sub">Created surveys</span>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Total Responses</span>
          <span class="stat-card-icon" style="background: #f3e8ff; color: var(--violet);">📊</span>
        </div>
        <span class="stat-card-value">${totalResponses}</span>
        <span class="stat-card-sub">All time</span>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Active Students</span>
          <span class="stat-card-icon" style="background: #cffafe; color: var(--cyan);">🎓</span>
        </div>
        <span class="stat-card-value">${totalStudents}</span>
        <span class="stat-card-sub">Enrolled</span>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-label">Organization</span>
          <span class="stat-card-icon" style="background: #d1fae5; color: var(--success);">🏫</span>
        </div>
        <span class="stat-card-value">${AppState.currentUser?.name || 'N/A'}</span>
        <span class="stat-card-sub">Your institution</span>
      </div>
    </div>

    ${renderSalesDashboardSection()}

    ${renderDashboardRecentPlots()}

    <h3 class="section-header">Recent Forms</h3>
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Form Title</th>
            <th>Sections</th>
            <th>Questions</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${realForms.map(f => `
            <tr>
              <td style="font-weight: 500; color: var(--slate);">${f.title}</td>
              <td style="color: var(--muted);">${f.sections?.length || 0}</td>
              <td style="color: var(--muted);">${countFormQuestions(f)}</td>
              <td><span class="status-badge active">Active</span></td>
            </tr>
          `).join('')}
          ${realForms.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--muted);">No forms created yet</td></tr>' : ''}
        </tbody>
      </table>
    </div>
  `;
}

function countFormQuestions(survey) {
  if (typeof countSurveyQuestionsPublic === 'function') {
    return countSurveyQuestionsPublic(survey);
  }
  let n = 0;
  (survey.sections || []).forEach((s) => {
    n += (s.questions || []).length;
    (s.subsections || []).forEach((sub) => { n += (sub.questions || []).length; });
  });
  return n;
}

function renderFormsPage() {
  if (AppState.currentRole === 'student') {
    return `
      <div class="search-filter-bar">
        <input type="text" class="search-input" placeholder="Search forms..." id="forms-search">
      </div>
      <div class="cards-grid" id="student-forms-grid">
        ${realForms.map(f => `
          <div class="card" data-form-id="${f._id}">
            <div class="card-header">
              <span class="status-badge active">Active</span>
            </div>
            <h4 class="card-title">${f.title}</h4>
            <p class="card-subtitle">${f.description || 'No description'}</p>
            <p class="card-meta">${f.sections?.length || 0} sections · ${countFormQuestions(f)} questions</p>
            <button type="button" class="card-btn" data-action="fill-form" data-id="${f._id}">Start Form →</button>
          </div>
        `).join('')}
        ${realForms.length === 0 ? '<p style="color: var(--muted);">No forms available for you yet.</p>' : ''}
      </div>
    `;
  }

  return `
    <div style="display: flex; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
      <input type="text" class="search-input" placeholder="Search forms..." style="width: 260px;" id="forms-search">
      <button type="button" class="btn-create" id="btn-create-form">+ Create Form</button>
    </div>
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Form Title</th>
            <th>Sections</th>
            <th>Questions</th>
            <th>Audience</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${realForms.map(f => `
            <tr>
              <td style="font-weight: 500; color: var(--slate);">${f.title}</td>
              <td style="color: var(--muted);">${f.sections?.length || 0}</td>
              <td style="color: var(--muted);">${countFormQuestions(f)}</td>
              <td style="color: var(--muted); font-size: 13px;">${typeof formAudienceLabel === 'function' ? formAudienceLabel(f) : 'All students'}</td>
              <td>
                <button type="button" class="action-btn action-btn-primary" data-action="edit-form" data-id="${f._id}">Edit</button>
                <button type="button" class="action-btn action-btn-danger" data-action="delete-form" data-id="${f._id}">Delete</button>
              </td>
            </tr>
          `).join('')}
          ${realForms.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--muted);">No forms created yet. Click Create Form to build a questionnaire.</td></tr>' : ''}
        </tbody>
      </table>
    </div>
  `;
}

function handleFormsPageClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'edit-form' && id) openFormBuilderEdit(id);
  if (action === 'delete-form' && id) deleteForm(id);
  if (action === 'fill-form' && id) openFormFill(id);
}

function initFormsPage() {
  document.getElementById('btn-create-form')?.addEventListener('click', () => openFormBuilderCreate());
  const pc = document.getElementById('page-content');
  if (pc && !window._formsClickBound) {
    window._formsClickBound = true;
    pc.addEventListener('click', handleFormsPageClick);
  }
}

async function deleteForm(surveyId) {
  if (!confirm('Delete this form and all its responses?')) return;
  try {
    await apiRequest(`/api/delete-survey/${surveyId}`, { method: 'DELETE' });
    showToast('Form deleted', 'success');
    await loadRealData();
    await renderPage();
    initFormsPage();
  } catch (e) {
    showToast(e.message || 'Delete failed', 'error');
  }
}

function renderStudentsPage() {
  return `
    <div class="search-filter-bar">
      <input type="text" class="search-input" placeholder="Search students...">
      <select class="filter-select">
        <option>All Departments</option>
        <option>Computer Science</option>
        <option>Business</option>
        <option>Data Science</option>
      </select>
    </div>
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Department</th>
            <th>Email</th>
            <th>Course</th>
            <th>Semester</th>
          </tr>
        </thead>
        <tbody>
          ${realStudents.map(s => `
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div style="width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, var(--indigo), var(--violet)); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;">${s.name.split(' ').map(n => n[0]).join('')}</div>
                  <span style="font-weight: 500; color: var(--slate);">${s.name}</span>
                </div>
              </td>
              <td style="color: var(--muted);">${s.department || 'N/A'}</td>
              <td style="color: var(--muted);">${s.email}</td>
              <td style="color: var(--muted);">${s.course || 'N/A'}</td>
              <td style="color: var(--muted);">${s.semester || 'N/A'}</td>
            </tr>
          `).join('')}
          ${realStudents.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--muted);">No students enrolled yet</td></tr>' : ''}
        </tbody>
      </table>
    </div>
  `;
}

function resetAnalysisState(source) {
  AppState.analyticsStep = 1;
  AppState.analysisSource = source;
  AppState.selectedForm = null;
  AppState.selectedDependentVar = null;
  AppState.selectedIndependentVars = [];
  AppState.selectedVisualizations = [];
  AppState.analysisResults = null;
  AppState.analysisLoading = false;
  datasetVariables = [];

  if (source === 'dataset') {
    AppState.datasetFlowStage = 'upload';
    AppState.datasetTypeInfo = null;
    AppState.datasetTypeChosen = null;
    AppState.salesStep = 1;
    AppState.salesConfig = { metric: null, aggregation: 'sum', chartType: 'bar', dimension: null };
    AppState.salesResult = null;
    AppState.salesLoading = false;
    AppState.forecastConfig = { metric: null, dateColumn: null, freq: 'M', periods: 12 };
    AppState.forecastResult = null;
    AppState.forecastLoading = false;
    AppState.showForecastPanel = false;
  }
}

function renderAnalyticsPage() {
  if (AppState.analyticsStep === 1) return renderAnalysisStep1Forms();
  if (AppState.analyticsStep === 2) return renderAnalysisStep2Variables();
  if (AppState.analyticsStep === 3) return renderAnalysisStep3Visualizations();
  if (AppState.analyticsStep === 4) return renderAnalysisStep4Results();
  return '';
}

function renderDatasetPage() {
  if (AppState.datasetFlowStage === 'choose-type') return renderDatasetTypeChoice();
  if (AppState.datasetFlowStage === 'sales') return renderSalesWizardPage();
  if (AppState.datasetFlowStage === 'survey') {
    if (AppState.analyticsStep === 2) return renderAnalysisStep2Variables();
    if (AppState.analyticsStep === 3) return renderAnalysisStep3Visualizations();
    if (AppState.analyticsStep === 4) return renderAnalysisStep4Results();
  }
  return renderAnalysisStep1DatasetUpload();
}

function renderAnalysisStep1Forms() {
  return `
    <div style="max-width: 800px;">
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 20px; font-size: 18px; font-weight: 700; color: var(--slate);">Step 1: Select Form</h3>
        <p style="margin: 0 0 20px; color: var(--muted); font-size: 14px;">Choose a form, then press OK. Section means (M_IC, M_MC, …) are calculated automatically from item scores.</p>
        <div class="form-group">
          <label class="form-label">Available Forms</label>
          <select id="analytics-form-select" class="form-input">
            <option value="">-- Select a form --</option>
            ${realForms.map(f => `<option value="${f._id}">${f.title}</option>`).join('')}
            ${realForms.length === 0 ? '<option disabled>No forms available</option>' : ''}
          </select>
        </div>
        <button class="btn-primary" style="width: 100%; margin-top: 12px;" onclick="handleFormSelection()" ${AppState.analysisLoading ? 'disabled' : ''}>
          ${AppState.analysisLoading ? 'Running analysis_runner.py...' : 'OK'}
        </button>
      </div>
    </div>
  `;
}

function renderAnalysisStep1DatasetUpload() {
  return `
    <div style="max-width: 800px;">
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 12px; font-size: 18px; font-weight: 700; color: var(--slate);">Step 1: Upload Dataset</h3>
        <p style="margin: 0 0 20px; color: var(--muted); font-size: 14px;">Upload CSV or XLSX with item columns (IC1, IC2, …). Section means are calculated automatically.</p>
        <div class="upload-zone" id="dataset-upload-zone">
          <div class="upload-zone-icon">🗂️</div>
          <p class="upload-zone-title">Drag & drop your CSV / XLSX here</p>
          <p class="upload-zone-subtitle">or click to browse · CSV/XLSX · max 100MB (large files supported)</p>
          <input type="file" id="dataset-file-input" accept=".csv,.xlsx,.xls" style="display: none;">
        </div>
        ${AppState.analysisLoading ? '<p style="margin-top: 16px; color: var(--indigo); font-size: 14px;">Running analysis_runner.py...</p>' : ''}
      </div>
    </div>
  `;
}

function renderAnalysisStep2Variables() {
  const subtitle = AppState.analysisSource === 'forms'
    ? `Form: ${realForms.find(f => f._id === AppState.selectedForm)?.title || 'Unknown'} · Auto-calculated section means (M_IC, M_MC, …)`
    : 'Uploaded dataset · Auto-calculated section means (M_IC, M_MC, …)';
  return `
    <div style="max-width: 800px;">
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 20px; font-size: 18px; font-weight: 700; color: var(--slate);">Step 2: Select Variables</h3>
        <p style="margin: 0 0 20px; color: var(--muted); font-size: 14px;">${subtitle}</p>
        ${AppState.analysisLoading ? '<p style="margin: 0 0 16px; color: var(--indigo); font-size: 13px;">Loading variables…</p>' : ''}
        <div class="form-group">
          <label class="form-label">Dependent Variable</label>
          <select id="analytics-dependent-select" class="form-input" onchange="handleDependentSelect()">
            <option value="">-- Select dependent variable --</option>
            ${datasetVariables.map(v => `<option value="${v.id}" ${AppState.selectedDependentVar === v.id ? 'selected' : ''}>${v.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Independent Variables</label>
          <div id="analytics-independent-container" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
            ${renderIndependentTags()}
          </div>
          <select id="analytics-independent-select" class="form-input" onchange="handleIndependentAdd()">
            <option value="">-- Add independent variable --</option>
            ${datasetVariables.filter(v => v.id !== AppState.selectedDependentVar).map(v => `<option value="${v.id}">${v.name}</option>`).join('')}
          </select>
        </div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button class="btn-secondary" onclick="goToAnalyticsStep(1)">Back</button>
          <button id="vars-ok-btn" class="btn-primary" style="flex: 1;" onclick="handleVariableSelection()" ${!AppState.selectedDependentVar ? 'disabled' : ''}>OK</button>
        </div>
      </div>
    </div>
  `;
}

function renderIndependentTags() {
  if (!AppState.selectedIndependentVars.length) {
    return '<span style="color: var(--muted); font-size: 13px;">No independent variables selected</span>';
  }
  return AppState.selectedIndependentVars.map(v => {
    const varData = datasetVariables.find(vd => vd.id === v);
    return `<span style="background: var(--indigo-light); color: var(--indigo); padding: 6px 12px; border-radius: 20px; font-size: 12px; display: flex; align-items: center; gap: 6px;">
      ${varData?.name || v}
      <button type="button" onclick="removeIndependentVar('${v}')" style="background: none; border: none; cursor: pointer; font-size: 14px; color: var(--indigo);">×</button>
    </span>`;
  }).join('');
}

function renderAnalysisStep3Visualizations() {
  const vizOptions = [
    { id: 'null', label: 'Complete Results (All)', desc: 'Full analysis: regression, reliability, validity, and all charts' },
    { id: 'histogram', label: 'Histogram', desc: 'Distribution of variables' },
    { id: 'ppplot', label: 'P-P Plot', desc: 'Probability-Probability plot' },
    { id: 'qqplot', label: 'Q-Q Plot', desc: 'Quantile-Quantile normality plot' },
    { id: 'scatter', label: 'Scatter / Regression Plot', desc: 'Relationship between variables' },
    { id: 'correlation', label: 'Correlation Matrix', desc: 'Correlation between variables' },
    { id: 'regression', label: 'Regression Plot', desc: 'Regression line and fit' }
  ];
  return `
    <div style="max-width: 800px;">
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 20px; font-size: 18px; font-weight: 700; color: var(--slate);">Step 3: Select Results to Display</h3>
        <p style="margin: 0 0 20px; color: var(--muted); font-size: 14px;">Choose specific outputs, or select Complete Results. Press OK to run analysis_runner.py again.</p>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${vizOptions.map(viz => `
            <label style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; ${AppState.selectedVisualizations.includes(viz.id) ? 'background: var(--indigo-light); border-color: var(--indigo);' : ''}">
              <input type="checkbox" ${AppState.selectedVisualizations.includes(viz.id) ? 'checked' : ''} onchange="handleVisualizationToggle('${viz.id}')" style="width: 18px; height: 18px;">
              <div>
                <span style="font-weight: 600; color: var(--slate);">${viz.label}</span>
                <p style="margin: 0; color: var(--muted); font-size: 12px;">${viz.desc}</p>
              </div>
            </label>
          `).join('')}
        </div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button class="btn-secondary" onclick="goToAnalyticsStep(2)">Back</button>
          <button class="btn-primary" style="flex: 1;" onclick="handleVisualizationSelection()" ${AppState.analysisLoading ? 'disabled' : ''}>
            ${AppState.analysisLoading ? 'Running analysis...' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function formatVizTitle(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function shouldShowRegressionSummary() {
  const sel = AppState.selectedVisualizations || [];
  if (sel.includes('null')) return true;
  if (AppState.analysisResults?.fullResults) return true;
  return sel.some(v => ['regression', 'scatter', 'residuals'].includes(v));
}

function renderAnalysisPlots(visualizations) {
  if (!visualizations || typeof visualizations !== 'object') return '';
  const entries = Object.entries(visualizations).filter(([, b64]) => b64);
  if (!entries.length) {
    return '<div style="background:#fff;border-radius:16px;border:1px solid var(--border);padding:24px;color:var(--muted);">No charts were generated for this selection.</div>';
  }
  return entries.map(([key, b64]) => `
    <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; margin-bottom: 20px;">
      <h4 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: var(--slate);">${formatVizTitle(key)}</h4>
      <img src="data:image/png;base64,${b64}" alt="${key}" style="max-width: 100%; border-radius: 8px;">
    </div>
  `).join('');
}

function renderAnalysisStep4Results() {
  const restart = AppState.analysisSource === 'dataset'
    ? "resetAnalysisState('dataset'); renderPage();"
    : "resetAnalysisState('forms'); renderPage();";
  return `
    <div style="max-width: 900px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--slate);">Step 4: Analysis Results</h3>
        <button class="btn-secondary" onclick="${restart}">Start New Analysis</button>
      </div>
      ${AppState.analysisLoading ? `
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 48px; text-align: center; color: var(--indigo);">
          Running analysis_runner.py...
        </div>
      ` : AppState.analysisResults?.ok !== false && AppState.analysisResults ? `
        ${shouldShowRegressionSummary() ? `
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: var(--slate);">Regression Summary</h4>
          <p style="margin: 0 0 16px; color: var(--muted); font-size: 13px;">
            R² = ${AppState.analysisResults.r2 != null ? Number(AppState.analysisResults.r2).toFixed(3) : 'N/A'} ·
            Adjusted R² = ${AppState.analysisResults.adjR2 != null ? Number(AppState.analysisResults.adjR2).toFixed(3) : 'N/A'} ·
            p ${AppState.analysisResults.pValue || 'N/A'}
            ${AppState.analysisResults.fullResults ? ' · Complete analysis' : ''}
          </p>
          <div class="table-container">
            <table class="data-table">
              <thead><tr><th>Variable</th><th>β</th><th>t</th><th>p</th><th>Sig.</th></tr></thead>
              <tbody>
                ${(AppState.analysisResults.coefficients || []).map(r => `
                  <tr>
                    <td style="font-weight: 500;">${r.var}</td>
                    <td>${r.beta != null ? Number(r.beta).toFixed(3) : '—'}</td>
                    <td>${r.t != null ? Number(r.t).toFixed(2) : '—'}</td>
                    <td>${r.p}</td>
                    <td><span style="color: ${r.sig ? 'var(--success)' : 'var(--muted)'};">${r.sig ? '***' : 'n.s.'}</span></td>
                  </tr>
                `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);">No coefficients</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}
        ${renderAnalysisPlots(AppState.analysisResults.visualizations)}
      ` : `
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; text-align: center; color: var(--muted);">
          ${AppState.analysisResults?.error || 'No results available'}
        </div>
      `}
    </div>
  `;
}

// ========== ANALYTICS HANDLERS ==========
function mapRunnerVariables(variables) {
  datasetVariables = (variables || []).map(v => ({
    id: v.name,
    name: v.name,
    type: v.type || 'numeric'
  }));
}

async function runAnalysisRunnerStep1() {
  const body = AppState.analysisSource === 'dataset'
    ? { source: 'dataset', orgEmail: AppState.currentUser?.email }
    : { surveyId: AppState.selectedForm, source: 'forms' };

  const res = await apiRequest('/api/analysis/run-runner', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  if (!res.variables?.length) {
    throw new Error(
      res.message ||
        'No section means calculated. Use item columns per section (e.g. IC1, IC2, MC1, MC2). Means M_IC, M_MC are computed automatically.'
    );
  }
  mapRunnerVariables(res.variables);
}

async function handleFormSelection() {
  const formSelect = document.getElementById('analytics-form-select');
  const formId = formSelect?.value;
  if (!formId) {
    showToast('Please select a form', 'error');
    return;
  }

  AppState.selectedForm = formId;
  AppState.selectedDependentVar = null;
  AppState.selectedIndependentVars = [];
  AppState.selectedVisualizations = [];
  AppState.analysisResults = null;
  AppState.analysisLoading = true;
  await renderPage();

  try {
    showToast('Running analysis_runner.py...', 'info');
    await runAnalysisRunnerStep1();
    showToast('Section means loaded', 'success');
    AppState.analysisLoading = false;
    goToAnalyticsStep(2);
  } catch (error) {
    AppState.analysisLoading = false;
    await renderPage();
    showToast(error.message || 'Failed to run analysis runner', 'error');
  }
}

function handleDependentSelect() {
  const dependentSelect = document.getElementById('analytics-dependent-select');
  const okBtn = document.getElementById('vars-ok-btn');
  
  AppState.selectedDependentVar = dependentSelect.value;
  
  // Enable OK button if dependent is selected
  if (okBtn) {
    okBtn.disabled = !AppState.selectedDependentVar;
  }
}

function handleVariableSelection() {
  if (!AppState.selectedDependentVar) {
    showToast('Please select a dependent variable', 'error');
    return;
  }
  
  if (AppState.selectedIndependentVars.length === 0) {
    showToast('Please select at least one independent variable', 'error');
    return;
  }
  
  // Move to step 3
  goToAnalyticsStep(3);
}

function handleVisualizationToggle(vizId) {
  if (vizId === 'null') {
    AppState.selectedVisualizations = AppState.selectedVisualizations.includes('null')
      ? []
      : ['null'];
  } else {
    AppState.selectedVisualizations = AppState.selectedVisualizations.filter(v => v !== 'null');
    if (AppState.selectedVisualizations.includes(vizId)) {
      AppState.selectedVisualizations = AppState.selectedVisualizations.filter(v => v !== vizId);
    } else {
      AppState.selectedVisualizations.push(vizId);
    }
  }
  renderPage();
}

async function handleVisualizationSelection() {
  if (AppState.selectedVisualizations.length === 0) {
    showToast('Select at least one result type, or choose Complete Results', 'error');
    return;
  }
  goToAnalyticsStep(4);
  await runAnalysis();
}

function goToAnalyticsStep(step) {
  AppState.analyticsStep = step;
  renderPage();
}

function handleIndependentAdd() {
  const independentSelect = document.getElementById('analytics-independent-select');
  const varId = independentSelect?.value;
  if (varId && varId !== AppState.selectedDependentVar && !AppState.selectedIndependentVars.includes(varId)) {
    AppState.selectedIndependentVars.push(varId);
    independentSelect.value = '';
    renderPage();
  }
}

function removeIndependentVar(varId) {
  AppState.selectedIndependentVars = AppState.selectedIndependentVars.filter(v => v !== varId);
  renderPage();
}

async function runAnalysis() {
  if (!AppState.selectedDependentVar || AppState.selectedIndependentVars.length === 0) {
    showToast('Select dependent and independent variables first', 'error');
    goToAnalyticsStep(2);
    return;
  }

  AppState.analysisLoading = true;
  AppState.analysisResults = null;
  await renderPage();

  const vizTypes = AppState.selectedVisualizations.length
    ? AppState.selectedVisualizations
    : ['null'];

  const body = {
    orgEmail: AppState.currentUser?.email || null,
    dependent: AppState.selectedDependentVar,
    independents: AppState.selectedIndependentVars,
    vizTypes,
    source: AppState.analysisSource,
    surveyId: AppState.selectedForm || null,
    mode: 'forms',
    limit: 0
  };

  try {
    showToast('Running analysis_runner.py...', 'info');
    const res = await apiRequest('/api/analysis/run', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    AppState.analysisResults = res;
    saveRecentAnalysis(res);
    showToast('Charts updated on your dashboard', 'success');
  } catch (error) {
    AppState.analysisResults = { ok: false, error: error.message };
    showToast('Analysis failed: ' + error.message, 'error');
  } finally {
    AppState.analysisLoading = false;
    await renderPage();
  }
}

function initDatasetUpload() {
  const zone = document.getElementById('dataset-upload-zone');
  const input = document.getElementById('dataset-file-input');
  if (!zone || !input) return;

  zone.onclick = () => input.click();
  input.onchange = () => {
    if (input.files?.[0]) handleDatasetFile(input.files[0]);
  };
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragging'); };
  zone.ondragleave = () => zone.classList.remove('dragging');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    if (e.dataTransfer.files?.[0]) handleDatasetFile(e.dataTransfer.files[0]);
  };
}

async function handleDatasetFile(file) {
  const orgEmail = AppState.currentUser?.email;
  if (!orgEmail) {
    showToast('Please log in as organization', 'error');
    return;
  }

  const maxBytes = 100 * 1024 * 1024;
  if (file.size > maxBytes) {
    showToast('File is too large. Maximum size is 100MB.', 'error');
    return;
  }

  const ext = (file.name || '').toLowerCase();
  if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
    showToast('Please upload a CSV or Excel file (.csv, .xlsx, .xls)', 'error');
    return;
  }

  AppState.analysisLoading = true;
  await renderPage();

  const formData = new FormData();
  formData.append('dataset', file);
  formData.append('orgEmail', orgEmail);

  try {
    const res = await fetch(API_BASE + '/api/dataset/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || 'Upload failed');

    showToast('Dataset uploaded. Analyzing structure...', 'info');
    AppState.analysisSource = 'dataset';

    let typeInfo = null;
    try {
      typeInfo = await apiRequest('/api/analysis/detect-type', {
        method: 'POST',
        body: JSON.stringify({ orgEmail })
      });
    } catch (e) {
      console.warn('Dataset type detection failed:', e.message);
    }
    AppState.datasetTypeInfo = (typeInfo && typeInfo.ok) ? typeInfo : null;
    AppState.datasetTypeChosen = null;
    AppState.analysisLoading = false;
    goToDatasetStage('choose-type');
    showToast('Dataset uploaded. Choose how you want to analyze it.', 'success');
  } catch (error) {
    AppState.analysisLoading = false;
    await renderPage();
    showToast(error.message || 'Upload failed', 'error');
  }
}

function renderDatasetTypeChoice() {
  const info = AppState.datasetTypeInfo;
  const detected = info?.datasetType || 'unknown';
  const rows = info?.rowCount;
  const cols = info?.columnCount;

  const typeCards = [
    {
      id: 'survey', icon: '📋', title: 'Survey / Numeric Scale Data',
      desc: 'Likert-scale items or numeric ratings. Pick dependent & independent variables and run a regression analysis.',
    },
    {
      id: 'sales', icon: '🛒', title: 'Sales / Business Data',
      desc: 'Transactions with columns like Country, Region, Product, Revenue, Profit. Build breakdown charts, a live dashboard, and forecasts.',
    },
  ];

  return `
    <div style="max-width: 860px;">
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px;">
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--slate);">What kind of dataset is this?</h3>
        <p style="margin: 0 0 4px; color: var(--muted); font-size: 13px;">
          ${rows != null ? `${rows} rows · ${cols} columns. ` : ''}
          ${detected !== 'unknown'
            ? `This looks like <strong>${detected === 'sales' ? 'Sales / Business' : 'Survey / Numeric'}</strong> data — confirm below or pick the other option.`
            : "We couldn't tell automatically — pick the option that matches your file."}
        </p>
        <div class="dataset-type-grid">
          ${typeCards.map(c => `
            <button type="button" class="dataset-type-card${detected === c.id ? ' dataset-type-card--suggested' : ''}" onclick="chooseDatasetType('${c.id}')">
              ${detected === c.id ? '<span class="dataset-type-card__badge">Detected</span>' : ''}
              <span class="dataset-type-card__icon">${c.icon}</span>
              <span class="dataset-type-card__title">${c.title}</span>
              <span class="dataset-type-card__desc">${c.desc}</span>
            </button>
          `).join('')}
        </div>
        ${(info?.dimensions?.length || info?.metrics?.length) ? `
          <div style="margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border);">
            <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em;">Columns we found</p>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${(info.dimensions || []).slice(0, 8).map(d => `<span class="col-chip col-chip--dim">${d.name}</span>`).join('')}
              ${(info.metrics || []).slice(0, 8).map(m => `<span class="col-chip col-chip--metric">${m.name}</span>`).join('')}
            </div>
          </div>
        ` : ''}
        <div style="margin-top: 20px;">
          <button class="btn-secondary" onclick="goToDatasetStage('upload')">← Upload a different file</button>
        </div>
      </div>
    </div>
  `;
}

async function chooseDatasetType(type) {
  AppState.datasetTypeChosen = type;

  if (type === 'sales') {
    AppState.datasetFlowStage = 'sales';
    AppState.salesStep = 1;
    renderPage();
    return;
  }

  AppState.datasetFlowStage = 'survey';
  AppState.analyticsStep = 2;
  AppState.analysisLoading = true;
  await renderPage();
  try {
    await runAnalysisRunnerStep1();
    AppState.selectedDependentVar = null;
    AppState.selectedIndependentVars = [];
    AppState.selectedVisualizations = [];
    AppState.analysisResults = null;
    AppState.analysisLoading = false;
    await renderPage();
    showToast('Variables loaded from uploaded dataset', 'success');
  } catch (error) {
    AppState.analysisLoading = false;
    await renderPage();
    showToast(error.message || 'Failed to load variables', 'error');
  }
}

// ========== SALES / BUSINESS DATASET ANALYTICS ==========

function getSalesDimensionOptions() {
  const info = AppState.datasetTypeInfo;
  const dims = (info?.dimensions || []).map(d => d.name);
  const goodTimeDims = ['year', 'quarter', 'month', 'month_name', 'week', 'day'];
  const timeDims = (info?.dateColumns || []).filter(c => goodTimeDims.includes(String(c).trim().toLowerCase()));
  return [...new Set([...timeDims, ...dims])];
}

function formatMetricLabel(name) {
  return name ? String(name).replace(/_/g, ' ') : '';
}

function formatSalesNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toFixed(2);
}

const CHART_TYPE_OPTIONS = [
  { id: 'bar', label: 'Bar Chart', icon: '📊', desc: 'Compare values across categories' },
  { id: 'line', label: 'Line Chart', icon: '📈', desc: 'Best for trends over time' },
  { id: 'area', label: 'Area Chart', icon: '🏔️', desc: 'Trend with a filled volume' },
  { id: 'pie', label: 'Pie Chart', icon: '🥧', desc: 'Share of the whole' },
  { id: 'doughnut', label: 'Donut Chart', icon: '🍩', desc: 'Share of the whole, modern look' },
  { id: 'radar', label: 'Radar Chart', icon: '🕸️', desc: 'Compare across many categories' },
];

function renderSalesStepper(activeStep) {
  const steps = ['Metric', 'Chart Type', 'Breakdown', 'Results'];
  return `
    <div class="sales-stepper">
      ${steps.map((label, i) => `
        <div class="sales-stepper__item${i + 1 === activeStep ? ' sales-stepper__item--active' : ''}${i + 1 < activeStep ? ' sales-stepper__item--done' : ''}">
          <span class="sales-stepper__num">${i + 1 < activeStep ? '✓' : i + 1}</span>
          <span class="sales-stepper__label">${label}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSalesWizardPage() {
  if (AppState.salesStep === 1) return renderSalesStep1();
  if (AppState.salesStep === 2) return renderSalesStep2();
  if (AppState.salesStep === 3) return renderSalesStep3();
  if (AppState.salesStep === 4) return renderSalesStep4();
  return renderSalesStep1();
}

function goToSalesStep(step) {
  AppState.salesStep = step;
  renderPage();
}

function resetSalesWizard() {
  AppState.salesStep = 1;
  AppState.salesConfig = { metric: null, aggregation: 'sum', chartType: 'bar', dimension: null };
  AppState.salesResult = null;
  AppState.showForecastPanel = false;
  AppState.forecastResult = null;
  renderPage();
}

function renderSalesStep1() {
  const metrics = AppState.datasetTypeInfo?.metrics || [];
  const aggOptions = [
    { id: 'sum', label: 'Sum (total)' },
    { id: 'mean', label: 'Average' },
    { id: 'count', label: 'Count (number of records)' },
    { id: 'max', label: 'Maximum' },
    { id: 'min', label: 'Minimum' },
  ];
  return `
    <div style="max-width: 800px;">
      ${renderSalesStepper(1)}
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px;">
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--slate);">Step 1: What do you want to measure?</h3>
        <p style="margin: 0 0 20px; color: var(--muted); font-size: 14px;">Choose the numeric column to analyze and how to summarize it.</p>
        ${metrics.length === 0 ? '<p style="color: var(--danger); font-size: 13px;">No numeric metric columns were detected in this file.</p>' : ''}
        <div class="form-group">
          <label class="form-label">Metric</label>
          <select id="sales-metric-select" class="form-input" onchange="handleSalesMetricSelect()">
            <option value="">-- Select a metric --</option>
            ${metrics.map(m => `<option value="${m.name}" ${AppState.salesConfig.metric === m.name ? 'selected' : ''}>${formatMetricLabel(m.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Aggregation</label>
          <select id="sales-agg-select" class="form-input" onchange="handleSalesAggSelect()">
            ${aggOptions.map(a => `<option value="${a.id}" ${AppState.salesConfig.aggregation === a.id ? 'selected' : ''}>${a.label}</option>`).join('')}
          </select>
        </div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button class="btn-secondary" onclick="goToDatasetStage('choose-type')">Back</button>
          <button id="sales-step1-next-btn" class="btn-primary" style="flex: 1;" onclick="goToSalesStep(2)" ${!AppState.salesConfig.metric ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    </div>
  `;
}

function handleSalesMetricSelect() {
  const sel = document.getElementById('sales-metric-select');
  AppState.salesConfig.metric = sel?.value || null;
  const btn = document.getElementById('sales-step1-next-btn');
  if (btn) btn.disabled = !AppState.salesConfig.metric;
}

function handleSalesAggSelect() {
  const sel = document.getElementById('sales-agg-select');
  AppState.salesConfig.aggregation = sel?.value || 'sum';
}

function renderSalesStep2() {
  return `
    <div style="max-width: 800px;">
      ${renderSalesStepper(2)}
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px;">
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--slate);">Step 2: How should we chart it?</h3>
        <p style="margin: 0 0 20px; color: var(--muted); font-size: 14px;">Pick the chart style for this analysis.</p>
        <div class="chart-type-grid">
          ${CHART_TYPE_OPTIONS.map(c => `
            <button type="button" class="chart-type-card${AppState.salesConfig.chartType === c.id ? ' chart-type-card--active' : ''}" onclick="selectChartType('${c.id}')">
              <span class="chart-type-card__icon">${c.icon}</span>
              <span class="chart-type-card__label">${c.label}</span>
              <span class="chart-type-card__desc">${c.desc}</span>
            </button>
          `).join('')}
        </div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button class="btn-secondary" onclick="goToSalesStep(1)">Back</button>
          <button class="btn-primary" style="flex: 1;" onclick="goToSalesStep(3)">Next</button>
        </div>
      </div>
    </div>
  `;
}

function selectChartType(type) {
  AppState.salesConfig.chartType = type;
  renderPage();
}

function renderSalesStep3() {
  const dimOptions = getSalesDimensionOptions();
  return `
    <div style="max-width: 800px;">
      ${renderSalesStepper(3)}
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px;">
        <h3 style="margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--slate);">Step 3: Break it down by…</h3>
        <p style="margin: 0 0 20px; color: var(--muted); font-size: 14px;">e.g. Country, Region, Product Category, Sales Person, Month…</p>
        ${dimOptions.length === 0 ? '<p style="color: var(--danger); font-size: 13px;">No categorical/dimension columns were detected in this file.</p>' : ''}
        <div class="form-group">
          <label class="form-label">Group by</label>
          <select id="sales-dimension-select" class="form-input" onchange="handleSalesDimensionSelect()">
            <option value="">-- Select a dimension --</option>
            ${dimOptions.map(d => `<option value="${d}" ${AppState.salesConfig.dimension === d ? 'selected' : ''}>${formatMetricLabel(d)}</option>`).join('')}
          </select>
        </div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button class="btn-secondary" onclick="goToSalesStep(2)">Back</button>
          <button id="sales-step3-next-btn" class="btn-primary" style="flex: 1;" onclick="handleSalesStep3Run()" ${!AppState.salesConfig.dimension ? 'disabled' : ''}>
            ${AppState.salesLoading ? 'Running…' : 'Show Results'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function handleSalesDimensionSelect() {
  const sel = document.getElementById('sales-dimension-select');
  AppState.salesConfig.dimension = sel?.value || null;
  const btn = document.getElementById('sales-step3-next-btn');
  if (btn) btn.disabled = !AppState.salesConfig.dimension;
}

async function handleSalesStep3Run() {
  if (!AppState.salesConfig.dimension || !AppState.salesConfig.metric) {
    showToast('Please choose a metric and a dimension first', 'error');
    return;
  }
  AppState.salesStep = 4;
  AppState.salesLoading = true;
  AppState.salesResult = null;
  await renderPage();

  try {
    const res = await apiRequest('/api/analysis/sales/aggregate', {
      method: 'POST',
      body: JSON.stringify({
        orgEmail: AppState.currentUser?.email,
        dimension: AppState.salesConfig.dimension,
        metric: AppState.salesConfig.metric,
        aggregation: AppState.salesConfig.aggregation,
        topN: 10,
      })
    });
    AppState.salesResult = res;
    saveSalesWidgetToDashboard(res);
    showToast('Chart added to your dashboard', 'success');
  } catch (error) {
    AppState.salesResult = { ok: false, error: error.message };
    showToast('Analysis failed: ' + error.message, 'error');
  } finally {
    AppState.salesLoading = false;
    await renderPage();
  }
}

function renderSalesStep4() {
  const result = AppState.salesResult;
  return `
    <div style="max-width: 900px;">
      ${renderSalesStepper(4)}
      <div style="display: flex; justify-content: space-between; align-items: center; margin: 16px 0;">
        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--slate);">Results</h3>
        <div style="display: flex; gap: 8px;">
          <button class="btn-secondary" onclick="goToSalesStep(3)">← Change breakdown</button>
          <button class="btn-secondary" onclick="resetSalesWizard()">Start over</button>
        </div>
      </div>
      ${AppState.salesLoading ? `
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 48px; text-align: center; color: var(--indigo);">Crunching the numbers…</div>
      ` : result && result.ok === false ? `
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; text-align: center; color: var(--danger);">${result.error || 'Something went wrong'}</div>
      ` : result ? `
        <div class="sales-result-card">
          <div class="sales-result-card__stats">
            <div class="sales-stat"><span class="sales-stat__label">Total</span><span class="sales-stat__value">${formatSalesNumber(result.total)}</span></div>
            <div class="sales-stat"><span class="sales-stat__label">Average</span><span class="sales-stat__value">${formatSalesNumber(result.average)}</span></div>
            <div class="sales-stat"><span class="sales-stat__label">Groups</span><span class="sales-stat__value">${result.groupCount}</span></div>
            <div class="sales-stat"><span class="sales-stat__label">Rows analyzed</span><span class="sales-stat__value">${result.rowCount}</span></div>
          </div>
          <div class="sales-result-card__chart-wrap">
            <canvas id="sales-step4-canvas"></canvas>
          </div>
        </div>
        <div style="margin-top: 16px; display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn-primary" onclick="toggleForecastPanel()">📈 Forecast future ${formatMetricLabel(result.metric)}</button>
          <button class="btn-secondary" onclick="AppState.currentPage='dashboard'; updateSidebar(); renderPage();">View on Dashboard</button>
        </div>
        ${AppState.showForecastPanel ? renderForecastPanel() : ''}
      ` : `
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px; text-align: center; color: var(--muted);">No results yet.</div>
      `}
    </div>
  `;
}

function toggleForecastPanel() {
  AppState.showForecastPanel = !AppState.showForecastPanel;
  renderPage();
}

// ---- Forecast panel ----

function renderForecastPanel() {
  const info = AppState.datasetTypeInfo;
  const metrics = info?.metrics || [];
  const dateCols = info?.dateColumns || [];
  const cfg = AppState.forecastConfig;
  if (!cfg.metric) cfg.metric = AppState.salesConfig.metric || (metrics[0] && metrics[0].name) || '';
  if (!cfg.dateColumn) cfg.dateColumn = dateCols.find(c => /date/i.test(c)) || dateCols[0] || 'Order_Date';

  const freqOptions = [
    { id: 'M', label: 'Monthly' },
    { id: 'Q', label: 'Quarterly' },
    { id: 'Y', label: 'Yearly' },
    { id: 'W', label: 'Weekly' },
  ];
  const horizonOptions = [3, 6, 12, 24];

  return `
    <div class="forecast-panel">
      <div class="forecast-panel__head">
        <h4 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--slate);">📈 Forecast</h4>
        <button class="forecast-panel__close" onclick="toggleForecastPanel()" title="Close">✕</button>
      </div>
      <p style="margin: 4px 0 16px; color: var(--muted); font-size: 13px;">Pick a metric, frequency, and how far ahead to predict.</p>
      <div class="forecast-panel__controls">
        <div class="form-group">
          <label class="form-label">Metric</label>
          <select id="forecast-metric-select" class="form-input" onchange="AppState.forecastConfig.metric=this.value">
            ${metrics.map(m => `<option value="${m.name}" ${cfg.metric === m.name ? 'selected' : ''}>${formatMetricLabel(m.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Date column</label>
          <select id="forecast-date-select" class="form-input" onchange="AppState.forecastConfig.dateColumn=this.value">
            ${dateCols.map(d => `<option value="${d}" ${cfg.dateColumn === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Frequency</label>
          <select id="forecast-freq-select" class="form-input" onchange="AppState.forecastConfig.freq=this.value">
            ${freqOptions.map(f => `<option value="${f.id}" ${cfg.freq === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Horizon</label>
          <select id="forecast-periods-select" class="form-input" onchange="AppState.forecastConfig.periods=parseInt(this.value,10)">
            ${horizonOptions.map(h => `<option value="${h}" ${cfg.periods === h ? 'selected' : ''}>Next ${h} periods</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn-primary" style="margin-top: 8px; width: 100%;" onclick="runForecast()" ${AppState.forecastLoading ? 'disabled' : ''}>
        ${AppState.forecastLoading ? 'Forecasting…' : 'Run Forecast'}
      </button>
      ${AppState.forecastLoading ? `
        <div style="text-align: center; padding: 32px; color: var(--indigo);">Running forecast model…</div>
      ` : AppState.forecastResult && AppState.forecastResult.ok === false ? `
        <div style="margin-top: 16px; color: var(--danger); font-size: 13px;">${AppState.forecastResult.error}</div>
      ` : AppState.forecastResult ? `
        <div class="forecast-panel__summary">
          <div class="sales-stat"><span class="sales-stat__label">Model</span><span class="sales-stat__value" style="font-size: 13px;">${AppState.forecastResult.model}</span></div>
          <div class="sales-stat"><span class="sales-stat__label">Forecast total</span><span class="sales-stat__value">${formatSalesNumber(AppState.forecastResult.summary.forecastTotal)}</span></div>
          <div class="sales-stat"><span class="sales-stat__label">vs. historical avg</span><span class="sales-stat__value" style="color: ${(AppState.forecastResult.summary.percentChange || 0) >= 0 ? 'var(--success)' : 'var(--danger)'};">${AppState.forecastResult.summary.percentChange != null ? (AppState.forecastResult.summary.percentChange >= 0 ? '+' : '') + AppState.forecastResult.summary.percentChange.toFixed(1) + '%' : '—'}</span></div>
        </div>
        <div style="margin-top: 12px;">
          <canvas id="sales-forecast-canvas"></canvas>
        </div>
      ` : ''}
    </div>
  `;
}

async function runForecast() {
  const cfg = AppState.forecastConfig;
  if (!cfg.metric) {
    showToast('Choose a metric to forecast', 'error');
    return;
  }
  AppState.forecastLoading = true;
  AppState.forecastResult = null;
  await renderPage();

  try {
    const res = await apiRequest('/api/analysis/sales/forecast', {
      method: 'POST',
      body: JSON.stringify({
        orgEmail: AppState.currentUser?.email,
        dateColumn: cfg.dateColumn,
        metric: cfg.metric,
        freq: cfg.freq,
        periods: cfg.periods,
      })
    });
    AppState.forecastResult = res;
  } catch (error) {
    AppState.forecastResult = { ok: false, error: error.message };
    showToast('Forecast failed: ' + error.message, 'error');
  } finally {
    AppState.forecastLoading = false;
    await renderPage();
  }
}

// ---- Chart.js rendering helpers ----

const _chartInstances = {};
const SALES_CHART_PALETTE = ['#4f46e5', '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#0ea5e9', '#84cc16', '#a855f7', '#64748b'];

function getChartThemeColors() {
  return AppState.darkMode
    ? { text: '#cbd5e1', grid: 'rgba(148,163,184,0.18)' }
    : { text: '#475569', grid: 'rgba(148,163,184,0.18)' };
}

function destroyChartIfExists(canvasId) {
  if (_chartInstances[canvasId]) {
    try { _chartInstances[canvasId].destroy(); } catch (e) { /* ignore */ }
    delete _chartInstances[canvasId];
  }
}

function drawChartJs(canvasId, chartTypeId, labels, values, opts = {}) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  destroyChartIfExists(canvasId);

  const isPieLike = chartTypeId === 'pie' || chartTypeId === 'doughnut';
  const isRadar = chartTypeId === 'radar';
  const chartType = chartTypeId === 'area' ? 'line' : (chartTypeId || 'bar');
  const colors = (labels || []).map((_, i) => SALES_CHART_PALETTE[i % SALES_CHART_PALETTE.length]);
  const theme = getChartThemeColors();

  const dataset = {
    label: opts.label || 'Value',
    data: values,
    backgroundColor: (isPieLike || isRadar) ? colors : (chartType === 'line' ? 'rgba(79,70,229,0.18)' : '#4f46e5'),
    borderColor: (isPieLike) ? '#fff' : '#4f46e5',
    borderWidth: isPieLike ? 2 : (chartType === 'line' ? 2 : 0),
    fill: chartTypeId === 'area',
    tension: 0.35,
    borderRadius: chartType === 'bar' ? 8 : 0,
    pointRadius: chartType === 'line' ? 3 : 0,
  };

  _chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
    type: chartType,
    data: { labels: labels || [], datasets: [dataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: isPieLike || isRadar, position: 'bottom', labels: { color: theme.text } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatSalesNumber(ctx.parsed?.y ?? ctx.parsed?.r ?? ctx.parsed)}`,
          },
        },
      },
      scales: (isPieLike || isRadar) ? {} : {
        y: { beginAtZero: true, grid: { color: theme.grid }, ticks: { color: theme.text } },
        x: { grid: { display: false }, ticks: { color: theme.text } },
      },
    },
  });
}

function drawForecastChart(canvasId, forecastResult) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  destroyChartIfExists(canvasId);

  const histLabels = forecastResult.historical.labels;
  const histValues = forecastResult.historical.values;
  const fLabels = forecastResult.forecast.labels;
  const fValues = forecastResult.forecast.values;
  const fLower = forecastResult.forecast.lower;
  const fUpper = forecastResult.forecast.upper;

  const allLabels = [...histLabels, ...fLabels];
  const bridgeCount = Math.max(histValues.length - 1, 0);
  const lastHistValue = histValues.length ? histValues[histValues.length - 1] : null;

  const histSeries = [...histValues, ...new Array(fLabels.length).fill(null)];
  const forecastSeries = [...new Array(bridgeCount).fill(null), lastHistValue, ...fValues];
  const lowerSeries = [...new Array(bridgeCount).fill(null), lastHistValue, ...fLower];
  const upperSeries = [...new Array(bridgeCount).fill(null), lastHistValue, ...fUpper];
  const theme = getChartThemeColors();

  _chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Upper bound', data: upperSeries, borderColor: 'rgba(219,39,119,0)',
          backgroundColor: 'rgba(219,39,119,0.08)', fill: '+1', pointRadius: 0, borderWidth: 0,
        },
        {
          label: 'Lower bound', data: lowerSeries, borderColor: 'rgba(219,39,119,0)',
          backgroundColor: 'rgba(219,39,119,0)', fill: false, pointRadius: 0, borderWidth: 0,
        },
        {
          label: 'Historical', data: histSeries, borderColor: '#4f46e5',
          backgroundColor: 'rgba(79,70,229,0.1)', fill: false, tension: 0.3, pointRadius: 2,
        },
        {
          label: 'Forecast', data: forecastSeries, borderColor: '#db2777',
          backgroundColor: 'rgba(219,39,119,0.08)', borderDash: [6, 4], fill: false, tension: 0.3, pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: theme.text, filter: (item) => item.text === 'Historical' || item.text === 'Forecast' },
        },
        tooltip: { filter: (item) => item.dataset.label === 'Historical' || item.dataset.label === 'Forecast' },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: theme.grid }, ticks: { color: theme.text } },
        x: { grid: { display: false }, ticks: { color: theme.text } },
      },
    },
  });
}

function initSalesCharts() {
  if (AppState.datasetFlowStage !== 'sales') return;
  if (AppState.salesStep === 4 && AppState.salesResult && AppState.salesResult.ok !== false) {
    drawChartJs('sales-step4-canvas', AppState.salesConfig.chartType, AppState.salesResult.labels, AppState.salesResult.values, { label: formatMetricLabel(AppState.salesResult.metric) });
    if (AppState.showForecastPanel && AppState.forecastResult && AppState.forecastResult.ok !== false) {
      drawForecastChart('sales-forecast-canvas', AppState.forecastResult);
    }
  }
}

// ---- Sales dashboard widget persistence (accumulates across analyses) ----

const MAX_SALES_WIDGETS = 24;

function getSalesDashboardKey() {
  return `visionFeedback_salesDashboard_${AppState.currentUser?.email || 'org'}`;
}

function loadSalesDashboard() {
  try {
    const raw = localStorage.getItem(getSalesDashboardKey());
    AppState.salesDashboard = raw ? JSON.parse(raw) : [];
  } catch {
    AppState.salesDashboard = [];
  }
}

function saveSalesWidgetToDashboard(result) {
  if (!result || result.ok === false || AppState.currentRole !== 'organization') return;
  const widget = {
    id: `sw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    dimension: result.dimension,
    metric: result.metric,
    aggregation: result.aggregation,
    chartType: AppState.salesConfig.chartType || 'bar',
    labels: result.labels,
    values: result.values,
    total: result.total,
  };
  loadSalesDashboard();
  AppState.salesDashboard.unshift(widget);
  if (AppState.salesDashboard.length > MAX_SALES_WIDGETS) {
    AppState.salesDashboard = AppState.salesDashboard.slice(0, MAX_SALES_WIDGETS);
  }
  try {
    localStorage.setItem(getSalesDashboardKey(), JSON.stringify(AppState.salesDashboard));
  } catch { /* storage full — keep the in-memory copy only */ }
}

function deleteSalesWidget(id) {
  loadSalesDashboard();
  AppState.salesDashboard = AppState.salesDashboard.filter(w => w.id !== id);
  try { localStorage.setItem(getSalesDashboardKey(), JSON.stringify(AppState.salesDashboard)); } catch { /* ignore */ }
  renderPage();
}

function clearSalesDashboard() {
  AppState.salesDashboard = [];
  try { localStorage.removeItem(getSalesDashboardKey()); } catch { /* ignore */ }
  renderPage();
}

function renderSalesDashboardSection() {
  loadSalesDashboard();
  const widgets = AppState.salesDashboard || [];

  if (!widgets.length) {
    return `
      <section class="sales-dashboard">
        <div class="sales-dashboard__head">
          <h3 class="section-header" style="margin: 0;">🛒 Sales Insights</h3>
        </div>
        <div class="dashboard-charts-empty">
          <div class="dashboard-charts-empty-icon">🛒</div>
          <p>Upload a sales/business dataset to build live breakdown charts here.</p>
          <button type="button" class="btn-primary" onclick="AppState.currentPage='dataset'; updateSidebar(); renderPage();">Upload Dataset</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="sales-dashboard">
      <div class="sales-dashboard__head">
        <h3 class="section-header" style="margin: 0;">🛒 Sales Insights</h3>
        <button type="button" class="dashboard-charts-expand" onclick="clearSalesDashboard()">Clear all</button>
      </div>
      <div class="sales-dashboard__grid">
        ${widgets.map(w => `
          <article class="sales-widget-card">
            <div class="sales-widget-card__head">
              <span class="sales-widget-card__title">${formatMetricLabel(w.metric)} by ${formatMetricLabel(w.dimension)}</span>
              <button type="button" class="sales-widget-card__delete" onclick="deleteSalesWidget('${w.id}')" title="Remove">✕</button>
            </div>
            <div class="sales-widget-card__canvas-wrap">
              <canvas id="sw-canvas-${w.id}"></canvas>
            </div>
            <div class="sales-widget-card__foot">
              <span>${w.aggregation} · ${(w.labels || []).length} groups</span>
              <span>${new Date(w.createdAt).toLocaleDateString()}</span>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function initOrgDashboardCharts() {
  if (AppState.currentRole !== 'organization') return;
  loadSalesDashboard();
  (AppState.salesDashboard || []).forEach(w => {
    drawChartJs(`sw-canvas-${w.id}`, w.chartType, w.labels, w.values, { label: formatMetricLabel(w.metric) });
  });
}

// ========== GENERAL FEEDBACK ==========
let feedbackQuestions = [];
let feedbackResponses = [];
let feedbackQuestionLookup = {};
let feedbackAnswers = {};
let feedbackComment = '';
let feedbackLoading = false;
let feedbackSubmitting = false;
let feedbackTargetOrgEmail = null;

async function initFeedbackPage() {
  feedbackLoading = true;
  await renderPage();
  try {
    if (AppState.currentRole === 'student') {
      const orgsRes = await apiRequest('/api/auth/all-orgs');
      const org = orgsRes.find(o => o.name === AppState.currentUser.orgName);
      feedbackTargetOrgEmail = org ? org.email : AppState.currentUser.orgName;

      const res = await apiRequest(`/api/questions-for-target?targetOrgEmail=${encodeURIComponent(feedbackTargetOrgEmail)}`);
      feedbackQuestions = res.questions || [];
      feedbackAnswers = {};
      feedbackComment = '';
    } else {
      const [responsesRes, questionsRes] = await Promise.all([
        apiRequest(`/api/responses?orgEmail=${encodeURIComponent(AppState.currentUser.email)}`),
        apiRequest(`/api/questions-for-target?targetOrgEmail=${encodeURIComponent(AppState.currentUser.email)}`),
      ]);
      feedbackResponses = responsesRes.responses || [];
      feedbackQuestionLookup = {};
      (questionsRes.questions || []).forEach(q => { feedbackQuestionLookup[q._id] = q.text; });
    }
  } catch (e) {
    showToast(e.message || 'Failed to load feedback', 'error');
  } finally {
    feedbackLoading = false;
    await renderPage();
  }
}

function renderFeedbackPage() {
  if (feedbackLoading) {
    return `
      <div style="max-width: 540px;">
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 48px; text-align: center; color: var(--indigo);">Loading…</div>
      </div>
    `;
  }
  return AppState.currentRole === 'organization' ? renderFeedbackResponsesView() : renderFeedbackFormView();
}

function renderFeedbackFormView() {
  if (!feedbackQuestions.length) {
    return `
      <div style="max-width: 540px;">
        <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px 28px; text-align: center; color: var(--muted);">
          No feedback questions are available right now.
        </div>
      </div>
    `;
  }
  const satisfactionScale = ['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very Dissatisfied'];
  return `
    <div style="max-width: 540px;">
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px 28px;">
        <h3 class="analytics-title">General Feedback</h3>
        ${feedbackQuestions.map(q => `
          <div class="form-group">
            <label class="form-label">${q.text}</label>
            <select class="form-input" onchange="setFeedbackAnswer('${q._id}', this.value)">
              <option value="">-- Select --</option>
              ${(q.options && q.options.length ? q.options : satisfactionScale).map(opt => `
                <option value="${opt}" ${feedbackAnswers[q._id] === String(opt) ? 'selected' : ''}>${opt}</option>
              `).join('')}
            </select>
          </div>
        `).join('')}
        <div class="form-group">
          <label class="form-label">Additional Comments</label>
          <textarea class="form-input" rows="4" placeholder="Write your feedback..." style="resize: vertical;" oninput="feedbackComment = this.value">${feedbackComment}</textarea>
        </div>
        <button class="btn-primary" onclick="submitGeneralFeedback()" ${feedbackSubmitting ? 'disabled' : ''}>
          ${feedbackSubmitting ? 'Submitting…' : 'Submit Feedback'}
        </button>
      </div>
    </div>
  `;
}

function setFeedbackAnswer(questionId, value) {
  feedbackAnswers[questionId] = value;
}

async function submitGeneralFeedback() {
  const unanswered = feedbackQuestions.filter(q => !feedbackAnswers[q._id]);
  if (unanswered.length) {
    showToast('Please answer all questions before submitting', 'error');
    return;
  }

  feedbackSubmitting = true;
  await renderPage();
  try {
    await apiRequest('/api/submit', {
      method: 'POST',
      body: JSON.stringify({
        studentEmail: AppState.currentUser.email,
        targetOrgEmail: feedbackTargetOrgEmail,
        answers: feedbackAnswers,
        comments: feedbackComment ? { overall: feedbackComment } : {},
      }),
    });
    showToast('Feedback submitted, thank you!', 'success');
    feedbackAnswers = {};
    feedbackComment = '';
  } catch (e) {
    showToast(e.message || 'Submit failed', 'error');
  } finally {
    feedbackSubmitting = false;
    await renderPage();
  }
}

function renderFeedbackResponsesView() {
  if (!feedbackResponses.length) {
    return `
      <div style="max-width: 760px;">
        <div class="dashboard-charts-empty">
          <div class="dashboard-charts-empty-icon">💬</div>
          <p>No feedback responses yet.</p>
        </div>
      </div>
    `;
  }
  return `
    <div style="max-width: 760px; display: flex; flex-direction: column; gap: 14px;">
      ${feedbackResponses.map(r => `
        <div style="background: #fff; border-radius: 14px; border: 1px solid var(--border); padding: 18px 20px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <strong style="color: var(--slate); font-size: 13px;">${r.studentEmail}</strong>
            <span style="color: var(--muted); font-size: 12px;">${new Date(r.submittedAt).toLocaleString()}</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--slate);">
            ${Object.entries(r.answers || {}).map(([qId, val]) => `
              <div><span style="color: var(--muted);">${feedbackQuestionLookup[qId] || 'Question'}:</span> ${val}</div>
            `).join('')}
          </div>
          ${r.comments && r.comments.overall ? `<p style="margin-top: 10px; color: var(--muted); font-size: 13px; font-style: italic;">"${r.comments.overall}"</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderHistoryPage() {
  return `
    <div style="display: flex; flex-direction: column; gap: 12;">
      ${realHistory.map(h => `
        <div style="background: #fff; border-radius: 14px; border: 1px solid var(--border); padding: 16px 20px; display: flex; align-items: center; gap: 16px;">
          <div style="width: 38px; height: 38px; border-radius: 50%; background: #d1fae5; color: var(--success); display: flex; align-items: center; justify-content: center; font-size: 18; flex-shrink: 0;">✅</div>
          <div style="flex: 1;">
            <p style="margin: 0 0 2px; font-weight: 600; color: var(--slate); font-size: 14px;">Survey Response</p>
            <p style="margin: 0; color: var(--muted); font-size: 12px;">Submitted on ${new Date(h.submittedAt).toLocaleDateString()}</p>
          </div>
          <span class="status-badge submitted">Complete</span>
        </div>
      `).join('')}
      ${realHistory.length === 0 ? '<p style="color: var(--muted);">No survey history yet.</p>' : ''}
    </div>
  `;
}

function renderProfilePage() {
  const user = AppState.currentUser || {};
  const initials = user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U';
  const isStudent = AppState.currentRole === 'student';
  const uploadLabel = isStudent ? 'Upload Photo' : 'Upload Logo';

  const avatarBlock = `
    <div style="text-align: center; margin-bottom: 28px;">
      <div class="profile-avatar-wrap">
        ${user.avatarUrl
          ? `<img src="${API_BASE}${user.avatarUrl}" class="profile-avatar-img" alt="avatar">`
          : `<div class="profile-avatar-fallback">${initials}</div>`}
      </div>
      <input type="file" id="avatar-file-input" accept="image/*" style="display: none;" onchange="handleAvatarFileChange()">
      <button class="action-btn" onclick="document.getElementById('avatar-file-input').click()" ${AppState.avatarUploading ? 'disabled' : ''}>
        ${AppState.avatarUploading ? 'Uploading…' : uploadLabel}
      </button>
    </div>
  `;

  const fields = isStudent
    ? [
        ['Full Name', 'name', user.name || ''],
        ['Email', null, user.email || ''],
        ['Department', 'department', user.department || ''],
        ['Semester', 'semester', user.semester || ''],
        ['Course', 'course', user.course || ''],
        ['Organization', null, user.orgName || ''],
      ]
    : [
        ['Organization Name', 'name', user.name || ''],
        ['Email', null, user.email || ''],
        ['Location', 'address', user.address || ''],
        ['Phone', 'phone', user.phone || ''],
      ];

  return `
    <div style="max-width: 540px;">
      ${avatarBlock}
      <div style="background: #fff; border-radius: 16px; border: 1px solid var(--border); padding: 24px 28px;">
        ${fields.map(([label, fieldKey, val]) => `
          <div class="form-group">
            <label class="form-label">${label}${fieldKey === null ? ' <span style="color: var(--muted); font-weight: 400;">(can\u2019t be changed)</span>' : ''}</label>
            <input type="text" class="form-input" ${fieldKey ? `id="profile-field-${fieldKey}"` : ''} value="${val}" ${fieldKey === null ? 'disabled' : ''}>
          </div>
        `).join('')}
        <button class="btn-primary" onclick="handleProfileSave()" ${AppState.profileSaving ? 'disabled' : ''}>
          ${AppState.profileSaving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  `;
}

async function handleProfileSave() {
  const isStudent = AppState.currentRole === 'student';
  const payload = { email: AppState.currentUser.email };

  if (isStudent) {
    payload.name = document.getElementById('profile-field-name')?.value || '';
    payload.department = document.getElementById('profile-field-department')?.value || '';
    payload.semester = document.getElementById('profile-field-semester')?.value || '';
    payload.course = document.getElementById('profile-field-course')?.value || '';
  } else {
    payload.name = document.getElementById('profile-field-name')?.value || '';
    payload.address = document.getElementById('profile-field-address')?.value || '';
    payload.phone = document.getElementById('profile-field-phone')?.value || '';
  }

  AppState.profileSaving = true;
  await renderPage();
  try {
    const res = await apiRequest('/api/auth/update-profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    AppState.currentUser = { ...AppState.currentUser, ...res.user };
    updateUserInfo();
    showToast('Profile updated', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to update profile', 'error');
  } finally {
    AppState.profileSaving = false;
    await renderPage();
  }
}

function handleAvatarFileChange() {
  const input = document.getElementById('avatar-file-input');
  const file = input?.files?.[0];
  if (file) uploadAvatarFile(file);
}

async function uploadAvatarFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image is too large (max 5MB)', 'error');
    return;
  }

  AppState.avatarUploading = true;
  await renderPage();

  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('email', AppState.currentUser.email);

  try {
    const res = await fetch(API_BASE + '/api/auth/upload-avatar', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    AppState.currentUser.avatarUrl = data.avatarUrl;
    updateUserInfo();
    showToast(AppState.currentRole === 'student' ? 'Photo updated' : 'Logo updated', 'success');
  } catch (e) {
    showToast(e.message || 'Upload failed', 'error');
  } finally {
    AppState.avatarUploading = false;
    await renderPage();
  }
}

// ========== AI INSIGHT ==========
async function handleAIInsight() {
  const prompt = document.getElementById('ai-prompt')?.value;
  if (!prompt) {
    showToast('Please enter a prompt', 'error');
    return;
  }

  AppState.aiLoading = true;
  await renderPage();

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'YOUR_ANTHROPIC_API_KEY',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    AppState.aiResult = data.content[0].text;
  } catch (error) {
    console.error('AI error:', error);
    AppState.aiResult = 'Failed to get AI response. Please check your API key.';
  }

  AppState.aiLoading = false;
  await renderPage();
}

// ========== INITIALIZATION ==========
function applyStoredTheme() {
  let saved = null;
  try { saved = localStorage.getItem('visionFeedback_theme'); } catch { /* ignore */ }
  AppState.darkMode = saved === 'dark';
  document.body.classList.toggle('dark-mode', AppState.darkMode);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = AppState.darkMode ? '☀️' : '🌙';
}

document.addEventListener('DOMContentLoaded', () => {
  applyStoredTheme();
  initAuth();
  
  // Add AI insight listener after page render
  document.addEventListener('click', (e) => {
    if (e.target.id === 'ai-insight-btn') {
      handleAIInsight();
    }
  });
});
