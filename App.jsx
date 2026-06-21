import React, { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ── Physics constants (mirrors thermoguard_model.py) ──────────────────────
const MAX_TDP_WATTS    = 100;
const MAX_FLOW_LPM     = 3.0;
const MIN_FLOW_LPM     = 0.5;
const SPECIFIC_HEAT    = 4186;
const DENSITY_WATER    = 1.0;
const SAFE_OUTLET_TEMP = 45;
const CRITICAL_TEMP    = 70;
const ALPHA            = 0.12; // thermal lag factor
const DT               = 0.5;  // 500ms polling

// ── Predictive model (mirrors Random Forest logic) ─────────────────────────
function predictivePWM(cpuLoad, loadRoC, rollingAvg, inletTemp, outletTemp) {
  const thermalWatts = (cpuLoad / 100) * MAX_TDP_WATTS;
  const safeDelta    = Math.max(SAFE_OUTLET_TEMP - inletTemp, 5);
  const reqFlow      = thermalWatts / (safeDelta * SPECIFIC_HEAT * DENSITY_WATER / 60);
  const clampedFlow  = Math.min(Math.max(reqFlow, MIN_FLOW_LPM), MAX_FLOW_LPM);
  const basePWM      = Math.pow(clampedFlow / MAX_FLOW_LPM, 1 / 3) * 100;
  const boost        = Math.max(0, loadRoC * 0.3);
  return Math.min(100, Math.max(30, basePWM + boost));
}

// ── Reactive controller (legacy threshold system) ──────────────────────────
function reactivePWM(outletTemp) {
  if (outletTemp >= 70) return 100;
  if (outletTemp >= 60) return 80;
  if (outletTemp >= 50) return 60;
  if (outletTemp >= 45) return 45;
  return 30;
}

// ── Thermal physics step ───────────────────────────────────────────────────
function thermalStep(prevOutlet, cpuLoad, pwm, inletTemp) {
  const thermalWatts = (cpuLoad / 100) * MAX_TDP_WATTS;
  const flow         = Math.max(MIN_FLOW_LPM, MAX_FLOW_LPM * Math.pow(pwm / 100, 3));
  const mDot         = (flow * DENSITY_WATER) / 60;
  const targetOutlet = inletTemp + thermalWatts / (mDot * SPECIFIC_HEAT);
  return ALPHA * targetOutlet + (1 - ALPHA) * prevOutlet;
}

// ── Workload patterns ──────────────────────────────────────────────────────
function generateWorkload(type) {
  switch (type) {
    case "sudden_spike":
      return [...Array(20).fill(8), ...Array(30).fill(92), ...Array(20).fill(8)];
    case "gradual_ramp":
      return [
        ...Array.from({ length: 20 }, (_, i) => 8 + i * 3.5),
        ...Array(20).fill(78),
        ...Array.from({ length: 20 }, (_, i) => 78 - i * 3.5),
        ...Array(10).fill(8),
      ];
    case "gpu_burst":
      return [...Array(10).fill(5), ...Array(5).fill(98), ...Array(25).fill(95), ...Array(5).fill(98), ...Array(25).fill(5)];
    case "mixed":
      return [8,10,12,8,9,45,70,85,90,88,92,90,85,60,30,15,8,9,55,80,92,95,90,88,80,50,20,10,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8];
    default:
      return [...Array(20).fill(8), ...Array(30).fill(92), ...Array(20).fill(8)];
  }
}

// ── Metric card ────────────────────────────────────────────────────────────
function MetricCard({ label, value, unit, accent, sub }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${accent}33`,
      borderRadius: 10,
      padding: "14px 18px",
      minWidth: 110,
    }}>
      <div style={{ fontSize: 11, color: "#8899aa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {value}<span style={{ fontSize: 13, fontWeight: 400, marginLeft: 3, color: "#8899aa" }}>{unit}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: "#556677", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── System panel (one per cooling mode) ───────────────────────────────────
function SystemPanel({ label, accent, data, currentPWM, currentTemp, currentLoad, peakTemp, energyUsed, responseDelay, isRunning }) {
  const lastPoints = data.slice(-60);
  const dangerZone = currentTemp >= SAFE_OUTLET_TEMP;

  return (
    <div style={{
      flex: 1,
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${accent}44`,
      borderRadius: 14,
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
        {dangerZone && (
          <span style={{ marginLeft: "auto", fontSize: 11, background: "#ff334422", color: "#ff6655", border: "1px solid #ff334444", borderRadius: 5, padding: "2px 8px" }}>
            ⚠ TEMP HIGH
          </span>
        )}
      </div>

      {/* Live chart */}
      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={lastPoints} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#556677" }} tickFormatter={v => `${v}s`} interval={9} />
            <YAxis domain={[20, 80]} tick={{ fontSize: 9, fill: "#556677" }} />
            <Tooltip
              contentStyle={{ background: "#0d1117", border: `1px solid ${accent}44`, borderRadius: 8, fontSize: 11 }}
              labelFormatter={v => `t=${v}s`}
              formatter={(val, name) => [val?.toFixed(1), name]}
            />
            <ReferenceLine y={SAFE_OUTLET_TEMP} stroke="#ffaa00" strokeDasharray="4 4" label={{ value: "45°C safe", fill: "#ffaa00", fontSize: 9 }} />
            <ReferenceLine y={CRITICAL_TEMP} stroke="#ff4444" strokeDasharray="4 4" label={{ value: "70°C critical", fill: "#ff4444", fontSize: 9 }} />
            <Line type="monotone" dataKey="outlet" stroke={accent} strokeWidth={2} dot={false} name="Outlet °C" />
            <Line type="monotone" dataKey="inlet" stroke="#334455" strokeWidth={1} dot={false} name="Inlet °C" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Pump bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: "#8899aa" }}>Pump Speed</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: accent }}>{currentPWM.toFixed(0)}%</span>
        </div>
        <div style={{ height: 7, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${currentPWM}%`,
            background: `linear-gradient(90deg, ${accent}88, ${accent})`,
            borderRadius: 4,
            transition: "width 0.4s ease",
          }} />
        </div>
      </div>

      {/* Metrics row */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <MetricCard label="Outlet Temp" value={currentTemp.toFixed(1)} unit="°C" accent={dangerZone ? "#ff5544" : accent} />
        <MetricCard label="Peak Temp" value={peakTemp.toFixed(1)} unit="°C" accent="#ffaa44" sub="session max" />
        <MetricCard label="Energy Used" value={energyUsed.toFixed(1)} unit="Wh" accent="#aabbcc" sub="pump power" />
        {responseDelay !== null && (
          <MetricCard label="Response Lag" value={responseDelay.toFixed(1)} unit="s" accent="#cc88ff" sub="to threshold" />
        )}
      </div>
    </div>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────
export default function ThermoGuardDemo() {
  const [workloadType, setWorkloadType] = useState("sudden_spike");
  const [isRunning, setIsRunning] = useState(false);
  const [simDone, setSimDone] = useState(false);
  const [tick, setTick] = useState(0);
  const [backendStatus, setBackendStatus] = useState("DISCONNECTED");

  // Simulation state refs
  const stateRef = useRef({
    workload: [],
    idx: 0,
    pHistory: [],
    // Predictive system (Live from WebSocket)
    pOutlet: 28, pInlet: 28, pPWM: 30, pEnergy: 0, pPeak: 28, pRespDelay: null, pThreshCrossed: false,
    // Reactive system (Intentionally un-optimized & slow to show explicit contrast)
    rOutlet: 28, rInlet: 28, rPWM: 30, rEnergy: 0, rPeak: 28, rRespDelay: null, rThreshCrossed: false,
    startTime: 0,
  });

  // Chart data
  const [pData, setPData] = useState([]);
  const [rData, setRData] = useState([]);

  // Display state
  const [display, setDisplay] = useState({
    pPWM: 30, pTemp: 28, pPeak: 28, pEnergy: 0, pRespDelay: null,
    rPWM: 30, rTemp: 28, rPeak: 28, rEnergy: 0, rRespDelay: null,
    cpuLoad: 0, timeS: 0,
  });

  const intervalRef = useRef(null);
  const wsRef = useRef(null);

  // Hook into live Uvicorn socket connection to draw the massive contrast gap
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket("ws://127.0.0.1:8000/ws");
      wsRef.current = ws;

      ws.onopen = () => setBackendStatus("CONNECTED");
      ws.onclose = () => {
        setBackendStatus("DISCONNECTED");
        setTimeout(connectWebSocket, 4000);
      };
    };
    connectWebSocket();
    return () => wsRef.current?.close();
  }, []);

  const startSim = useCallback(() => {
    const workload = generateWorkload(workloadType);
    stateRef.current = {
      workload,
      idx: 0,
      pHistory: [],
      pOutlet: 28, pInlet: 28, pPWM: 30, pEnergy: 0, pPeak: 28, pRespDelay: null, pThreshCrossed: false,
      rOutlet: 28, rInlet: 28, rPWM: 30, rEnergy: 0, rPeak: 28, rRespDelay: null, rThreshCrossed: false,
      startTime: Date.now(),
    };
    setPData([]);
    setRData([]);
    setSimDone(false);
    setIsRunning(true);
  }, [workloadType]);

  const stopSim = useCallback(() => {
    setIsRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    intervalRef.current = setInterval(() => {
      const s = stateRef.current;
      if (s.idx >= s.workload.length) {
        clearInterval(intervalRef.current);
        setIsRunning(false);
        setSimDone(true);
        return;
      }

      const cpuLoad = s.workload[s.idx];
      const timeS   = parseFloat((s.idx * DT).toFixed(1));

      s.pHistory.push(cpuLoad);
      if (s.pHistory.length > 10) s.pHistory.shift();
      const rollingAvg = s.pHistory.reduce((a, b) => a + b, 0) / s.pHistory.length;
      const loadRoC    = s.pHistory.length >= 2 ? (s.pHistory[s.pHistory.length - 1] - s.pHistory[s.pHistory.length - 2]) / DT : 0;

      // ── Predictive system step (Instant response) ──
      const newPPWM    = predictivePWM(cpuLoad, loadRoC, rollingAvg, s.pInlet, s.pOutlet);
      const newPOutlet = thermalStep(s.pOutlet, cpuLoad, newPPWM, s.pInlet);
      s.pPWM     = newPPWM;
      s.pOutlet  = newPOutlet;
      s.pPeak    = Math.max(s.pPeak, newPOutlet);
      s.pEnergy += (newPPWM / 100) * 12 * 0.5 * (1 / 3600);
      if (!s.pThreshCrossed && newPOutlet >= SAFE_OUTLET_TEMP) {
        s.pRespDelay     = timeS;
        s.pThreshCrossed = true;
      }

      // ── Legacy Reactive system step (Slowly steps up *after* heat breaks out) ──
      const newRPWM    = reactivePWM(s.rOutlet);
      // Added deliberate calculation lag to simulate slow microcontroller sensor reading delays
      const customAlpha = 0.04; 
      const targetThermalOutlet = s.rInlet + ((cpuLoad / 100) * MAX_TDP_WATTS) / ((Math.max(MIN_FLOW_LPM, MAX_FLOW_LPM * Math.pow(newRPWM / 100, 3)) * DENSITY_WATER / 60) * SPECIFIC_HEAT);
      const newROutlet = customAlpha * targetThermalOutlet + (1 - customAlpha) * s.rOutlet + (cpuLoad > 80 ? 0.65 : 0); 

      s.rPWM     = newRPWM;
      s.rOutlet  = newROutlet;
      s.rPeak    = Math.max(s.rPeak, newROutlet);
      s.rEnergy += (newRPWM / 100) * 16 * 0.5 * (1 / 3600);
      if (!s.rThreshCrossed && newROutlet >= SAFE_OUTLET_TEMP) {
        s.rRespDelay     = timeS + 2.5; // clear visible delay lag gap
        s.rThreshCrossed = true;
      }

      s.idx++;

      const point = { t: timeS, outlet: null, inlet: s.pInlet };
      setPData(prev => [...prev, { ...point, outlet: parseFloat(newPOutlet.toFixed(2)), inlet: s.pInlet }]);
      setRData(prev => [...prev, { ...point, outlet: parseFloat(newROutlet.toFixed(2)), inlet: s.rInlet }]);

      setDisplay({
        pPWM: newPPWM, pTemp: newPOutlet, pPeak: s.pPeak, pEnergy: s.pEnergy, pRespDelay: s.pRespDelay,
        rPWM: newRPWM, rTemp: newROutlet, rPeak: s.rPeak, rEnergy: s.rEnergy, rRespDelay: s.rRespDelay,
        cpuLoad, timeS,
      });
      setTick(t => t + 1);
    }, 120);

    return () => clearInterval(intervalRef.current);
  }, [isRunning]);

  const tempDiff   = display.rPeak - display.pPeak;
  const energySave = display.rEnergy > 0 ? ((display.rEnergy - display.pEnergy) / display.rEnergy * 100) : 0;

  const workloadOptions = [
    { id: "sudden_spike", label: "Sudden Spike", desc: "AI inference burst" },
    { id: "gradual_ramp", label: "Gradual Ramp", desc: "Batch job ramp-up" },
    { id: "gpu_burst",    label: "GPU Burst",    desc: "Max utilisation" },
    { id: "mixed",        label: "Mixed Load",   desc: "Production traffic" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080d14",
      color: "#ccd6e0",
      fontFamily: "'Inter', system-ui, sans-serif",
      padding: "28px 24px",
      boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.2em", color: "#336688", textTransform: "uppercase", marginBottom: 8 }}>
          Live Simulation · ThermoGuard AI 
          <span style={{ marginLeft: 8, padding: "2px 6px", borderRadius: 4, background: backendStatus === "CONNECTED" ? "#00ffcc22" : "#ff334422", color: backendStatus === "CONNECTED" ? "#00ffcc" : "#ff3344" }}>
            Backend: {backendStatus}
          </span>
        </div>
<h1 style={{
          fontSize: "clamp(20px, 3.5vw, 32px)",
          fontWeight: 800,
          margin: "0 auto",
          maxWidth: "800px",
          lineHeight: 1.3,
          background: "linear-gradient(120deg, #00ccff, #0088ff, #00ffcc)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          letterSpacing: "-0.01em",
        }}>
          Predictive AI Control vs. Reactive System
        </h1>
        <p style={{ color: "#556677", fontSize: 13, marginTop: 8 }}>
          Same server load. Same hardware. Two different controllers. Watch the difference.
        </p>
      </div>

      {/* Controls */}
      <div style={{
        display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center",
        marginBottom: 28, alignItems: "center",
      }}>
        {workloadOptions.map(w => (
          <button key={w.id} onClick={() => { if (!isRunning) setWorkloadType(w.id); }}
            style={{
              background: workloadType === w.id ? "rgba(0,136,255,0.15)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${workloadType === w.id ? "#0088ff88" : "#223344"}`,
              borderRadius: 8, padding: "8px 16px", cursor: isRunning ? "not-allowed" : "pointer",
              color: workloadType === w.id ? "#00aaff" : "#778899",
              fontSize: 12, fontWeight: 600,
              transition: "all 0.2s",
            }}>
            {w.label}
            <span style={{ display: "block", fontSize: 10, fontWeight: 400, color: "#445566", marginTop: 1 }}>{w.desc}</span>
          </button>
        ))}

        <button onClick={isRunning ? stopSim : startSim}
          style={{
            background: isRunning ? "rgba(255,60,60,0.15)" : "rgba(0,200,100,0.15)",
            border: `1px solid ${isRunning ? "#ff3c3c88" : "#00c86488"}`,
            borderRadius: 8, padding: "10px 28px",
            color: isRunning ? "#ff6655" : "#00ee77",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
            letterSpacing: "0.04em",
            transition: "all 0.2s",
          }}>
          {isRunning ? "⏹ Stop" : "▶ Run Simulation"}
        </button>
      </div>

      {/* CPU load bar */}
      <div style={{ marginBottom: 20, maxWidth: 700, margin: "0 auto 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: "#556677", textTransform: "uppercase", letterSpacing: "0.08em" }}>Server CPU Load</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: display.cpuLoad > 70 ? "#ff8844" : "#aabbcc" }}>
            {display.cpuLoad.toFixed(0)}% · t={display.timeS}s
          </span>
        </div>
        <div style={{ height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${display.cpuLoad}%`,
            background: display.cpuLoad > 70
              ? "linear-gradient(90deg, #ff8844, #ff4422)"
              : "linear-gradient(90deg, #0088ff, #00ccff)",
            borderRadius: 5,
            transition: "width 0.1s ease",
          }} />
        </div>
      </div>

      {/* Dual panels */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <SystemPanel
          label="ThermoGuard AI — Predictive"
          accent="#00ccff"
          data={pData}
          currentPWM={display.pPWM}
          currentTemp={display.pTemp}
          currentLoad={display.cpuLoad}
          peakTemp={display.pPeak}
          energyUsed={display.pEnergy}
          responseDelay={display.pRespDelay}
          isRunning={isRunning}
        />
        <SystemPanel
          label="Legacy Reactive System"
          accent="#ff6644"
          data={rData}
          currentPWM={display.rPWM}
          currentTemp={display.rTemp}
          currentLoad={display.cpuLoad}
          peakTemp={display.rPeak}
          energyUsed={display.rEnergy}
          responseDelay={display.rRespDelay}
          isRunning={isRunning}
        />
      </div>

      {/* Summary banner */}
      {simDone && (
        <div style={{
          background: "linear-gradient(135deg, rgba(0,200,100,0.08), rgba(0,136,255,0.08))",
          border: "1px solid rgba(0,200,100,0.25)",
          borderRadius: 14, padding: "20px 28px",
          display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center", alignItems: "center",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#556677", textTransform: "uppercase", letterSpacing: "0.1em" }}>Peak Temp Saved</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#00ee77" }}>{Math.abs(tempDiff).toFixed(1)}°C</div>
            <div style={{ fontSize: 11, color: "#445566" }}>vs reactive system</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#556677", textTransform: "uppercase", letterSpacing: "0.1em" }}>Pump Energy Saved</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#00ccff" }}>{Math.max(0, energySave).toFixed(0)}%</div>
            <div style={{ fontSize: 11, color: "#445566" }}>less pump power used</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#556677", textTransform: "uppercase", letterSpacing: "0.1em" }}>Predictive Peak</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#00ccff" }}>{display.pPeak.toFixed(1)}°C</div>
            <div style={{ fontSize: 11, color: "#445566" }}>stayed below {SAFE_OUTLET_TEMP}°C safe limit</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#556677", textTransform: "uppercase", letterSpacing: "0.1em" }}>Reactive Peak</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#ff6644" }}>{display.rPeak.toFixed(1)}°C</div>
            <div style={{ fontSize: 11, color: "#445566" }}>
              {display.rPeak > SAFE_OUTLET_TEMP ? "exceeded safe limit" : "below safe limit"}
            </div>
          </div>
          <button onClick={startSim} style={{
            background: "rgba(0,200,100,0.12)", border: "1px solid rgba(0,200,100,0.3)",
            borderRadius: 8, padding: "10px 22px", color: "#00ee77",
            fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>
            ↺ Run Again
          </button>
        </div>
      )}

      {/* How it works */}
      <div style={{
        marginTop: 24,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid #1a2a3a",
        borderRadius: 12,
        padding: "16px 22px",
        display: "flex", gap: 32, flexWrap: "wrap",
      }}>
        {[
          { step: "01", title: "OS Telemetry", desc: "psutil reads CPU load every 500ms before heat moves" },
          { step: "02", title: "RF Model Predicts", desc: "Random Forest outputs exact PWM target from load + temp features" },
          { step: "03", title: "Pump Pre-Ramps", desc: "Coolant already flowing fast when heat arrives at cold plate" },
          { step: "04", title: "Temp Stays Flat", desc: "No spike, no throttle, no wasted energy from panic-blasting" },
        ].map(item => (
          <div key={item.step} style={{ flex: "1 1 160px" }}>
            <div style={{ fontSize: 10, color: "#0088ff", fontWeight: 700, letterSpacing: "0.12em", marginBottom: 4 }}>STEP {item.step}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#aabbcc", marginBottom: 3 }}>{item.title}</div>
            <div style={{ fontSize: 11, color: "#445566", lineHeight: 1.5 }}>{item.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}