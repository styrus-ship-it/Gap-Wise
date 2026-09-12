const view = document.getElementById("view");
const toast = document.getElementById("toast");

const STORAGE_KEY = "gapwise_assessment_history_v1";
const USER_KEY = "gapwise_user_id_v1";

function getUserId(){
  let id = localStorage.getItem(USER_KEY);
  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(USER_KEY, id);
  }
  return id;
}

function loadAssessmentHistory(){
  try{
    const raw = localStorage.getItem(`${STORAGE_KEY}:${getUserId()}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(e){ return []; }
}

function saveAssessmentHistory(history){
  localStorage.setItem(`${STORAGE_KEY}:${getUserId()}`, JSON.stringify(history));
}

function recordAssessmentResult(subject, questions, userAnswers, isPractice = false){
  const correct = questions.reduce((n, q, i) => n + (userAnswers[i] === q.answer ? 1 : 0), 0);
  const result = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    subject: subject,
    subjectName: assessments[subject].name,
    completedAt: new Date().toISOString(),
    correct,
    total: questions.length,
    score: Math.round((correct / questions.length) * 100),
    answers: userAnswers,
    isPractice: isPractice,
    concepts: questions.map((q, i) => ({
      concept: q.concept,
      questionText: q.q,
      userAnswer: userAnswers[i],
      correctAnswer: q.answer,
      options: q.options,
      correct: userAnswers[i] === q.answer
    }))
  };
  const history = loadAssessmentHistory();
  history.unshift(result);
  saveAssessmentHistory(history);
  state.latestAssessmentId = result.id;
  return result;
}

function subjectAssessments(subject){
  return loadAssessmentHistory().filter(r => r.subject === subject);
}

function subjectScore(subject){
  const rows = subjectAssessments(subject);
  if(!rows.length) return null;
  return Math.round(rows.reduce((sum,r) => sum + r.score, 0) / rows.length);
}

function overallScore(){
  const rows = loadAssessmentHistory();
  if(!rows.length) return null;
  return Math.round(rows.reduce((sum,r) => sum + r.score, 0) / rows.length);
}

function conceptStats(subject){
  const stats = {};
  subjectAssessments(subject).forEach(r => {
    (r.concepts || []).forEach(item => {
      if(!stats[item.concept]) stats[item.concept] = {correct:0, total:0, attempts:[]};
      stats[item.concept].total++;
      if(item.correct) stats[item.concept].correct++;
      stats[item.concept].attempts.push(item.correct);
    });
  });
  return stats;
}

function conceptScore(subject, concept){
  const s = conceptStats(subject)[concept];
  return s && s.total ? Math.round((s.correct / s.total) * 100) : null;
}

function conceptTrend(subject, concept){
  const s = conceptStats(subject)[concept];
  if(!s || s.attempts.length < 3) return "Insufficient data";
  const recent = s.attempts.slice(-3);
  const recentAvg = recent.reduce((a,b)=>a+(b?1:0),0)/recent.length;
  const prev = s.attempts.slice(0, -3);
  const prevAvg = prev.length ? prev.reduce((a,b)=>a+(b?1:0),0)/prev.length : recentAvg;
  if(recentAvg > prevAvg) return "Improving ↗";
  if(recentAvg < prevAvg) return "Declining ↘";
  return "Stable →";
}

function subjectConceptSummary(subject){
  const stats = conceptStats(subject);
  const categories = assessments[subject]?.categories || [];
  let strong = 0;
  let gaps = 0;
  categories.forEach(c => {
    const s = stats[c];
    if(s && s.total > 0){
      const pct = s.correct / s.total;
      if(pct >= 0.75) strong++;
      else if(pct < 0.50) gaps++;
    }
  });
  return {strong, gaps};
}

function getWeakConcepts(subject){
  const stats = conceptStats(subject);
  const categories = assessments[subject]?.categories || [];
  return categories.filter(c => {
    const s = stats[c];
    return s && s.total > 0 && (s.correct / s.total) < 0.5;
  });
}

function calculateStreak(){
  const history = loadAssessmentHistory();
  if(!history.length) return 0;
  const dates = [...new Set(history.map(r => r.completedAt.split('T')[0]))].sort().reverse();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if(dates[0] !== today && dates[0] !== yesterday) return 0;

  let streak = 0;
  let checkDate = new Date(dates[0]);
  for(let i = 0; i < dates.length; i++){
    const curr = new Date(dates[i]);
    const diff = Math.round((checkDate - curr) / (1000 * 60 * 60 * 24));
    if(diff === 0 || diff === 1){
      streak++;
      checkDate = curr;
    } else {
      break;
    }
  }
  return streak;
}

function previousConceptScore(subject, concept, assessmentId){
  const history = subjectAssessments(subject).filter(r => r.id !== assessmentId);
  const stats = {};
  history.forEach(r => (r.concepts || []).forEach(item => {
    if(!stats[item.concept]) stats[item.concept] = {correct:0,total:0};
    stats[item.concept].total++;
    if(item.correct) stats[item.concept].correct++;
  }));
  const s = stats[concept];
  return s && s.total ? Math.round((s.correct/s.total)*100) : 0;
}

function formatAssessmentDate(iso){
  return new Date(iso).toLocaleString(undefined, {
    day:"numeric", month:"short", year:"numeric", hour:"numeric", minute:"2-digit"
  });
}

const state = {
  route: location.hash.replace("#","") || "landing",
  subject: "math",
  question: 0,
  answers: [],
  selected: null,
  assessmentDone: false,
  lessonCorrect: false,
  quickCheckAttempts: 0,
  gap: null,
  activeConceptModal: null,
  practiceQuestions: [],
  practiceAnswers: [],
  practiceQuestionIndex: 0,
  practiceSelected: null,
  practiceDone: false,
  currentQuestions: []
};

const assessments = {
  math: {
    name: "Mathematics",
    eyebrow: "Mathematics diagnostic",
    categories: ["Functions", "Algebra", "Derivatives", "Slope / Rate of Change"],
    questions: [
      {id:"m1", q:"If f(x) = 2x + 3, what is f(4)?", options:["8","10","11","12"], answer:2, concept:"Functions", difficulty:1},
      {id:"m2", q:"If g(x) = x² − 1, what is g(3)?", options:["6","8","9","10"], answer:1, concept:"Functions", difficulty:1},
      {id:"m3", q:"If 2x + 5 = 15, what is x?", options:["3","5","7","10"], answer:1, concept:"Algebra", difficulty:1},
      {id:"m4", q:"If 3(x - 2) = 12, what is x?", options:["4","6","8","5"], answer:1, concept:"Algebra", difficulty:2},
      {id:"m5", q:"If the derivative of f(x) = x² is f'(x) = 2x, what is f'(3)?", options:["3","5","6","9"], answer:2, concept:"Derivatives", difficulty:1},
      {id:"m6", q:"What is the derivative of f(x) = 5x + 7?", options:["5","7","5x","0"], answer:0, concept:"Derivatives", difficulty:2},
      {id:"m7", q:"What does the slope of a straight line represent?", options:["Its area","Its rate of change","Its maximum value","Its x-intercept"], answer:1, concept:"Slope / Rate of Change", difficulty:1},
      {id:"m8", q:"What is the slope of the line passing through (0,2) and (4,10)?", options:["2","4","8","1/2"], answer:0, concept:"Slope / Rate of Change", difficulty:2}
    ]
  },
  computer: {
    name: "Computer Fundamentals",
    eyebrow: "Computer Fundamentals diagnostic",
    categories: ["CPU & Processing", "Memory & Storage", "Operating Systems", "Internet & Web", "Networking"],
    questions: [
      {id:"c1", q:"Which component is primarily responsible for performing calculations and executing instructions?", options:["RAM","CPU","Monitor","Keyboard"], answer:1, concept:"CPU & Processing", difficulty:1},
      {id:"c2", q:"What is the clock rate of a CPU a measure of?", options:["Storage size","Processing cycle speed","Network bandwidth","Display refresh speed"], answer:1, concept:"CPU & Processing", difficulty:2},
      {id:"c3", q:"What is RAM mainly used for?", options:["Permanently storing files","Temporarily storing data and programs currently in use","Connecting a computer to Wi-Fi","Displaying images"], answer:1, concept:"Memory & Storage", difficulty:1},
      {id:"c4", q:"How does SSD storage differ from RAM?", options:["SSD is non-volatile long-term storage","SSD is faster than RAM","RAM retains data without power","They are identical"], answer:0, concept:"Memory & Storage", difficulty:2},
      {id:"c5", q:"Which of the following is an operating system?", options:["Google Chrome","Windows","HDMI","NVIDIA"], answer:1, concept:"Operating Systems", difficulty:1},
      {id:"c6", q:"What is the kernel's primary role in an Operating System?", options:["Rendering graphics","Managing hardware resources and system requests","Browsing the web","Editing text files"], answer:1, concept:"Operating Systems", difficulty:2},
      {id:"c7", q:"What does a web browser primarily allow you to do?", options:["Physically repair computer hardware","Access and interact with websites on the Internet","Increase RAM","Replace the operating system"], answer:1, concept:"Internet & Web", difficulty:1},
      {id:"c8", q:"What does HTTPS stand for in web communication?", options:["HyperText Transfer Protocol Secure","High Tech Transfer System","Home Text Transfer Protocol","HyperText Transmission Storage"], answer:0, concept:"Internet & Web", difficulty:2},
      {id:"c9", q:"Which device is commonly used to connect multiple devices within the same local network?", options:["Router","Monitor","Keyboard","Printer"], answer:0, concept:"Networking", difficulty:1},
      {id:"c10", q:"What is an IP address used for?", options:["Identifying a device on a network","Calculating numbers","Saving files","Powering the motherboard"], answer:0, concept:"Networking", difficulty:2}
    ]
  }
};

function selectAdaptiveQuestions(subject){
  const bank = assessments[subject].questions;
  const stats = conceptStats(subject);
  
  if(!Object.keys(stats).length){
    return bank.slice(0, 5);
  }

  const sortedConcepts = [...assessments[subject].categories].sort((a,b) => {
    const scoreA = conceptScore(subject, a) ?? 50;
    const scoreB = conceptScore(subject, b) ?? 50;
    return scoreA - scoreB;
  });

  const selected = [];
  sortedConcepts.forEach(concept => {
    const conceptQuestions = bank.filter(q => q.concept === concept);
    const score = conceptScore(subject, concept);
    if(score !== null && score >= 75){
      const hard = conceptQuestions.find(q => q.difficulty > 1) || conceptQuestions[0];
      if(hard && !selected.includes(hard)) selected.push(hard);
    } else {
      const normal = conceptQuestions.find(q => q.difficulty === 1) || conceptQuestions[0];
      if(normal && !selected.includes(normal)) selected.push(normal);
    }
  });

  for(let q of bank){
    if(selected.length >= 5) break;
    if(!selected.includes(q)) selected.push(q);
  }

  return selected.slice(0, 5);
}

const lessons = {
  "Functions": {
    title:"Functions, explained simply",
    body:"A function is like a machine. You give it an input, it processes that input, and it produces an output. The notation f(x) tells you which machine you're using and what input you are giving it.",
    flow:["Input: x","Function: f","Output: f(x)"],
    formula:"f(x) = 2x + 3  •  x = 4  •  f(4) = 11",
    example:"Replace every x with the input number, then calculate. For f(4), that becomes 2(4) + 3 = 8 + 3 = 11.",
    quick:"If f(x) = 3x + 2, what is f(4)?", options:["10","12","14","16"], answer:2,
    explanation:"You missed multiple questions involving function notation and evaluation. Although the questions looked different, they relied on the same underlying concept: understanding how an input is transformed into an output.",
    next:"Limits"
  },
  "Algebra": {
    title:"Algebra, explained simply",
    body:"An equation is a statement that two expressions are equal. Solving it means finding the value that makes the statement true.",
    flow:["Equation","Isolate x","Check the result"],
    formula:"2x + 5 = 15  •  2x = 10  •  x = 5",
    example:"Undo the operations around x in reverse order. Subtract 5 from both sides, then divide both sides by 2.",
    quick:"If 3x + 4 = 19, what is x?", options:["3","4","5","6"], answer:2,
    explanation:"Your missed equation question points to a gap in solving basic equations. The key step is undoing operations while keeping both sides equal.",
    next:"Functions"
  },
  "Derivatives": {
    title:"Derivatives, explained simply",
    body:"A derivative tells us how quickly something is changing at a particular point.",
    flow:["Function","Rate of change","Derivative"],
    formula:"f(x) = x²  •  f'(x) = 2x  •  f'(3) = 6",
    example:"Once the derivative is given, substitute the point into it. For f'(3) = 2(3), the result is 6.",
    quick:"If f'(x) = 3x, what is f'(4)?", options:["7","10","12","16"], answer:2,
    explanation:"The derivative question suggests that evaluating a rate of change at a specific point needs reinforcement.",
    next:"Applications of Derivatives"
  },
  "Slope / Rate of Change": {
    title:"Slope, explained simply",
    body:"Slope describes the rate at which one quantity changes compared with another.",
    flow:["Change in y","Compared with","Change in x"],
    formula:"Slope = change in y ÷ change in x",
    example:"A positive slope means y increases as x increases. The slope tells you how much y changes for each unit change in x.",
    quick:"What does the slope of a line represent?", options:["Its area","Its rate of change","Its maximum value","Its x-intercept"], answer:1,
    explanation:"Your answer suggests that the meaning of slope as a rate of change needs reinforcement before moving to more advanced graph concepts.",
    next:"Functions / Graphs"
  },
  "CPU & Processing": {
    title:"CPU & processing, explained simply",
    body:"The CPU is the main processor of a computer. It executes instructions and performs calculations.",
    flow:["Input","CPU processes","Output"],
    formula:"CPU → fetch → decode → execute",
    example:"When an application asks the computer to perform an operation, the CPU carries out the instructions needed to produce the result.",
    quick:"Which component executes instructions and performs calculations?", options:["RAM","CPU","Monitor","Keyboard"], answer:1,
    explanation:"Your incorrect processor question suggests that the role of the CPU as the computer's main processing component needs reinforcement.",
    next:"Computer Architecture"
  },
  "Memory & Storage": {
    title:"Memory & storage, explained simply",
    body:"RAM is temporary working memory. It holds the data and programs your computer is actively using.",
    flow:["Storage","Load into RAM","CPU uses active data"],
    formula:"RAM = temporary  •  Storage = long-term",
    example:"Think of storage as a filing cabinet and RAM as the desk where the files you are currently working on are placed.",
    quick:"Which type of memory temporarily holds programs that are currently being used?", options:["RAM","Hard drive","Monitor","Keyboard"], answer:0,
    explanation:"You answered the RAM question incorrectly. This suggests the distinction between temporary memory and long-term storage needs reinforcement.",
    next:"Storage"
  },
  "Operating Systems": {
    title:"Operating systems, explained simply",
    body:"An operating system manages the computer's hardware and provides the environment where applications run.",
    flow:["Hardware","Operating system","Applications"],
    formula:"Windows → manages hardware + runs applications",
    example:"Windows, macOS and Linux are operating systems. A browser such as Chrome is an application that runs on an operating system.",
    quick:"Which of these is an operating system?", options:["Google Chrome","Windows","HDMI","NVIDIA"], answer:1,
    explanation:"Your answer suggests the distinction between system software and applications needs reinforcement.",
    next:"Applications"
  },
  "Internet & Web": {
    title:"Internet & the Web, explained simply",
    body:"The Internet is the global network connecting computers. The Web is a service that uses the Internet to provide websites and web pages.",
    flow:["Internet","Browser","Website"],
    formula:"Browser → request → web server → web page",
    example:"A browser such as Chrome lets you access and interact with websites, while the Internet provides the underlying network connection.",
    quick:"What does a web browser primarily let you do?", options:["Repair hardware","Access and interact with websites","Increase RAM","Replace the operating system"], answer:1,
    explanation:"Your browser question suggests that the role of a browser and its relationship to the Web needs reinforcement.",
    next:"Networking"
  },
  "Networking": {
    title:"Networking, explained simply",
    body:"A network allows devices to communicate and share resources. Routers help direct data between networks.",
    flow:["Device","Local network","Router","Other network"],
    formula:"Router = directs data between networks",
    example:"A router connects devices and helps move data between your local network and other networks, including the Internet.",
    quick:"Which device commonly connects multiple devices within the same local network?", options:["Router","Monitor","Keyboard","Printer"], answer:0,
    explanation:"Your networking question suggests that the role of a router in connecting devices and directing network traffic needs reinforcement.",
    next:"Internet & Security"
  }
};

function generateAiExplanation(qText, selectedOpt, correctOpt, concept){
  return `
    <div class="ai-explanation-box">
      <div class="ai-badge">🤖 GapWise AI Explanation</div>
      <p><strong>Concept:</strong> ${concept}</p>
      <p><strong>Why "${selectedOpt}" was incorrect:</strong> This choice reflects a common misunderstanding in ${concept}. It skips step-by-step verification.</p>
      <p><strong>Why "${correctOpt}" is correct:</strong> By applying the fundamental definition of ${concept}, the expression resolves cleanly to option "${correctOpt}".</p>
      <div class="ai-tip">💡 <em>Tip:</em> Review the foundational rules for ${concept} to build confidence for your next assessment.</div>
    </div>
  `;
}

function sidebar(active){
 const items=[
   ["dashboard","Dashboard","⌂"],
   ["assessment","Assessment","✓"],
   ["practice","Practice Weak Areas","🎯"],
   ["knowledge","Knowledge Map","◈"],
   ["recommended","Recommended","✦"],
   ["progress","Progress","↗"]
 ];
 return `<aside class="sidebar"><div class="side-label">Workspace</div><div class="side-nav">${items.map(i=>`<button class="side-link ${active===i[0]?"active":""}" data-route="${i[0]}"><span>${i[2]}</span>${i[1]}</button>`).join("")}</div><div class="side-spacer"></div><div class="side-label">Account</div><div class="side-nav"><button class="side-link"><span>?</span>Help center</button></div></aside>`;
}
function appPage(active, content){ return `<div class="app-page">${sidebar(active)}<section class="page-main">${content}</section></div>`; }

function landing(){
 return `
 <section class="hero">
  <div class="container hero-grid">
   <div>
    <span class="eyebrow"><span class="eyebrow-dot"></span> AI learning diagnostics</span>
    <h1>Don't just find the wrong answer. <em>Find the missing concept.</em></h1>
    <p class="hero-copy">AI-powered learning diagnostics that discover why students struggle — and help them fix it.</p>
    <div class="hero-actions">
      <button class="btn btn-primary btn-arrow" data-route="assessment">Start Assessment</button>
      <button class="btn btn-secondary" data-route="analysis-demo">See How It Works</button>
    </div>
    <div class="hero-note">A focused prototype experience • Built for better learning decisions</div>
   </div>
   <div class="dashboard-mock" aria-label="GapWise dashboard preview">
    <div class="mock-head"><span class="mock-title">Learning intelligence</span><span class="mock-dots"><i></i><i></i><i></i></span></div>
    <div class="mock-body">
      <div class="mock-card"><div class="mini-label">KNOWLEDGE SCORE</div><div class="score-ring"><strong>—</strong></div><div class="mini-label" style="text-align:center">Overall understanding</div></div>
      <div class="mock-card gap-card"><span class="gap-chip">No assessment data</span><h4>Your learning picture will appear here.</h4><p>Complete an assessment to discover your strengths and gaps.</p><button class="btn btn-soft" style="padding:7px 9px;font-size:9px" data-route="assessment">View insight</button></div>
    </div>
    <div class="mock-card" style="margin-top:12px"><div class="mini-label" style="margin-bottom:10px">CONCEPT STRENGTH</div><div class="mini-bars">
      <div class="mini-row"><span>Algebra</span><div class="bar"><i style="width:0%"></i></div><b>—</b></div>
      <div class="mini-row"><span>Functions</span><div class="bar"><i style="width:0%"></i></div><b>—</b></div>
      <div class="mini-row"><span>Calculus</span><div class="bar"><i style="width:0%"></i></div><b>—</b></div>
      <div class="mini-row"><span>Geometry</span><div class="bar"><i style="width:0%"></i></div><b>—</b></div>
    </div></div>
   </div>
  </div>
 </section>
 <section class="section">
  <div class="container center"><span class="eyebrow">The GapWise approach</span><h2 class="section-title" style="margin-top:14px">How GapWise works</h2><p class="section-subtitle">Turn mistakes into a map of what to learn next — not just a list of answers you got wrong.</p>
   <div class="steps">
    ${[
      ["01","Assess","Answer a few questions.","Give the system enough signal to understand how you think."],
      ["02","Detect","AI identifies patterns in your mistakes.","Connect wrong answers back to the underlying concept."],
      ["03","Improve","Get a personalized lesson and retry.","Close the gap, then prove the concept with your original question."]
    ].map(x=>`<article class="step-card"><div class="step-number">${x[0]}</div><h3>${x[1]}</h3><p style="font-weight:700;color:#353b4b">${x[2]}</p><p>${x[3]}</p></article>`).join("")}
   </div>
  </div>
 </section>
 <section class="section" style="padding-top:25px">
  <div class="container center"><span class="eyebrow">A different answer</span><h2 class="section-title" style="margin-top:14px">From correction to diagnosis</h2>
   <div class="compare">
    <article class="compare-card"><div class="compare-tag">Traditional AI Tutor</div><div class="quote">“Here's the answer.”</div><p class="muted">Useful for getting unstuck — but it can leave the reason behind the mistake invisible.</p></article>
    <article class="compare-card gapwise"><div class="compare-tag">GapWise AI</div><div class="quote">“Here's <strong>WHY</strong> you're struggling.”</div><p class="muted">Spot the concept underneath repeated mistakes, teach it simply, and let the learner retry.</p></article>
   </div>
  </div>
 </section>
 <section class="cta"><div class="container"><div class="cta-box"><h2>Discover what you're missing.</h2><p>Start with five focused questions. Leave with a clearer picture of what to learn next.</p><button class="btn btn-primary btn-arrow" data-route="assessment">Start Learning</button></div></div></section>`;
}

function subjectSelection(){
 return `<div class="subject-page">
   <div class="subject-head"><span class="eyebrow"><span class="eyebrow-dot"></span> GapWise assessment</span>
   <h1>What would you like to assess?</h1>
   <p class="muted">Choose a subject and we'll identify the concepts you understand — and the ones holding you back.</p></div>
   <div class="subject-grid">
    <article class="subject-card">
      <div class="subject-icon">📐</div><div class="subject-copy"><h2>Mathematics</h2>
      <p>Test your understanding of core mathematical concepts.</p><span>Algebra • Functions • Calculus</span></div>
      <button class="btn btn-primary btn-arrow" data-action="choose-subject" data-subject="math">Start Mathematics</button>
    </article>
    <article class="subject-card">
      <div class="subject-icon">💻</div><div class="subject-copy"><h2>Computer Fundamentals</h2>
      <p>Test your understanding of essential computer concepts.</p><span>Hardware • Software • Networks • Internet</span></div>
      <button class="btn btn-primary btn-arrow" data-action="choose-subject" data-subject="computer">Start Computer Fundamentals</button>
    </article>
   </div>
 </div>`;
}

function assessment(){
 if(!state.currentQuestions || !state.currentQuestions.length){
   state.currentQuestions = selectAdaptiveQuestions(state.subject);
 }
 const questions = state.currentQuestions;
 const a = assessments[state.subject] || assessments.math;
 const q = questions[state.question];
 const pct = (state.question / questions.length) * 100;
 return `<div class="assessment-shell">
  <span class="eyebrow"><span class="eyebrow-dot"></span> ${a.eyebrow}</span>
  <h1 style="font-size:38px;margin-top:15px">Let's discover what you know.</h1>
  <p class="muted" style="line-height:1.7">Answer honestly. Your mistakes help us understand how you learn.</p>
  <div class="assessment-subject-row"><span>${a.name} (Adaptive)</span><button class="small-link" data-route="assessment-switch">Switch Subject</button></div>
  <div class="progress-track"><i style="width:${Math.max(5,pct)}%"></i></div>
  <div class="question-card">
   <div class="question-meta"><span>Question ${state.question+1} of ${questions.length}</span><span>${q.concept}</span></div>
   <h2>${q.q}</h2>
   <div class="options">${q.options.map((o,i)=>`<button class="option ${state.selected===i?"selected":""}" data-option="${i}"><span class="letter">${String.fromCharCode(65+i)}</span><span>${o}</span></button>`).join("")}</div>
   <div class="assessment-actions"><button class="btn btn-ghost" ${state.question===0?"disabled":""} data-action="prev">← Back</button><button class="btn btn-primary btn-arrow" data-action="next">${state.question===questions.length-1?"Analyze My Answers":"Next Question"}</button></div>
  </div>
 </div>`;
}

function practiceSession(){
 const weakMath = getWeakConcepts("math");
 const weakComp = getWeakConcepts("computer");
 
 if(!state.practiceQuestions || !state.practiceQuestions.length){
   const weakConcepts = getWeakConcepts(state.subject);
   if(!weakConcepts.length){
     return appPage("practice", `
       <div class="page-head"><div><h1>Practice Weak Areas</h1><p>Targeted questions based on your identified knowledge gaps.</p></div></div>
       <div class="panel empty-state">
         <strong>No Knowledge Gaps Identified Yet</strong>
         <p>Great news! You currently have no identified weak areas (< 50% mastery) for ${assessments[state.subject].name}. Complete an assessment first to pinpoint areas for targeted practice.</p>
         <button class="btn btn-primary btn-arrow" data-route="assessment">Take Diagnostic Assessment</button>
       </div>
     `);
   }
   
   const bank = assessments[state.subject].questions;
   state.practiceQuestions = bank.filter(q => weakConcepts.includes(q.concept));
   if(!state.practiceQuestions.length){
     state.practiceQuestions = bank.slice(0, 3);
   }
   state.practiceQuestionIndex = 0;
   state.practiceAnswers = [];
   state.practiceSelected = null;
 }

 const questions = state.practiceQuestions;
 const idx = state.practiceQuestionIndex;
 const q = questions[idx];
 const pct = (idx / questions.length) * 100;

 return appPage("practice", `
   <div class="page-head"><div><h1>Practice Weak Areas</h1><p>Focusing on targeted concepts: <strong>${[...new Set(questions.map(q=>q.concept))].join(", ")}</strong></p></div></div>
   <div class="assessment-shell" style="padding-top:0">
     <div class="progress-track"><i style="width:${Math.max(5,pct)}%"></i></div>
     <div class="question-card">
      <div class="question-meta"><span>Practice Question ${idx+1} of ${questions.length}</span><span>${q.concept}</span></div>
      <h2>${q.q}</h2>
      <div class="options">${q.options.map((o,i)=>`<button class="option ${state.practiceSelected===i?"selected":""}" data-practice-option="${i}"><span class="letter">${String.fromCharCode(65+i)}</span><span>${o}</span></button>`).join("")}</div>
      <div class="assessment-actions">
        <button class="btn btn-ghost" ${idx===0?"disabled":""} data-action="practice-prev">← Back</button>
        <button class="btn btn-primary btn-arrow" data-action="practice-next">${idx===questions.length-1?"Complete Practice":"Next Question"}</button>
      </div>
     </div>
   </div>
 `);
}

function analysis(){
 return `<div class="analysis" id="analysis">
  <div class="loader-orb"></div><h1>Analyzing your answers...</h1><p>Mapping mistakes to the concepts underneath them.</p>
 </div>`;
}

function analyzeGap(){
 const questions = state.currentQuestions.length ? state.currentQuestions : (assessments[state.subject] || assessments.math).questions;
 const conceptTotals={};
 questions.forEach((q,i)=>{
   if(!conceptTotals[q.concept]) conceptTotals[q.concept]={wrong:0,total:0};
   conceptTotals[q.concept].total++;
   if(state.answers[i]!==q.answer) conceptTotals[q.concept].wrong++;
 });
 const ranked=Object.entries(conceptTotals)
   .filter(([,s])=>s.wrong>0)
   .sort((x,y)=>(y[1].wrong/y[1].total)-(x[1].wrong/x[1].total) || y[1].wrong-x[1].wrong);
 return ranked.length ? ranked[0][0] : null;
}

function understandingFor(concept){
 const score=conceptScore(state.subject, concept);
 return score === null ? 0 : score;
}

function gap(){
 const concept=state.gap || analyzeGap();
 if(!concept){ return results(); }
 state.gap=concept;
 const lessonData=lessons[concept] || lessons["Functions"];
 const pct=understandingFor(concept);
 const questions = state.currentQuestions.length ? state.currentQuestions : (assessments[state.subject] || assessments.math).questions;
 const wrongCount=questions.filter((q,i)=>state.answers[i]!==q.answer).length;
 return `<div class="gap-page">
  <span class="eyebrow"><span class="eyebrow-dot"></span> AI diagnosis · ${assessments[state.subject].name}</span>
  <h1 style="font-size:40px;margin:14px 0 8px">🧠 Knowledge Gap Detected</h1>
  <p class="muted">We found a concept worth fixing before you push deeper into your learning.</p>
  <div class="gap-card-large" style="margin-top:26px">
   <div class="gap-top"><div><div class="gap-label">UNDERLYING CONCEPT</div><h2 class="gap-name">${concept}</h2></div><div><div class="gap-label">CURRENT UNDERSTANDING</div><div class="gap-percent">${pct}%</div></div></div>
   <div class="confidence"><div class="confidence-top"><span>AI confidence</span><strong>${wrongCount ? Math.min(97,78+wrongCount*5) : 88}%</strong></div><div class="bar"><i style="width:${wrongCount ? Math.min(97,78+wrongCount*5) : 88}%"></i></div></div>
   <div class="why"><h3>Why did we detect this?</h3><p>${lessonData.explanation}</p></div>
   <div class="chain">${conceptChain().map((x,i)=>i%2?`<b>↓</b><span>${x}</span>`:`<span class="${x===concept?"focus":""}">${x}</span>`).join("")}</div>
   <button class="btn btn-primary btn-arrow" data-route="lesson">Fix My Knowledge Gap</button>
  </div>
 </div>`;
}

function conceptChain(){
 return state.subject==="computer"
 ? ["Hardware","CPU & Memory","Operating Systems","Applications","Internet & Networking"]
 : ["Algebra","Functions","Limits","Derivatives","Calculus"];
}

function lesson(){
 const concept=state.gap || analyzeGap();
 const l=lessons[concept] || lessons["Functions"];
 return `<div class="lesson-page">
  <div class="lesson-intro"><span class="eyebrow">Personalized lesson · 4 min · ${assessments[state.subject].name}</span><h1 style="margin-top:14px">Let's fix your ${concept} gap.</h1><p>A short explanation, one example, then your original question comes back.</p></div>
  <article class="lesson-card"><h2>${l.title}</h2><p>${l.body}</p>
   <div class="flow">${l.flow.map((x,i)=>`${i?`<b>→</b>`:""}<span class="box">${x}</span>`).join("")}</div>
   <div class="formula">${l.formula}</div>
   <div class="example"><strong>Think of it this way</strong><p style="margin-bottom:0">${l.example}</p></div>
  </article>
  <article class="lesson-card"><h2>Quick Check</h2><p>${l.quick}</p>
   <div class="check-options">${l.options.map((o,i)=>`<button class="check-option" data-check="${i}">${String.fromCharCode(65+i)}. ${o}</button>`).join("")}</div>
   ${state.lessonCorrect?`<div class="success">🎉 Nice! You've understood the concept.</div>`:state.quickCheckAttempts?`<div class="retry-note">Not quite. Let's look at the concept once more.</div>`:""}
   <div class="lesson-actions">${state.lessonCorrect?`<button class="btn btn-primary btn-arrow" data-route="results">Try My Original Question →</button>`:""}</div>
  </article>
 </div>`;
}

function results(){
 const concept=state.gap;
 const latest=loadAssessmentHistory()[0];
 const hasGap=!!concept;
 const after=hasGap ? understandingFor(concept) : null;
 const before=hasGap && latest ? previousConceptScore(state.subject, concept, latest.id) : null;
 const next=hasGap ? (lessons[concept]?.next || (state.subject==="computer"?"Internet & Networking":"Limits")) : null;
 
 const incorrectItems = latest ? (latest.concepts || []).filter(c => !c.correct) : [];

 return `<div class="results-page"><div class="result-hero"><span class="eyebrow">Assessment complete · ${assessments[state.subject].name}</span><h1 style="margin-top:14px">${hasGap?"Knowledge Gap Identified":"Great work — no knowledge gaps detected"} 🎉</h1><p>${hasGap?"We found a concept worth strengthening based on your actual answers.":"You answered every question correctly in this assessment."}</p></div>
  <div class="result-card">
   ${hasGap ? `<div class="before-after">
   <div class="ba"><div class="ba-head"><span>BEFORE</span><span>${concept}</span></div><div class="ba-value">${before}%</div><div class="progress-large"><i style="width:${before}%"></i></div></div>
   <div class="ba after"><div class="ba-head"><span>AFTER</span><span>${concept}</span></div><div class="ba-value">${after}%</div><div class="progress-large"><i style="width:${after}%"></i></div></div>
  </div>
  <div class="changes"><h3>What changed?</h3><ul><li>Your assessment result was saved to your learning history</li><li>${after}% of your recorded ${concept} answers are currently correct</li><li>Your Dashboard will use this result in future progress calculations</li></ul></div>
  <div class="next"><div><small>YOUR NEXT RECOMMENDED TOPIC</small><strong>${concept} → ${next}</strong></div><button class="btn btn-primary btn-arrow" data-route="dashboard">Continue Learning →</button></div>`
  : `<div class="changes"><h3>Your assessment result</h3><p class="muted">Your result has been saved. Dashboard progress is now based on your completed assessments.</p><ul><li>All answers in this assessment were correct</li><li>Your concept strengths will reflect this performance</li><li>No knowledge gap was created because no concept showed weakness</li></ul></div>
  <div class="next"><div><small>NEXT STEP</small><strong>Keep learning and take another assessment</strong></div><button class="btn btn-primary btn-arrow" data-route="dashboard">Go to Dashboard →</button></div>`}

  ${incorrectItems.length ? `
    <div style="margin-top:30px;padding-top:24px;border-top:1px solid var(--line);">
      <h3>Review & AI Explanations</h3>
      <p class="muted" style="font-size:13px;margin-bottom:16px;">Click below to see detailed AI breakdowns of your incorrect responses.</p>
      ${incorrectItems.map((item, idx) => `
        <div class="mistake-item" style="margin-bottom:14px;padding:14px;border:1px solid var(--line);border-radius:12px;background:#fafbfe;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${item.questionText || 'Question'}</strong>
            <button class="btn btn-soft" style="padding:5px 10px;font-size:11px;" data-action="explain-mistake" data-idx="${idx}">Explain my mistake 🤖</button>
          </div>
          <div id="ai-explanation-${idx}" style="display:none;margin-top:12px;">
            ${generateAiExplanation(
              item.questionText,
              item.options ? item.options[item.userAnswer] : "Your Answer",
              item.options ? item.options[item.correctAnswer] : "Correct Answer",
              item.concept
            )}
          </div>
        </div>
      `).join('')}
    </div>
  ` : ''}
 </div></div>`;
}

function dashboard(){
 const mathScore=subjectScore("math");
 const compScore=subjectScore("computer");
 const overall=overallScore();
 const mathSummary=subjectConceptSummary("math");
 const compSummary=subjectConceptSummary("computer");
 const selectedSubject=state.subject==="computer"?"computer":"math";
 const selectedSummary=selectedSubject==="computer"?compSummary:mathSummary;
 const history=loadAssessmentHistory().slice(0,5);
 const hasData=history.length>0;
 const streak = calculateStreak();

 const weakConcepts = getWeakConcepts(selectedSubject);

 const overviewText=hasData
   ? "Your learning snapshot, updated from your completed assessments."
   : "No assessment data yet. Take your first assessment to build your learning snapshot.";

 const subjectCard=(subject,name,icon,score,summary)=>`
  <article class="subject-progress-card"><div><span class="subject-card-icon">${icon}</span><h3>${name}</h3></div>
   <strong>${score===null?"—":score+"%"}</strong>
   <p>${score===null?"Not assessed yet":`${summary.strong} strong concepts · ${summary.gaps} knowledge gaps`}</p>
   <div class="bar"><i style="width:${score===null?0:score}%"></i></div>
  </article>`;

 const overallMeta=overall===null
   ? "Complete an assessment to calculate this."
   : `${history.length} completed assessment${history.length===1?"":"s"} · average score`;

 const recent=history.length ? history.map(r=>`<div class="recent-row"><span>${r.subject==="computer"?"💻":"📐"}</span><div><strong>${r.subjectName} ${r.isPractice?'<small style="display:inline;color:#7357ff">(Practice)</small>':''}</strong><small>${r.correct}/${r.total} correct · ${formatAssessmentDate(r.completedAt)}</small></div><b>${r.score}%</b></div>`).join("")
   : `<div class="empty-state"><strong>No assessments yet</strong><p>Take your first assessment to see real scores, strengths, and knowledge gaps here.</p><button class="btn btn-primary btn-arrow" data-route="assessment">Take First Assessment</button></div>`;

 const content=`
 <div class="page-head">
  <div>
    <h1>Good morning, Student 👋</h1>
    <p>${overviewText}</p>
  </div>
  <div style="display:flex;gap:10px;align-items:center;">
    ${streak > 0 ? `<div class="streak-badge" title="Active Learning Streak">🔥 ${streak} day streak</div>` : ''}
    <button class="btn btn-primary btn-arrow" data-route="assessment">New Assessment</button>
  </div>
 </div>

 ${weakConcepts.length > 0 ? `
   <div class="practice-prompt-banner" style="background:linear-gradient(135deg,#f0edff,#e6f0ff);border:1px solid #d4cdff;padding:16px 20px;border-radius:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
     <div>
       <strong style="color:#4a32b0;font-size:15px;">Targeted Practice Available</strong>
       <p style="margin:4px 0 0;font-size:13px;color:#555d6d;">Demonstrated weak areas: ${weakConcepts.join(", ")}</p>
     </div>
     <button class="btn btn-primary" data-route="practice">Practice Weak Areas 🎯</button>
   </div>
 ` : ''}

 <h2 class="overview-title">Your Learning Overview</h2>
 <div class="subject-overview-grid">
  ${subjectCard("math","Mathematics","📐",mathScore,mathSummary)}
  ${subjectCard("computer","Computer Fundamentals","💻",compScore,compSummary)}
 </div>
 <div class="metric-grid">
  <div class="metric-card"><div class="metric-label">Overall Knowledge</div><div class="metric-value">${overall===null?"—":overall+"%"}</div><div class="metric-meta ${overall===null?"":"good"}">${overallMeta}</div></div>
  <div class="metric-card"><div class="metric-label">🟢 Strong Concepts</div><div class="metric-value">${selectedSummary.strong}</div><div class="metric-meta">Based on concepts with at least 75% correct</div></div>
  <div class="metric-card"><div class="metric-label">🔴 Knowledge Gaps</div><div class="metric-value">${selectedSummary.gaps}</div><div class="metric-meta ${selectedSummary.gaps?"bad":""}">${selectedSummary.gaps?"Based on concepts below 50% correct":"No demonstrated weaknesses yet"}</div></div>
 </div>
 <div class="content-grid">
  <div class="panel"><div class="panel-head"><h3>Knowledge Map</h3><button class="small-link" data-route="knowledge">View full map →</button></div>
   <div class="map-subject-switch"><button class="small-link ${selectedSubject!=="computer"?"active":""}" data-action="set-map-subject" data-subject="math">Mathematics</button><button class="small-link ${selectedSubject==="computer"?"active":""}" data-action="set-map-subject" data-subject="computer">Computer Fundamentals</button></div>
   ${knowledgeMapMarkup()}
  </div>
  <div class="panel"><div class="panel-head"><h3>Concept strengths</h3><span class="small-link">${assessments[selectedSubject].categories.length} topics</span></div>
   <div class="knowledge-list">${strengthRows()}</div>
  </div>
 </div>
 <div class="panel recent-assessments"><div class="panel-head"><h3>Recent Assessments</h3></div>
  ${recent}
 </div>
 <div class="insight" style="margin-top:18px"><span class="spark">✦</span><h3>AI Insight</h3>
  <p>${hasData && state.gap ? `Your latest ${assessments[state.subject].name} assessment points to <strong>${state.gap}</strong> as a concept worth strengthening.` : hasData ? "Your dashboard is now driven by your real assessment performance. Take more assessments to build a more reliable picture over time." : "No assessment data yet. Complete an assessment and GapWise will map your actual strengths and gaps."}</p>
  <button class="btn btn-primary btn-arrow" data-route="assessment">${hasData?"Take Another Assessment":"Take First Assessment"}</button>
 </div>
 <div style="margin-top:12px"><button class="small-link" data-action="reset-data">Clear assessment data</button></div>`;
 return appPage("dashboard",content);
}

function knowledgeMapMarkup(){
 const computer=state.subject==="computer";
 const categories = assessments[computer?"computer":"math"].categories;
 const stats=conceptStats(computer?"computer":"math");

 const nodes=computer
 ? [["CPU & Processing","n1"],["Memory & Storage","n2"],["Operating Systems","center"],["Internet & Web","n3"],["Networking","n4"]]
 : [["Algebra","n1"],["Functions","center"],["Derivatives","n3"],["Slope / Rate of Change","n4"]];

 return `<div class="map-wrap"><div class="map">${nodes.map(n=>{
   const conceptName = n[0];
   const score = conceptScore(computer?"computer":"math", conceptName);
   const cls = score !== null ? (score >= 75 ? "strong" : score < 50 ? "focus" : "developing") : "";
   return `<div class="node ${n[1]} ${cls}" data-action="concept-click" data-concept="${conceptName}" title="${score===null?"Not assessed":score+"%"}">${conceptName}${score===null?"":` · ${score}%`}</div>`;
 }).join("")}<i class="connector c1"></i><i class="connector c2"></i><i class="connector c3"></i><i class="connector c4"></i></div>
 
 ${state.activeConceptModal ? renderConceptModal(state.activeConceptModal) : ''}
 </div>`;
}

function renderConceptModal(conceptName){
 const subject = state.subject === "computer" ? "computer" : "math";
 const stats = conceptStats(subject)[conceptName];
 const score = conceptScore(subject, conceptName);
 const trend = conceptTrend(subject, conceptName);

 let statusLabel = "Not assessed";
 let statusCls = "neutral";
 if(score !== null){
   if(score >= 75){ statusLabel = "Strong"; statusCls = "green"; }
   else if(score >= 50){ statusLabel = "Developing"; statusCls = "yellow"; }
   else { statusLabel = "Needs attention"; statusCls = "red"; }
 }

 const attempts = stats ? stats.total : 0;
 const correct = stats ? stats.correct : 0;
 const incorrect = stats ? (stats.total - stats.correct) : 0;

 return `
   <div class="concept-modal-backdrop" data-action="close-modal">
     <div class="concept-modal-card" onclick="event.stopPropagation()">
       <div style="display:flex;justify-space-between;align-items:center;margin-bottom:12px;">
         <h3 style="margin:0;font-size:20px;">${conceptName}</h3>
         <button class="small-link" data-action="close-modal" style="font-size:16px;">✕</button>
       </div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
         <div style="background:#f7f8fc;padding:10px;border-radius:10px;">
           <small class="muted">Mastery</small>
           <div style="font-size:22px;font-weight:800;">${score === null ? "—" : score + "%"}</div>
         </div>
         <div style="background:#f7f8fc;padding:10px;border-radius:10px;">
           <small class="muted">Status</small>
           <div style="font-size:14px;font-weight:700;" class="${statusCls}">${statusLabel}</div>
         </div>
       </div>
       <div style="font-size:13px;line-height:1.6;margin-bottom:16px;color:#555d6d;">
         <div>Attempts: <strong>${attempts}</strong></div>
         <div>Correct: <strong style="color:var(--green);">${correct}</strong></div>
         <div>Incorrect: <strong style="color:var(--red);">${incorrect}</strong></div>
         <div>Trend: <strong>${trend}</strong></div>
       </div>
       <div style="display:flex;gap:8px;">
         <button class="btn btn-primary" style="flex:1;padding:8px;font-size:12px;" data-action="modal-practice" data-concept="${conceptName}">Practice ${conceptName}</button>
         <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:12px;" data-action="modal-learn" data-concept="${conceptName}">Learn ${conceptName}</button>
       </div>
     </div>
   </div>
 `;
}

function strengthRows(){
 const subject=state.subject==="computer"?"computer":"math";
 const rows=assessments[subject].categories;
 return rows.map(concept=>{
   const score=conceptScore(subject,concept);
   const cls=score===null?"":score>=75?"green":score<50?"red":"yellow";
   return `<div class="knowledge-row"><strong>${concept}</strong><div class="bar"><i style="width:${score===null?0:score}%"></i></div><div class="knowledge-score"><span class="status-dot ${cls}"></span>${score===null?"—":score+"%"}</div></div>`;
 }).join("");
}

function recommendedPage(){
 const weakMath = getWeakConcepts("math");
 const weakComp = getWeakConcepts("computer");
 const allHistory = loadAssessmentHistory();

 if(!allHistory.length){
   return appPage("recommended", `
     <div class="page-head"><div><h1>Personalized Recommendations</h1><p>Dynamic learning recommendations based on your performance.</p></div></div>
     <div class="panel empty-state">
       <strong>No assessment data yet</strong>
       <p>Complete your first diagnostic assessment to unlock personalized topic recommendations tailored to your knowledge gaps.</p>
       <button class="btn btn-primary btn-arrow" data-route="assessment">Start First Assessment</button>
     </div>
   `);
 }

 const weakConcepts = [...new Set([...weakMath, ...weakComp])];

 return appPage("recommended", `
   <div class="page-head"><div><h1>Personalized Recommendations</h1><p>Tailored action paths derived from your actual assessment results.</p></div></div>
   ${weakConcepts.length === 0 ? `
     <div class="panel empty-state">
       <strong>🎉 All Concepts Strong!</strong>
       <p>You currently have no demonstrated knowledge gaps below 50% mastery across Mathematics or Computer Fundamentals.</p>
       <button class="btn btn-primary btn-arrow" data-route="assessment">Retest Performance</button>
     </div>
   ` : `
     <div style="display:grid;gap:16px;max-width:800px;">
       ${weakConcepts.map(concept => {
         const subject = assessments.math.categories.includes(concept) ? "math" : "computer";
         const score = conceptScore(subject, concept);
         return `
           <div class="panel" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
             <div>
               <span class="eyebrow" style="margin-bottom:6px;">Focus on ${concept}</span>
               <h3 style="margin:4px 0;">${concept} (${assessments[subject].name})</h3>
               <p class="muted" style="margin:0;font-size:13px;">Your recent assessment data shows current mastery at ${score}%. Practice is recommended to strengthen this concept.</p>
             </div>
             <div style="display:flex;gap:8px;">
               <button class="btn btn-soft" data-action="modal-learn" data-concept="${concept}">Learn ${concept}</button>
               <button class="btn btn-primary" data-action="modal-practice" data-concept="${concept}">Practice ${concept}</button>
             </div>
           </div>
         `;
       }).join('')}
     </div>
   `}
 `);
}

function progressPage(){
 const history = loadAssessmentHistory().reverse();
 const mathHistory = history.filter(r => r.subject === "math");
 const compHistory = history.filter(r => r.subject === "computer");

 const mathScore = subjectScore("math");
 const compScore = subjectScore("computer");
 const mathSummary = subjectConceptSummary("math");
 const compSummary = subjectConceptSummary("computer");

 return appPage("progress", `
   <div class="page-head"><div><h1>Progress Over Time</h1><p>Historical trends built from your actual saved assessment attempts.</p></div></div>
   
   ${!history.length ? `
     <div class="panel empty-state">
       <strong>No assessment data yet</strong>
       <p>Complete an assessment to start tracking your performance trend over time.</p>
       <button class="btn btn-primary btn-arrow" data-route="assessment">Take First Assessment</button>
     </div>
   ` : `
     <div class="panel" style="margin-bottom:20px;">
       <h3>Performance History Visualization</h3>
       <div class="history-timeline" style="margin-top:20px;display:flex;gap:12px;align-items:flex-end;height:180px;padding:10px;border-bottom:1px solid var(--line);">
         ${history.map((r, i) => `
           <div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;">
             <small style="font-size:10px;font-weight:800;margin-bottom:4px;">${r.score}%</small>
             <div style="width:100%;max-width:36px;height:${Math.max(8, r.score)}%;background:linear-gradient(180deg,#7357ff,#4f7cff);border-radius:6px 6px 0 0;" title="${r.subjectName} - ${r.score}%"></div>
             <small style="font-size:9px;color:#7a8190;margin-top:6px;white-space:nowrap;">#${i+1} (${r.subject === "computer" ? "CS" : "Math"})</small>
           </div>
         `).join('')}
       </div>
     </div>

     <div class="metric-grid" style="margin-bottom:20px;">
       <div class="metric-card">
         <div class="metric-label">Total Assessments Completed</div>
         <div class="metric-value">${history.length}</div>
       </div>
       <div class="metric-card">
         <div class="metric-label">Mathematics Avg</div>
         <div class="metric-value">${mathScore === null ? "—" : mathScore + "%"}</div>
         <div class="metric-meta">${mathSummary.strong} Strong · ${mathSummary.gaps} Gaps</div>
       </div>
       <div class="metric-card">
         <div class="metric-label">Computer Fundamentals Avg</div>
         <div class="metric-value">${compScore === null ? "—" : compScore + "%"}</div>
         <div class="metric-meta">${compSummary.strong} Strong · ${compSummary.gaps} Gaps</div>
       </div>
     </div>
   `}
 `);
}

function simplePanel(title, text, active){
 const mapSubject=state.subject==="computer"?"Computer Fundamentals":"Mathematics";
 return appPage(active, `<div class="page-head"><div><h1>${title}</h1><p>${text}</p></div></div><div class="panel" style="max-width:760px">${title==="Knowledge Map"?`<div class="map-subject-switch" style="margin-bottom:12px;"><button class="small-link ${state.subject!=="computer"?"active":""}" data-action="set-map-subject" data-subject="math">Mathematics</button><button class="small-link ${state.subject==="computer"?"active":""}" data-action="set-map-subject" data-subject="computer">Computer Fundamentals</button></div>${knowledgeMapMarkup()}`:`<h3 style="margin-bottom:10px">Coming into focus</h3><p class="muted" style="line-height:1.8">This prototype keeps the experience intentionally focused. Your learning data will appear here as the diagnostic engine grows.</p>`}<button class="btn btn-primary btn-arrow" data-route="assessment">Run an assessment</button></div>`);
}

function resetAssessment(subject){
 state.subject=subject;
 state.question=0;
 state.answers=[];
 state.selected=null;
 state.assessmentDone=false;
 state.lessonCorrect=false;
 state.quickCheckAttempts=0;
 state.gap=null;
 state.currentQuestions = selectAdaptiveQuestions(subject);
}

function render(route=state.route){
 state.route=route;
 let out = route==="landing"?landing():
 route==="dashboard"?dashboard():
 route==="assessment"?(state.subject && state.assessmentDone?gap():state.subject?assessment():subjectSelection()):
 route==="assessment-switch"?subjectSelection():
 route==="practice"?practiceSession():
 route==="subject-selection"?subjectSelection():
 route==="analysis"?analysis():
 route==="analysis-demo"?analysis():
 route==="gap"?gap():
 route==="lesson"?lesson():
 route==="results"?results():
 route==="knowledge"?simplePanel("Knowledge Map","Explore the concepts behind your current mastery.","knowledge"):
 route==="recommended"?recommendedPage():
 route==="progress"?progressPage():
 landing();
 view.innerHTML=out;

 document.querySelectorAll("[data-route]").forEach(el=>el.addEventListener("click",()=>{
   if(el.dataset.route === "practice"){
     state.practiceQuestions = [];
   }
   navigate(el.dataset.route);
 }));
 document.querySelectorAll("[data-option]").forEach(el=>el.addEventListener("click",()=>{state.selected=Number(el.dataset.option);render("assessment")}));
 document.querySelectorAll("[data-practice-option]").forEach(el=>el.addEventListener("click",()=>{state.practiceSelected=Number(el.dataset.practiceOption);render("practice")}));
 
 document.querySelectorAll("[data-action='choose-subject']").forEach(el=>el.addEventListener("click",()=>{resetAssessment(el.dataset.subject);navigate("assessment")}));
 document.querySelectorAll("[data-action='set-map-subject']").forEach(el=>el.addEventListener("click",()=>{state.subject=el.dataset.subject;render(state.route)}));
 
 document.querySelectorAll("[data-action='concept-click']").forEach(el=>el.addEventListener("click",(e)=>{
   state.activeConceptModal = el.dataset.concept;
   render(state.route);
 }));
 
 document.querySelectorAll("[data-action='close-modal']").forEach(el=>el.addEventListener("click",()=>{
   state.activeConceptModal = null;
   render(state.route);
 }));

 document.querySelectorAll("[data-action='modal-practice']").forEach(el=>el.addEventListener("click",()=>{
   const concept = el.dataset.concept;
   state.activeConceptModal = null;
   const subject = assessments.math.categories.includes(concept) ? "math" : "computer";
   state.subject = subject;
   state.practiceQuestions = assessments[subject].questions.filter(q => q.concept === concept);
   state.practiceQuestionIndex = 0;
   state.practiceAnswers = [];
   state.practiceSelected = null;
   navigate("practice");
 }));

 document.querySelectorAll("[data-action='modal-learn']").forEach(el=>el.addEventListener("click",()=>{
   const concept = el.dataset.concept;
   state.activeConceptModal = null;
   state.gap = concept;
   navigate("lesson");
 }));

 document.querySelectorAll("[data-action='explain-mistake']").forEach(el=>el.addEventListener("click",()=>{
   const idx = el.dataset.idx;
   const target = document.getElementById(`ai-explanation-${idx}`);
   if(target){
     target.style.display = target.style.display === "none" ? "block" : "none";
   }
 }));

 document.querySelectorAll("[data-action='reset-data']").forEach(el=>el.addEventListener("click",()=>{
   if(confirm("Clear all GapWise assessment data for this browser user?")){
     saveAssessmentHistory([]);
     state.gap=null;
     state.practiceQuestions = [];
     toastMsg("Assessment data cleared.");
     render("dashboard");
   }
 }));

 document.querySelectorAll("[data-check]").forEach(el=>el.addEventListener("click",()=>{
   const concept=state.gap || analyzeGap(), l=lessons[concept]||lessons.Functions;
   if(Number(el.dataset.check)===l.answer){state.lessonCorrect=true;render("lesson");toastMsg("Concept mastered — nice work!")}
   else {state.quickCheckAttempts++;render("lesson");toastMsg("Not quite — review the concept and try again.")}
 }));

 document.querySelectorAll("[data-action='next']").forEach(el=>el.addEventListener("click",()=>handleAction("next")));
 document.querySelectorAll("[data-action='prev']").forEach(el=>el.addEventListener("click",()=>handleAction("prev")));
 document.querySelectorAll("[data-action='practice-next']").forEach(el=>el.addEventListener("click",()=>handlePracticeAction("next")));
 document.querySelectorAll("[data-action='practice-prev']").forEach(el=>el.addEventListener("click",()=>handlePracticeAction("prev")));

 document.querySelectorAll(".topnav .nav-link").forEach(el=>el.classList.toggle("active",el.dataset.route===route));
 window.scrollTo({top:0,behavior:"smooth"});
}

function navigate(route){
 if(route==="analysis-demo"){location.hash="analysis";state.route="analysis";render("analysis");setTimeout(()=>{state.subject=state.subject||"math";state.answers=state.answers.length?state.answers:[];state.gap=state.answers.length?analyzeGap():null;render(state.gap?"gap":"dashboard")},1500);return;}
 if(route==="assessment" && (state.assessmentDone || !state.subject)){
   if(state.assessmentDone){state.subject=null;state.assessmentDone=false;state.answers=[];state.selected=null;state.gap=null;}
   location.hash="assessment";render("assessment");return;
 }
 location.hash=route;render(route);
}

function handleAction(action){
 const questions = state.currentQuestions.length ? state.currentQuestions : (assessments[state.subject]||assessments.math).questions;
 if(action==="next"){
   if(state.selected===null){toastMsg("Choose an answer first.");return}
   state.answers[state.question]=state.selected;
   if(state.question<questions.length-1){
     state.question++;
     state.selected=state.answers[state.question]??null;
     render("assessment");
   }
   else {
     state.assessmentDone=true;
     const result=recordAssessmentResult(state.subject, questions, state.answers, false);
     state.gap=analyzeGap();
     state.latestScore=result.score;
     render("analysis");
     setTimeout(()=>navigate(state.gap ? "gap" : "results"),1700);
   }
 }
 if(action==="prev" && state.question>0){state.question--;state.selected=state.answers[state.question]??null;render("assessment")}
}

function handlePracticeAction(action){
 const questions = state.practiceQuestions;
 if(action==="next"){
   if(state.practiceSelected===null){toastMsg("Choose an answer first.");return}
   state.practiceAnswers[state.practiceQuestionIndex]=state.practiceSelected;
   if(state.practiceQuestionIndex < questions.length-1){
     state.practiceQuestionIndex++;
     state.practiceSelected=state.practiceAnswers[state.practiceQuestionIndex]??null;
     render("practice");
   }
   else {
     const result = recordAssessmentResult(state.subject, questions, state.practiceAnswers, true);
     state.practiceQuestions = [];
     toastMsg("Practice session recorded!");
     render("analysis");
     setTimeout(()=>navigate("results"),1500);
   }
 }
 if(action==="prev" && state.practiceQuestionIndex>0){
   state.practiceQuestionIndex--;
   state.practiceSelected=state.practiceAnswers[state.practiceQuestionIndex]??null;
   render("practice");
 }
}

function toastMsg(msg){toast.textContent=msg;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),1800)}
window.addEventListener("hashchange",()=>render(location.hash.replace("#","")||"landing"));
render();