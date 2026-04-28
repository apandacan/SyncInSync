const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "shared_state.json");

const ROLE_KEYS = ["interviewer", "hpi", "plan", "mse", "psychotherapy", "meds"];
const CORE_ROLE_KEYS = ["hpi", "plan", "mse", "psychotherapy", "meds"];
const SECONDARY_ROLE_KEYS = ["interviewer"];
const ASSIGNMENT_ROLE_ORDER = [...CORE_ROLE_KEYS, ...SECONDARY_ROLE_KEYS];

function emptyRoleAssignments() {
  return {
    interviewer: "",
    hpi: "",
    plan: "",
    mse: "",
    psychotherapy: "",
    meds: "",
  };
}

function defaultState() {
  return {
    students: [],
    patients: [],
    selectedPatientId: "",
    updatedAt: Date.now(),
  };
}

function normalizePatient(patient, index) {
  const assignments = emptyRoleAssignments();
  const sourceAssignments = patient?.assignments || {};

  for (const key of ROLE_KEYS) {
    assignments[key] = sourceAssignments[key] || "";
  }

  return {
    id: patient?.id || randomUUID(),
    label: patient?.label || `Patient ${index + 1}`,
    assignments,
    ended: Boolean(patient?.ended),
  };
}

function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultState();
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const patients = Array.isArray(parsed.patients)
      ? parsed.patients.map((patient, index) => normalizePatient(patient, index))
      : [];
    const selectedPatientId = patients.some((p) => p.id === parsed.selectedPatientId)
      ? parsed.selectedPatientId
      : (patients[0]?.id || "");

    return {
      students: Array.isArray(parsed.students)
        ? parsed.students.map((student, index) => ({
            id: student?.id || randomUUID(),
            name: student?.name || "",
            roleTitle: (student?.roleTitle || "Medical Student"),
            order: Number.isFinite(student?.order) ? student.order : index,
          }))
        : [],
      patients,
      selectedPatientId,
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

let state = loadState();
const clients = new Set();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function broadcast() {
  const data = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch {}
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function serveFile(reqPath, res) {
  const safePath = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    };

    res.writeHead(200, {
      "Content-Type": typeMap[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function sortedStudents() {
  return [...state.students]
    .filter((student) => String(student.name || "").trim())
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function roleCoverageCounts(excludedPatientId = "") {
  const counts = {};
  for (const roleKey of ROLE_KEYS) {
    counts[roleKey] = {};
  }

  for (const patient of state.patients) {
    if (excludedPatientId && patient.id === excludedPatientId) continue;
    for (const roleKey of ROLE_KEYS) {
      const studentId = patient.assignments?.[roleKey];
      if (!studentId) continue;
      counts[roleKey][studentId] = (counts[roleKey][studentId] || 0) + 1;
    }
  }

  return counts;
}

function totalCoverageCounts(excludedPatientId = "") {
  const counts = {};

  for (const patient of state.patients) {
    if (excludedPatientId && patient.id === excludedPatientId) continue;
    for (const roleKey of ROLE_KEYS) {
      const studentId = patient.assignments?.[roleKey];
      if (!studentId) continue;
      counts[studentId] = (counts[studentId] || 0) + 1;
    }
  }

  return counts;
}

function pickStudentForRole(roleKey, available, roleCoverage, totalCoverage, rowCounts) {
  const shuffled = shuffleInPlace([...available]);
  const roleCounts = roleCoverage[roleKey] || {};
  const hasUnusedStudents = shuffled.some((student) => (rowCounts[student.id] || 0) === 0);

  let eligible = shuffled;
  if (hasUnusedStudents) {
    eligible = shuffled.filter((student) => (rowCounts[student.id] || 0) === 0);
  }

  let best = null;
  let bestRoleCount = Infinity;
  let bestTotalCount = Infinity;
  let bestRowCount = Infinity;

  for (const student of eligible) {
    const studentId = student.id;
    const thisRoleCount = roleCounts[studentId] || 0;
    const totalCount = totalCoverage[studentId] || 0;
    const rowCount = rowCounts[studentId] || 0;

    if (
      thisRoleCount < bestRoleCount ||
      (thisRoleCount === bestRoleCount && totalCount < bestTotalCount) ||
      (thisRoleCount === bestRoleCount && totalCount === bestTotalCount && rowCount < bestRowCount)
    ) {
      best = student;
      bestRoleCount = thisRoleCount;
      bestTotalCount = totalCount;
      bestRowCount = rowCount;
    }
  }

  return best;
}

function randomizePatient(patient) {
  const available = sortedStudents();
  if (!available.length) return;

  const roleCoverage = roleCoverageCounts(patient.id);
  const totalCoverage = totalCoverageCounts(patient.id);
  const assignments = emptyRoleAssignments();
  const rowCounts = {};

  for (const roleKey of ASSIGNMENT_ROLE_ORDER) {
    const chosen = pickStudentForRole(roleKey, available, roleCoverage, totalCoverage, rowCounts);
    if (!chosen) continue;

    assignments[roleKey] = chosen.id;
    rowCounts[chosen.id] = (rowCounts[chosen.id] || 0) + 1;
    roleCoverage[roleKey][chosen.id] = (roleCoverage[roleKey][chosen.id] || 0) + 1;
    totalCoverage[chosen.id] = (totalCoverage[chosen.id] || 0) + 1;
  }

  patient.assignments = assignments;
}

function randomizeScheduleBalanced() {
  const available = sortedStudents();
  if (!available.length || !state.patients.length) return;

  const roleCoverage = {};
  for (const roleKey of ROLE_KEYS) {
    roleCoverage[roleKey] = {};
    for (const student of available) {
      roleCoverage[roleKey][student.id] = 0;
    }
  }

  const totalCoverage = {};
  for (const student of available) {
    totalCoverage[student.id] = 0;
  }

  const patients = [...state.patients];
  shuffleInPlace(patients);

  for (const patient of patients) {
    const assignments = emptyRoleAssignments();
    const rowCounts = {};

    for (const roleKey of ASSIGNMENT_ROLE_ORDER) {
      const chosen = pickStudentForRole(roleKey, available, roleCoverage, totalCoverage, rowCounts);
      if (!chosen) continue;

      assignments[roleKey] = chosen.id;
      rowCounts[chosen.id] = (rowCounts[chosen.id] || 0) + 1;
      roleCoverage[roleKey][chosen.id] = (roleCoverage[roleKey][chosen.id] || 0) + 1;
      totalCoverage[chosen.id] = (totalCoverage[chosen.id] || 0) + 1;
    }

    patient.assignments = assignments;
  }
}

async function handleUpdate(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const action = body.action;

  if (action === "addStudent") {
    state.students.push({
      id: randomUUID(),
      name: "",
      roleTitle: "Medical Student",
      order: state.students.length,
    });
  } else if (action === "updateStudentName") {
    const student = state.students.find((s) => s.id === body.studentId);
    if (!student) {
      sendJson(res, 404, { error: "Student not found" });
      return;
    }
    student.name = String(body.name || "");
  } else if (action === "updateStudentRoleTitle") {
    const student = state.students.find((s) => s.id === body.studentId);
    if (!student) {
      sendJson(res, 404, { error: "Student not found" });
      return;
    }
    student.roleTitle = String(body.roleTitle || "").trim() || "Medical Student";
  } else if (action === "registerSelf") {
    const name = String(body.name || "").trim();
    const roleTitle = String(body.roleTitle || "").trim() || "Medical Student";
    if (!name) {
      sendJson(res, 400, { error: "Name is required" });
      return;
    }

    let student = state.students.find((s) => s.id === body.studentId);
    if (student) {
      student.name = name;
      student.roleTitle = roleTitle;
    } else {
      student = state.students.find((s) =>
        String(s.name || "").trim().toLowerCase() === name.toLowerCase() &&
        String(s.roleTitle || "Medical Student").trim().toLowerCase() === roleTitle.toLowerCase()
      );
      if (!student) {
        student = {
          id: randomUUID(),
          name,
          roleTitle,
          order: state.students.length,
        };
        state.students.push(student);
      }
    }
    body._registeredStudentId = student.id;
  } else if (action === "deleteStudent") {
    state.students = state.students.filter((s) => s.id !== body.studentId);
    state.patients = state.patients.map((patient) => {
      const next = { ...patient, assignments: { ...patient.assignments } };
      for (const key of ROLE_KEYS) {
        if (next.assignments[key] === body.studentId) {
          next.assignments[key] = "";
        }
      }
      return next;
    });
  } else if (action === "resetBoard") {
    state = defaultState();
  } else if (action === "setPatientCount") {
    const count = Math.max(0, Math.min(50, Number(body.count) || 0));
    const next = [];
    for (let i = 0; i < count; i += 1) {
      const prev = state.patients[i];
      next.push(normalizePatient(prev, i));
    }
    state.patients = next;
    const selectable = state.patients.filter((p) => !p.ended);
    state.selectedPatientId = selectable.some((p) => p.id === state.selectedPatientId)
      ? state.selectedPatientId
      : (selectable[0]?.id || "");
  } else if (action === "updatePatientRole") {
    const patient = state.patients.find((p) => p.id === body.patientId);
    if (!patient) {
      sendJson(res, 404, { error: "Patient not found" });
      return;
    }
    if (!ROLE_KEYS.includes(body.roleKey)) {
      sendJson(res, 400, { error: "Invalid role key" });
      return;
    }
    patient.assignments[body.roleKey] = String(body.studentId || "");
  } else if (action === "randomizePatient") {
    const patient = state.patients.find((p) => p.id === body.patientId);
    if (!patient) {
      sendJson(res, 404, { error: "Patient not found" });
      return;
    }
    randomizePatient(patient);
  } else if (action === "randomizeSchedule") {
    randomizeScheduleBalanced();
  } else if (action === "clearScheduleAssignments") {
    state.patients = state.patients.map((patient) => ({
      ...patient,
      assignments: emptyRoleAssignments(),
    }));
  } else if (action === "clearBoardKeepStudents") {
    state.patients = [];
    state.selectedPatientId = "";
  } else if (action === "setSelectedPatient") {
    const patientId = String(body.patientId || "");
    state.selectedPatientId = state.patients.some((p) => p.id === patientId)
      ? patientId
      : (state.patients[0]?.id || "");
  } else if (action === "togglePatientEnded") {
    const patient = state.patients.find((p) => p.id === body.patientId);
    if (!patient) {
      sendJson(res, 404, { error: "Patient not found" });
      return;
    }
    patient.ended = !patient.ended;
  } else {
    sendJson(res, 400, { error: "Unknown action" });
    return;
  }

  state.updatedAt = Date.now();
  saveState();
  broadcast();
  sendJson(res, 200, { ok: true, state, currentUserStudentId: body._registeredStudentId || null });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && urlObj.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
    });

    clients.add(res);
    res.write(`data: ${JSON.stringify(state)}\n\n`);

    req.on("close", () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method === "GET" && urlObj.pathname === "/state") {
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && urlObj.pathname === "/update") {
    await handleUpdate(req, res);
    return;
  }

  if (req.method === "GET") {
    serveFile(urlObj.pathname, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`InSync Roles Sync running on http://localhost:${PORT}`);
});