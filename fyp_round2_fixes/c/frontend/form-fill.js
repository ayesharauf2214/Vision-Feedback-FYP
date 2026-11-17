/* Student questionnaire fill flow */

const FormFillState = {
  survey: null,
  answers: {},
  step: 0,
  steps: [],
};

function buildFillSteps(survey) {
  const steps = [];
  let counter = 0;
  const tagQuestions = (questions) => (questions || []).map((q) => {
    counter += 1;
    // Use the question's own _id when available (Mongo gives every subdocument
    // one by default); otherwise fall back to a position-based key. This is
    // what answers/validation are keyed by — never the raw question text,
    // since two questions can legitimately have identical wording.
    return { ...q, _key: q._id ? String(q._id) : `qpos_${counter}` };
  });

  (survey.sections || []).forEach((section) => {
    if (section.subsections && section.subsections.length > 0) {
      section.subsections.forEach((sub) => {
        steps.push({
          type: 'block',
          sectionTitle: section.title,
          subsectionTitle: sub.title,
          description: sub.description || section.description,
          questions: tagQuestions(sub.questions),
        });
      });
    }
    if (section.questions && section.questions.length > 0) {
      steps.push({
        type: 'block',
        sectionTitle: section.title,
        subsectionTitle: null,
        description: section.description,
        questions: tagQuestions(section.questions),
      });
    }
  });
  return steps;
}

function renderFillQuestion(q) {
  const key = q._key;
  const val = FormFillState.answers[key] ?? '';
  if (q.type === 'likert' || q.type === 'choice') {
    const opts = q.options && q.options.length ? q.options : ['1', '2', '3', '4', '5'];
    return `
      <div class="fill-question">
        <p class="fill-q-text">${escapeHtmlFill(q.text)}${q.required ? ' *' : ''}</p>
        <div class="fill-likert">
          ${opts.map((opt) => `
            <label class="fill-option">
              <input type="radio" name="${escapeHtmlFill(key)}" value="${escapeHtmlFill(opt)}"
                ${String(val) === String(opt) ? 'checked' : ''}
                onchange="fillSetAnswer('${escapeJs(key)}', this.value)">
              <span>${escapeHtmlFill(opt)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }
  if (q.type === 'textarea') {
    return `
      <div class="fill-question">
        <label class="fill-q-text">${escapeHtmlFill(q.text)}${q.required ? ' *' : ''}</label>
        <textarea class="form-input" rows="3" oninput="fillSetAnswer('${escapeJs(key)}', this.value)">${escapeHtmlFill(val)}</textarea>
      </div>
    `;
  }
  return `
    <div class="fill-question">
      <label class="fill-q-text">${escapeHtmlFill(q.text)}${q.required ? ' *' : ''}</label>
      <input type="text" class="form-input" value="${escapeHtmlFill(val)}"
        oninput="fillSetAnswer('${escapeJs(key)}', this.value)">
    </div>
  `;
}

function escapeHtmlFill(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function escapeJs(str) {
  return String(str === null || str === undefined ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function fillSetAnswer(questionText, value) {
  FormFillState.answers[questionText] = value;
}

function renderFormFillModal() {
  const survey = FormFillState.survey;
  const steps = FormFillState.steps;
  const step = FormFillState.step;
  const block = steps[step];
  const progress = steps.length ? Math.round(((step + 1) / steps.length) * 100) : 0;

  const body = block ? `
    <p class="fill-progress">Step ${step + 1} of ${steps.length} · ${progress}%</p>
    <h4 class="fill-section-title">${escapeHtmlFill(block.sectionTitle)}</h4>
    ${block.subsectionTitle ? `<p class="fill-sub-title">${escapeHtmlFill(block.subsectionTitle)}</p>` : ''}
    ${block.description ? `<p class="fill-desc">${escapeHtmlFill(block.description)}</p>` : ''}
    ${block.questions.map((q) => renderFillQuestion(q)).join('')}
  ` : '<p>No questions in this form.</p>';

  return `
    <div id="form-fill-overlay" class="modal-overlay">
      <div class="modal-panel form-fill-panel">
        <div class="modal-header">
          <h3>${escapeHtmlFill(survey.title)}</h3>
          <button type="button" class="modal-close" onclick="closeFormFill()">×</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" onclick="closeFormFill()">Cancel</button>
          ${step > 0 ? `<button type="button" class="btn-secondary" onclick="fillPrevStep()">Back</button>` : ''}
          ${step < steps.length - 1
            ? `<button type="button" class="btn-primary" onclick="fillNextStep()">Next</button>`
            : `<button type="button" class="btn-primary" onclick="submitFormFill()">Submit</button>`}
        </div>
      </div>
    </div>
  `;
}

async function openFormFill(surveyId) {
  try {
    const res = await apiRequest(`/api/survey/${surveyId}`);
    FormFillState.survey = res.survey;
    FormFillState.answers = {};
    FormFillState.steps = buildFillSteps(res.survey);
    FormFillState.step = 0;
    if (FormFillState.steps.length === 0) {
      showToast('This form has no questions yet', 'error');
      return;
    }
    document.body.insertAdjacentHTML('beforeend', renderFormFillModal());
  } catch (e) {
    showToast(e.message || 'Could not open form', 'error');
  }
}

function closeFormFill() {
  document.getElementById('form-fill-overlay')?.remove();
}

function refreshFormFillModal() {
  const el = document.getElementById('form-fill-overlay');
  if (el) el.outerHTML = renderFormFillModal();
}

function fillValidateCurrentStep() {
  const block = FormFillState.steps[FormFillState.step];
  if (!block) return true;
  for (const q of block.questions) {
    if (q.required) {
      const a = FormFillState.answers[q._key];
      if (a === undefined || a === null || String(a).trim() === '') {
        showToast(`Please answer: ${q.text}`, 'error');
        return false;
      }
    }
  }
  return true;
}

function fillNextStep() {
  if (!fillValidateCurrentStep()) return;
  FormFillState.step += 1;
  refreshFormFillModal();
}

function fillPrevStep() {
  FormFillState.step -= 1;
  refreshFormFillModal();
}

async function submitFormFill() {
  if (!fillValidateCurrentStep()) return;

  const survey = FormFillState.survey;
  const orgsRes = await apiRequest('/api/auth/all-orgs');
  const org = orgsRes.find((o) => o.name === AppState.currentUser.orgName);
  const orgEmail = org ? org.email : AppState.currentUser.orgName;

  const answers = [];
  FormFillState.steps.forEach((block) => {
    block.questions.forEach((q) => {
      const val = FormFillState.answers[q._key];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        answers.push({ question: q.text, answer: String(val) });
      }
    });
  });

  try {
    await apiRequest('/api/submit-survey', {
      method: 'POST',
      body: JSON.stringify({
        surveyId: survey._id,
        studentEmail: AppState.currentUser.email,
        orgEmail,
        answers,
      }),
    });
    showToast('Form submitted successfully', 'success');
    closeFormFill();
    await loadRealData();
    await renderPage();
    initFormsPage();
  } catch (e) {
    showToast(e.message || 'Submit failed', 'error');
  }
}
