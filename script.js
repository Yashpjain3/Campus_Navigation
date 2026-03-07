/* ============================================================
   Campus Navigator — script.js
   Multi-user | GPS current location | Dynamic directions
   ============================================================ */

let session_id      = null;
let watchId         = null;
let totalSteps      = 0;
let currentStep     = 0;
let destName        = "";
let allLocations    = [];
let lastInstruction  = "";
let lastSpokenDist   = -1;    // last distance we announced
let lastSpokenStep   = -1;    // last step we announced
let spokenMilestones = new Set(); // distance milestones already announced

// Heading tracking (for dynamic directions)
let lastLat     = null;
let lastLng     = null;
let userHeading = -1;   // -1 = unknown

/* ------------------------------------------------------------------ */
/*  SPEAK                                                              */
/* ------------------------------------------------------------------ */

function speak(text, onEnd) {
  if (!window.speechSynthesis) { if (onEnd) onEnd(); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang  = "en-IN";
  utt.rate  = 0.93;
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
    rec.lang = "en-IN";
    rec.interimResults  = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      setVoiceStatus("idle");
      resolve(Array.from(e.results[0]).map(r => r.transcript.trim().toLowerCase()));
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
  for (const transcript of transcripts) {
    const cleaned = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    let best = null, bestScore = 0;
    for (const loc of allLocations) {
      const locName    = loc.name.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const locWords   = locName.split(" ");
      const spoken     = cleaned.split(" ");
      const overlap    = locWords.filter(w => spoken.some(s => s.includes(w) || w.includes(s))).length;
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
/*  HEADING CALCULATION (from consecutive GPS positions)              */
/* ------------------------------------------------------------------ */

function computeHeading(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLng  = toRad(lng2 - lng1);
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);
  const x = Math.sin(dLng) * Math.cos(lat2r);
  const y = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

/* ------------------------------------------------------------------ */
/*  USE CURRENT GPS LOCATION  (button onclick handler)               */
/* ------------------------------------------------------------------ */

function useCurrentLocation() {
  useCurrentLocationAsync();
}

/* ------------------------------------------------------------------ */
/*  VOICE FLOW                                                         */
/* ------------------------------------------------------------------ */

async function runVoiceSetup() {
  setVoiceFlowVisible(true);
  const startMatched = await askVoiceLocation("start");
  const destMatched  = await askVoiceLocation("dest");

  if (startMatched && destMatched) {
    setVoicePrompt("✅ Both locations set. Starting navigation...");
    speak("Starting navigation now.", async () => {
      await delay(400);
      startNavigation();
    });
  }
}

async function askVoiceLocation(which) {
  const isStart = which === "start";
  const label   = isStart ? "current location" : "destination";

  // ── For start location: first ask GPS vs manual ──────────────────
  if (isStart) {
    const gpsQuestion = "Select your starting point. Shall I use your current location? Say yes to use GPS, or say the name of your starting location.";
    setVoicePrompt(gpsQuestion);
    speak(gpsQuestion);
    await delay(3800);

    try {
      const transcripts = await listen();
      setVoicePrompt('Heard: "' + transcripts[0] + '"');

      const isYes = transcripts.some(t =>
        t.includes("yes") || t.includes("yeah") || t.includes("sure") ||
        t.includes("ok") || t.includes("current") || t.includes("my location") ||
        t.includes("here") || t.includes("use gps") || t.includes("use my")
      );

      if (isYes) {
        setVoicePrompt("📡 Using your GPS location...");
        speak("Sure, using your current GPS location.");
        await useCurrentLocationAsync();   // await GPS result
        checkStartReady();
        return { fromGPS: true };
      }

      // They said a location name directly — try to match
      const direct = matchLocation(transcripts);
      if (direct) {
        document.getElementById("start-select").value = direct.id;
        document.getElementById("start-select").classList.add("voice-set");
        setVoicePrompt("✅ Start: " + direct.name);
        speak("Got it. Your starting location is " + direct.name + ".");
        checkStartReady();
        await delay(2600);
        return direct;
      }

      // Couldn't match — fall through to retry loop below
      setVoicePrompt("❓ Could not match. Let me ask again...");
      speak("Sorry, I could not find that location. Let me ask again.");
      await delay(2500);

    } catch (err) {
      if (err === "not_supported") {
        setVoicePrompt("Voice not supported. Please use dropdowns.");
        speak("Voice input is not supported. Please use the dropdown menus.");
        return null;
      }
    }
  }

  // ── General retry loop (for destination, or if start failed above) ─
  const question = isStart
    ? "Please say your starting location clearly."
    : "Where do you want to go? Please say your destination.";

  let matched  = null;
  let attempts = 0;

  while (!matched && attempts < 3) {
    attempts++;
    setVoicePrompt(question);
    speak(question);
    await delay(3200);

    try {
      const transcripts = await listen();
      setVoicePrompt('Heard: "' + transcripts[0] + '" — matching...');
      matched = matchLocation(transcripts);

      if (matched) {
        const selId = isStart ? "start-select" : "dest-select";
        document.getElementById(selId).value = matched.id;
        document.getElementById(selId).classList.add("voice-set");
        setVoicePrompt("✅ " + (isStart ? "Start" : "Destination") + ": " + matched.name);
        speak("Got it. " + (isStart ? "Starting location is " : "Destination is ") + matched.name + ".");
        checkStartReady();
        await delay(2600);

      } else {
        const retry = attempts < 3
          ? "Sorry, I could not find that. Please try again."
          : "I could not understand. Please select from the dropdown below.";
        setVoicePrompt("❓ Could not match. " + (attempts < 3 ? "Retrying..." : "Use dropdown."));
        speak(retry);
        await delay(3000);
      }
    } catch (err) {
      if (err === "not_supported") {
        setVoicePrompt("Voice not supported. Please use dropdowns.");
        speak("Voice input is not supported. Please use the dropdown menus.");
        return null;
      }
      setVoicePrompt("Mic error. Please use the dropdown.");
      return null;
    }
  }

  checkStartReady();
  return matched;
}

/* ------------------------------------------------------------------ */
/*  GPS LOCATE — async version (returns Promise)                      */
/* ------------------------------------------------------------------ */

function useCurrentLocationAsync() {
  return new Promise((resolve) => {
    const btn = document.getElementById("gps-locate-btn");
    btn.disabled  = true;
    btn.innerText = "📡 Locating...";
    setGpsStatus("waiting", "Getting your current position...");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res  = await fetch("/nearest_location", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          });
          const data = await res.json();

          if (data.error) {
            setGpsStatus("error", data.error);
            speak(data.error);
            btn.disabled  = false;
            btn.innerText = "📍 Use My Current Location";
            resolve(null);
            return;
          }

          document.getElementById("start-select").value = data.location_id;
          document.getElementById("start-select").classList.add("voice-set");
          setVoicePrompt("📍 " + data.name + " (" + Math.round(data.distance_m) + "m away)");
          setGpsStatus("active", "Location found: " + data.name);
          speak("Your current location is " + data.name + ".");
          btn.disabled  = false;
          btn.innerText = "✅ " + data.name;
          checkStartReady();
          resolve(data);

        } catch (e) {
          setGpsStatus("error", "Could not reach server.");
          btn.disabled  = false;
          btn.innerText = "📍 Use My Current Location";
          resolve(null);
        }
      },
      () => {
        setGpsStatus("error", "GPS permission denied.");
        speak("Could not get your location. Please allow GPS permission.");
        btn.disabled  = false;
        btn.innerText = "📍 Use My Current Location";
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
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
  const el = document.getElementById("voice-prompt");
  if (el) el.innerText = msg;
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
  document.getElementById("start-btn").disabled = !(s && d && s !== d);
}

function toggleVoiceFlow() {
  const vf      = document.getElementById("voice-flow");
  const showing = vf.style.display === "block";
  vf.style.display = showing ? "none" : "block";
  if (!showing) setVoicePrompt("Press the microphone and speak your location.");
}

/* ------------------------------------------------------------------ */
/*  LOAD LOCATIONS                                                     */
/* ------------------------------------------------------------------ */

async function loadLocations() {
  try {
    const res = await fetch("/locations");
    const raw = await res.json();
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

    // Auto-start when both dropdowns are manually set
    [startSel, destSel].forEach(sel => {
      sel.addEventListener("change", () => {
        checkStartReady();
        const s = startSel.value;
        const d = destSel.value;
        if (s && d && s !== d) startNavigation();
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
  setGpsStatus("waiting", "Ready.");
  await loadLocations();
  await delay(600);
  speak("Welcome to Campus Navigator. You can use the microphone for voice input, tap Use My Location for GPS, or select from the dropdowns.");
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
    totalSteps  = data.total_steps;
    currentStep = 0;
    lastLat     = null;
    lastLng     = null;
    userHeading = -1;

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

async function sendLocation(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;

  // Update heading from movement
  if (lastLat !== null && lastLng !== null) {
    const dist = Math.sqrt(
      Math.pow((lat - lastLat) * 111000, 2) +
      Math.pow((lng - lastLng) * 111000 * Math.cos(lat * Math.PI / 180), 2)
    );
    // Only update heading if moved more than 3 meters (avoid GPS noise)
    if (dist > 3) {
      userHeading = computeHeading(lastLat, lastLng, lat, lng);
    }
  }
  lastLat = lat;
  lastLng = lng;

  setGpsStatus("active", "GPS active · Tracking" + (userHeading >= 0 ? " · Heading " + Math.round(userHeading) + "°" : ""));

  try {
    const res  = await fetch("/update_location", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ session_id, lat, lng, heading: userHeading })
    });
    const data = await res.json();

    if (data.error) { setGpsStatus("error", "Session error."); return; }
    if (data.instruction === "Navigation complete.") { showArrived(); return; }

    const instruction = data.instruction;
    const distance    = Math.round(data.distance);
    const step        = data.step ?? currentStep;

    // ── Speak step instruction ONLY when step changes ─────────────────
    if (step !== lastSpokenStep) {
      speak(instruction);
      lastInstruction  = instruction;
      lastSpokenStep   = step;
      lastSpokenDist   = distance;
      spokenMilestones = new Set();   // reset milestones for new step
    }

    // ── Speak distance milestones: 80m, 50m, 30m, 15m only once each ─
    const milestones = [80, 50, 30, 15];
    for (const m of milestones) {
      if (distance <= m && !spokenMilestones.has(m)) {
        spokenMilestones.add(m);
        // Only speak if distance drop is real (>3m from last spoken)
        if (Math.abs(distance - lastSpokenDist) > 3) {
          speak("In " + distance + " meters, " + instruction.toLowerCase());
          lastSpokenDist = distance;
        }
        break;
      }
    }

    // ── Update display (always, no noise) ────────────────────────────
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
  session_id = null; lastInstruction = ""; userHeading = -1; lastLat = null; lastLng = null;
  document.getElementById("nav-card").style.display        = "none";
  document.getElementById("setup-card").style.display      = "block";
  document.getElementById("arrived-box").style.display     = "none";
  document.getElementById("instruction-box").style.display = "block";
  document.getElementById("start-btn").disabled            = true;
  document.getElementById("start-select").value            = "";
  document.getElementById("dest-select").value             = "";
  document.getElementById("start-select").classList.remove("voice-set");
  document.getElementById("dest-select").classList.remove("voice-set");
  document.getElementById("gps-locate-btn").innerText      = "📍 Use My Current Location";
  document.getElementById("gps-locate-btn").disabled       = false;
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
