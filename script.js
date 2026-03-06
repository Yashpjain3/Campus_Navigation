/* ============================================================
   Campus Navigator — script.js
   Fixes: sanitized IDs, auto-start after voice & dropdowns
   ============================================================ */

let session_id   = null;
let watchId      = null;
let totalSteps   = 0;
let currentStep  = 0;
let destName     = "";
let allLocations = [];
let voiceSetupDone = false;   // tracks if BOTH locations were set by voice

/* ------------------------------------------------------------------ */
/*  SPEAK                                                              */
/* ------------------------------------------------------------------ */

function speak(text, onEnd) {
  if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang  = "en-IN";
  utt.rate  = 0.92;
  utt.pitch = 1.0;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

/* ------------------------------------------------------------------ */
/*  LISTEN                                                             */
/* ------------------------------------------------------------------ */

function listen() {
  return new Promise((resolve, reject) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { reject("not_supported"); return; }
    setVoiceStatus("listening");
    const rec = new SR();
    rec.lang            = "en-IN";
    rec.interimResults  = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      const results = Array.from(e.results[0]).map(r => r.transcript.trim().toLowerCase());
      setVoiceStatus("idle");
      resolve(results);
    };
    rec.onerror = (e) => { setVoiceStatus("idle"); reject(e.error); };
    rec.onend   = ()  => { setVoiceStatus("idle"); };
    rec.start();
  });
}

/* ------------------------------------------------------------------ */
/*  MATCH SPOKEN TEXT TO LOCATION                                      */
/* ------------------------------------------------------------------ */

function matchLocation(transcripts) {
  for (const transcript of transcripts) {
    const cleaned = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    let best = null, bestScore = 0;
    for (const loc of allLocations) {
      const locName    = loc.name.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const locWords   = locName.split(" ");
      const spokenWords = cleaned.split(" ");
      const overlap    = locWords.filter(w => spokenWords.some(s => s.includes(w) || w.includes(s))).length;
      const score      = overlap / locWords.length;
      const contains   = cleaned.includes(locName) || locName.includes(cleaned);
      const finalScore = contains ? 1 : score;
      if (finalScore > bestScore) { bestScore = finalScore; best = loc; }
    }
    if (bestScore >= 0.4) return best;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  VOICE FLOW                                                         */
/* ------------------------------------------------------------------ */

async function runVoiceSetup() {
  setVoiceFlowVisible(true);
  voiceSetupDone = false;

  const startMatched = await askVoiceLocation("start");
  const destMatched  = await askVoiceLocation("dest");

  // Both matched via voice → auto-start immediately
  if (startMatched && destMatched) {
    voiceSetupDone = true;
    setVoicePrompt("✅ Both locations set. Starting navigation...");
    speak("Starting navigation now.", async () => {
      await delay(500);
      startNavigation();
    });
  }
}

async function askVoiceLocation(which) {
  const isStart  = which === "start";
  const question = isStart
    ? "Where are you currently? Please say your current location."
    : "Where do you want to go? Please say your destination.";
  const label = isStart ? "current location" : "destination";

  let matched  = null;
  let attempts = 0;

  while (!matched && attempts < 3) {
    attempts++;
    setVoicePrompt(question);
    speak(question);
    await delay(3200);   // wait for speech to finish

    try {
      const transcripts = await listen();
      setVoicePrompt('I heard: "' + transcripts[0] + '" — matching...');
      matched = matchLocation(transcripts);

      if (matched) {
        // Set the dropdown value using the sanitized ID
        const selId = isStart ? "start-select" : "dest-select";
        const sel   = document.getElementById(selId);
        sel.value   = matched.id;

        // Highlight the dropdown
        sel.classList.add("voice-set");

        const confirm = "Got it. " + (isStart ? "Your current location is " : "Your destination is ") + matched.name + ".";
        setVoicePrompt("✅ " + (isStart ? "Start" : "Destination") + ": " + matched.name);
        speak(confirm);
        checkStartReady();
        await delay(2800);

      } else {
        const retry = attempts < 3
          ? "Sorry, I could not find that location. Please try again and say the " + label + " clearly."
          : "Sorry, I could not understand. Please select the " + label + " from the dropdown below.";
        setVoicePrompt("❓ Couldn't match. " + (attempts < 3 ? "Retrying..." : "Use dropdown."));
        speak(retry);
        await delay(3000);
      }
    } catch (err) {
      if (err === "not_supported") {
        setVoicePrompt("Voice input not supported. Please use the dropdowns.");
        speak("Voice input is not supported on this browser. Please use the dropdown menus.");
        return null;
      }
      setVoicePrompt("Microphone error. Please use the dropdown.");
      return null;
    }
  }

  checkStartReady();
  return matched;
}

/* ------------------------------------------------------------------ */
/*  AUTO-START LOGIC                                                   */
/* ------------------------------------------------------------------ */

function maybeAutoStart(fromVoice) {
  const s = document.getElementById("start-select").value;
  const d = document.getElementById("dest-select").value;
  if (!s || !d || s === d) return;

  if (fromVoice) {
    // Voice already handles its own auto-start in runVoiceSetup
    return;
  }

  // Both dropdowns manually selected → auto-start
  startNavigation();
}

/* ------------------------------------------------------------------ */
/*  UI HELPERS                                                         */
/* ------------------------------------------------------------------ */

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function setVoiceStatus(state) {
  const btn = document.getElementById("voice-input-btn");
  const mic = document.getElementById("mic-icon");
  if (state === "listening") {
    btn.classList.add("listening");
    mic.innerText = "🔴";
    document.getElementById("voice-prompt").innerText = "Listening...";
  } else {
    btn.classList.remove("listening");
    mic.innerText = "🎙️";
  }
}

function setVoicePrompt(msg) {
  document.getElementById("voice-prompt").innerText = msg;
}

function setVoiceFlowVisible(show) {
  document.getElementById("voice-flow").style.display = show ? "block" : "none";
}

function setGpsStatus(state, msg) {
  document.getElementById("gps-dot").className = "gps-dot " + state;
  document.getElementById("gps-text").innerText = msg;
}

function checkStartReady() {
  const s = document.getElementById("start-select").value;
  const d = document.getElementById("dest-select").value;
  const ok = s && d && s !== d;
  document.getElementById("start-btn").disabled = !ok;
}

/* ------------------------------------------------------------------ */
/*  LOAD LOCATIONS — sanitize IDs to prevent invalid location errors  */
/* ------------------------------------------------------------------ */

async function loadLocations() {
  try {
    const res = await fetch("/locations");
    const raw = await res.json();

    // Strip any stray whitespace or \r characters from IDs and names
    allLocations = raw.map(loc => ({
      id:   loc.id.trim().replace(/\r/g, ""),
      name: loc.name.trim().replace(/\r/g, "")
    }));

    const startSel = document.getElementById("start-select");
    const destSel  = document.getElementById("dest-select");

    allLocations.forEach(loc => {
      startSel.appendChild(new Option(loc.name, loc.id));
      destSel.appendChild(new Option(loc.name, loc.id));
    });

    // Dropdown manual change
    [startSel, destSel].forEach(sel => {
      sel.addEventListener("change", () => {
        checkStartReady();
        // Auto-start only when BOTH are chosen manually
        const s = startSel.value;
        const d = destSel.value;
        if (s && d && s !== d) {
          startNavigation();
        }
      });
    });

  } catch (e) {
    setGpsStatus("error", "Could not load campus data.");
  }
}

/* ------------------------------------------------------------------ */
/*  PAGE LOAD                                                          */
/* ------------------------------------------------------------------ */

window.onload = async function () {
  if (!navigator.geolocation) {
    setGpsStatus("error", "Geolocation not supported on this device.");
    return;
  }
  setGpsStatus("waiting", "Waiting for GPS...");
  await loadLocations();
  await delay(600);
  speak("Welcome to Campus Navigator. Press the microphone button to use voice, or select your locations from the dropdowns.");
};

/* ------------------------------------------------------------------ */
/*  START NAVIGATION                                                   */
/* ------------------------------------------------------------------ */

async function startNavigation() {
  const start = document.getElementById("start-select").value.trim();
  const dest  = document.getElementById("dest-select").value.trim();
  destName    = document.getElementById("dest-select").selectedOptions[0].text.trim();

  if (!start || !dest || start === dest) return;

  document.getElementById("start-btn").disabled = true;
  setGpsStatus("waiting", "Starting navigation...");

  try {
    const res  = await fetch("/start_navigation", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ start, destination: dest })
    });
    const data = await res.json();

    if (data.error) {
      setGpsStatus("error", "Error: " + data.error);
      speak("Error: " + data.error);
      document.getElementById("start-btn").disabled = false;
      return;
    }

    session_id  = data.session_id;
    totalSteps  = data.route.length - 1;
    currentStep = 0;

    document.getElementById("setup-card").style.display      = "none";
    document.getElementById("nav-card").style.display        = "block";
    document.getElementById("instruction-box").style.display = "block";
    document.getElementById("stop-btn").style.display        = "block";

    updateProgress(0);
    speak("Navigation started. Heading to " + destName + ". Acquiring GPS signal.");
    setGpsStatus("waiting", "Acquiring GPS signal...");

    watchId = navigator.geolocation.watchPosition(
      sendLocation,
      gpsError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );

  } catch (e) {
    setGpsStatus("error", "Server connection failed.");
    speak("Could not connect to server. Please try again.");
    document.getElementById("start-btn").disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/*  SEND GPS TO SERVER                                                 */
/* ------------------------------------------------------------------ */

let lastInstruction = "";

async function sendLocation(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  setGpsStatus("active", "GPS active · Tracking...");

  try {
    const res  = await fetch("/update_location", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ session_id, lat, lng })
    });
    const data = await res.json();

    if (data.error) { setGpsStatus("error", "Session error."); return; }
    if (data.instruction === "Navigation complete.") { showArrived(); return; }

    const instruction = data.instruction;
    const distance    = Math.round(data.distance);
    const step        = data.step ?? currentStep;

    if (instruction !== lastInstruction) {
      speak(instruction);
      lastInstruction = instruction;
    }

    if (distance <= 15 && distance > 5) {
      const msg = "Approaching in " + distance + " meters.";
      if (lastInstruction !== msg) { speak(msg); lastInstruction = msg; }
    }

    document.getElementById("instruction-text").innerText = instruction;
    document.getElementById("distance-text").innerText    = distance + " m";
    document.getElementById("step-badge").innerText       = "STEP " + (step + 1);
    currentStep = step;
    updateProgress(step);

  } catch (e) {
    setGpsStatus("error", "Connection lost. Retrying...");
  }
}

/* ------------------------------------------------------------------ */
/*  PROGRESS                                                           */
/* ------------------------------------------------------------------ */

function updateProgress(step) {
  const pct = totalSteps > 0 ? Math.round((step / totalSteps) * 100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("step-counter").innerText    = step + " / " + totalSteps + " steps";
}

/* ------------------------------------------------------------------ */
/*  ARRIVED                                                            */
/* ------------------------------------------------------------------ */

function showArrived() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  document.getElementById("instruction-box").style.display = "none";
  document.getElementById("arrived-box").style.display     = "block";
  document.getElementById("arrived-name").innerText        = "You have reached " + destName;
  document.getElementById("stop-btn").style.display        = "none";
  document.getElementById("progress-fill").style.width     = "100%";
  setGpsStatus("active", "Arrived at destination.");
  speak("You have arrived at " + destName + ". Navigation complete.");
}

/* ------------------------------------------------------------------ */
/*  STOP NAVIGATION                                                    */
/* ------------------------------------------------------------------ */

function stopNavigation() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  session_id      = null;
  lastInstruction = "";
  voiceSetupDone  = false;
  document.getElementById("nav-card").style.display        = "none";
  document.getElementById("setup-card").style.display      = "block";
  document.getElementById("arrived-box").style.display     = "none";
  document.getElementById("instruction-box").style.display = "block";
  document.getElementById("start-btn").disabled            = true;
  document.getElementById("start-select").value            = "";
  document.getElementById("dest-select").value             = "";
  document.getElementById("start-select").classList.remove("voice-set");
  document.getElementById("dest-select").classList.remove("voice-set");
  setVoiceFlowVisible(false);
  setGpsStatus("waiting", "Navigation stopped.");
  speak("Navigation stopped.");
}

/* ------------------------------------------------------------------ */
/*  GPS ERROR                                                          */
/* ------------------------------------------------------------------ */

function gpsError(error) {
  const msgs = {
    1: "Location permission denied. Please allow it in browser settings.",
    2: "GPS signal unavailable. Move to an open area.",
    3: "GPS timed out. Move outdoors and try again."
  };
  const msg = msgs[error.code] || "Unknown GPS error.";
  setGpsStatus("error", msg);
  speak(msg);
}
