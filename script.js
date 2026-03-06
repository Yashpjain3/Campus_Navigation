/* ============================================================
   Campus Navigator — script.js
   Voice assistant + dropdown fallback for visually impaired
   ============================================================ */

let session_id  = null;
let watchId     = null;
let totalSteps  = 0;
let currentStep = 0;
let destName    = "";
let allLocations = [];   // [{id, name}] loaded from server

/* ------------------------------------------------------------------ */
/*  SPEAK  (text-to-speech)                                           */
/* ------------------------------------------------------------------ */

function speak(text, onEnd) {
  if (!window.speechSynthesis) {
    if (onEnd) onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(text);
  utt.lang   = "en-IN";
  utt.rate   = 0.92;
  utt.pitch  = 1.0;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

/* ------------------------------------------------------------------ */
/*  LISTEN  (speech-to-text, returns Promise<string>)                 */
/* ------------------------------------------------------------------ */

function listen() {
  return new Promise((resolve, reject) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { reject("not_supported"); return; }

    setVoiceStatus("listening");
    const rec          = new SR();
    rec.lang           = "en-IN";
    rec.interimResults = false;
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
/*  MATCH SPOKEN TEXT TO LOCATION                                     */
/* ------------------------------------------------------------------ */

function matchLocation(transcripts) {
  // transcripts = array of alternatives from speech recognition
  for (const transcript of transcripts) {
    const cleaned = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    let best = null, bestScore = 0;

    for (const loc of allLocations) {
      const locName = loc.name.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      // Word overlap scoring
      const locWords     = locName.split(" ");
      const spokenWords  = cleaned.split(" ");
      const overlap      = locWords.filter(w => spokenWords.some(s => s.includes(w) || w.includes(s))).length;
      const score        = overlap / locWords.length;

      // Also check if the full name is contained
      const contains     = cleaned.includes(locName) || locName.includes(cleaned);

      const finalScore   = contains ? 1 : score;
      if (finalScore > bestScore) { bestScore = finalScore; best = loc; }
    }

    if (bestScore >= 0.4) return best;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  VOICE FLOW — Ask current location then destination                */
/* ------------------------------------------------------------------ */

async function runVoiceSetup() {
  setVoiceFlowVisible(true);

  // Step 1: Ask for current location
  await askVoiceLocation("start");

  // Step 2: Ask for destination
  await askVoiceLocation("dest");
}

async function askVoiceLocation(which) {
  const isStart  = which === "start";
  const question = isStart
    ? "Where are you currently? Please say your current location."
    : "Where do you want to go? Please say your destination.";
  const label    = isStart ? "current location" : "destination";

  let matched = null;
  let attempts = 0;

  while (!matched && attempts < 3) {
    attempts++;
    setVoicePrompt(question);
    speak(question, async () => {
      // tiny delay after speech ends before listening
    });

    // Wait for speech to finish before listening
    await delay(isStart ? 3000 : 3000);

    try {
      const transcripts = await listen();
      setVoicePrompt("I heard: \"" + transcripts[0] + "\" — matching...");
      matched = matchLocation(transcripts);

      if (matched) {
        // Set dropdown
        const selId = isStart ? "start-select" : "dest-select";
        document.getElementById(selId).value = matched.id;
        document.getElementById(selId).dispatchEvent(new Event("change"));

        const confirm = "Got it. " + (isStart ? "Your current location is " : "Your destination is ") + matched.name + ".";
        setVoicePrompt("✅ " + (isStart ? "Start" : "Destination") + ": " + matched.name);
        speak(confirm);
        await delay(2500);

      } else {
        const retry = attempts < 3
          ? "Sorry, I couldn't find that location. Please try again and say the " + label + " clearly."
          : "Sorry, I couldn't understand. Please select the " + label + " from the dropdown.";
        setVoicePrompt("❓ Couldn't match. " + (attempts < 3 ? "Retrying..." : "Use dropdown."));
        speak(retry);
        await delay(3000);
      }
    } catch (err) {
      if (err === "not_supported") {
        setVoicePrompt("Voice input not supported. Please use the dropdowns.");
        speak("Voice input is not supported on this browser. Please use the dropdown menus.");
        break;
      }
      setVoicePrompt("Microphone error. Please use the dropdown.");
      break;
    }
  }

  // After voice flow, check if both are set to enable button
  checkStartReady();
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
  const dot  = document.getElementById("gps-dot");
  const text = document.getElementById("gps-text");
  dot.className  = "gps-dot " + state;
  text.innerText = msg;
}

function checkStartReady() {
  const s = document.getElementById("start-select").value;
  const d = document.getElementById("dest-select").value;
  document.getElementById("start-btn").disabled = !(s && d && s !== d);
}

/* ------------------------------------------------------------------ */
/*  LOAD LOCATIONS FROM SERVER                                         */
/* ------------------------------------------------------------------ */

async function loadLocations() {
  try {
    const res  = await fetch("/locations");
    allLocations = await res.json();   // [{id, name}]

    const startSel = document.getElementById("start-select");
    const destSel  = document.getElementById("dest-select");

    allLocations.forEach(loc => {
      startSel.appendChild(new Option(loc.name, loc.id));
      destSel.appendChild(new Option(loc.name, loc.id));
    });

    [startSel, destSel].forEach(sel => sel.addEventListener("change", checkStartReady));

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

  // Greet and start voice flow automatically
  await delay(800);
  speak(
    "Welcome to Campus Navigator. I will help you navigate the campus. " +
    "Press the microphone button or use the dropdowns to set your locations.",
    null
  );
};

/* ------------------------------------------------------------------ */
/*  START NAVIGATION                                                   */
/* ------------------------------------------------------------------ */

async function startNavigation() {
  const start  = document.getElementById("start-select").value;
  const dest   = document.getElementById("dest-select").value;
  destName     = document.getElementById("dest-select").selectedOptions[0].text;

  if (!start || !dest) return;

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

    // Speak only when instruction changes
    if (instruction !== lastInstruction) {
      speak(instruction);
      lastInstruction = instruction;
    }

    // Approaching notification
    if (distance <= 15 && distance > 5) {
      const approaching = "Approaching next point in " + distance + " meters.";
      if (lastInstruction !== approaching) {
        speak(approaching);
        lastInstruction = approaching;
      }
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
  document.getElementById("nav-card").style.display        = "none";
  document.getElementById("setup-card").style.display      = "block";
  document.getElementById("arrived-box").style.display     = "none";
  document.getElementById("instruction-box").style.display = "block";
  document.getElementById("start-btn").disabled            = true;
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
