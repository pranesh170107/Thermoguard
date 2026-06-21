import React, { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const CRITICAL_TEMP = 70;
const DT = 0.5;

export default function App() {
  const [cpuLoad, setCpuLoad] = useState(10);
  const [loadRoC, setLoadRoC] = useState(0);
  const [ambientTemp, setAmbientTemp] = useState(32);
  const [serialLogs, setSerialLogs] = useState([]);
  const [backendConnected, setBackendConnected] = useState(false);
  
  const [waterIn, setWaterIn] = useState(32.0);
  const [waterOut, setWaterOut] = useState(34.0);
  const [pwmOutput, setPwmOutput] = useState(15);
  const [pueValue, setPueValue] = useState(1.12);
  const [co2Saved, setCo2Saved] = useState(0.0);
  const [chartData, setChartData] = useState([]);

  const logRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [serialLogs]);

  const addLog = useCallback((source, message) => {
    const timeStr = new Date().toLocaleTimeString();
    setSerialLogs(prev => [...prev.slice(-30), { time: timeStr, source, message }]);
  }, []);

  // Sync to backend via WebSocket connection
  useEffect(() => {
    const connectWS = () => {
      addLog("GATEWAY-CLIENT", "Connecting to live FastAPI backend at ws://localhost:8000/ws...");
      const ws = new WebSocket("ws://localhost:8000/ws");
      wsRef.current = ws;

      ws.onopen = () => {
        setBackendConnected(true);
        addLog("GATEWAY-CLIENT", "🚀 Connected to FastAPI. Live data streaming active!");
      };

      ws.onmessage = (event) => {
        const telemetry = JSON.parse(event.data);
        setCpuLoad(telemetry.cpu_load);
        setLoadRoC(telemetry.load_roc);
        setWaterIn(telemetry.inlet_temp);
        setWaterOut(telemetry.outlet_temp);
        setPwmOutput(telemetry.pwm_output);
        setAmbientTemp(telemetry.ambient_temp);
        
        const powerWaterActive = (telemetry.pwm_output / 100) * 15.0;
        const calculatedPUE = 1.10 + (powerWaterActive / 150.0);
        setPueValue(Number(calculatedPUE.toFixed(2)));

        const powerBaseLineAir = 120.0;
        const wattSavings = powerBaseLineAir - (powerWaterActive + 5);
        const kgSavedThisTick = (wattSavings / 1000) * (DT / 3600) * 0.82;
        setCo2Saved(prev => prev + kgSavedThisTick);

        setChartData(prev => [
          ...prev, 
          { time: telemetry.time, cpu: telemetry.cpu_load, pwm: telemetry.pwm_output, outlet: telemetry.outlet_temp }
        ].slice(-25));

        if (Math.random() > 0.75) {
          addLog("ML-MODEL", `Prediction: Target Pump speed calibrated to ${telemetry.pwm_output}%`);
        }
      };

      ws.onerror = () => setBackendConnected(false);
      ws.onclose = () => {
        setBackendConnected(false);
        addLog("GATEWAY-CLIENT", "⚠️ Connection closed. Retrying sync in 5s...");
        setTimeout(connectWS, 5000);
      };
    };

    connectWS();
    return () => wsRef.current?.close();
  }, [addLog]);

  const handleAmbientChange = (temp) => {
    setAmbientTemp(temp);
    if (backendConnected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ set_ambient: temp }));
    }
  };

  const triggerMockSpike = () => {
    addLog("OS-TELEMETRY", "⚡ Launching CPU core stress bench benchmark...");
    if (!backendConnected) {
      addLog("WARNING", "FastAPI offline. Running dummy emulator pipeline spike.");
      setCpuLoad(95);
      setLoadRoC(85);
      setPwmOutput(90);
      setWaterOut(48.5);
      setTimeout(() => {
        setCpuLoad(12);
        setLoadRoC(-83);
        setPwmOutput(15);
        setWaterOut(34.2);
        addLog("OS-TELEMETRY", "🟢 Benchmark complete. System IDLE.");
      }, 5000);
    } else {
      addLog("GATEWAY-CLIENT", "Check terminal! Run any computation task locally to trigger live CPU spikes.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-5 mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">ThermoGuard AI</h1>
              <p className="text-xs md:text-sm text-slate-400 mt-1">Live Core ML Network Controller Infrastructure Gateway</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5 items-center">
          <div className={`px-4 py-2 rounded-xl text-xs font-semibold border flex items-center gap-2 ${backendConnected ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
            <span className={`w-2 h-2 rounded-full ${backendConnected ? "bg-emerald-400 animate-ping" : "bg-red-500"}`}></span>
            {backendConnected ? "LIVE FASTAPI CONNECTION ACTIVE" : "FASTAPI SERVER OFFLINE (SIMULATION ACTIVE)"}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-1 flex flex-col gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-400 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Control Center
            </h2>
            
            <button
              onClick={triggerMockSpike}
              className="w-full py-4 rounded-xl font-bold text-sm tracking-wide bg-gradient-to-r from-emerald-600 to-teal-500 text-white hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              RUN OS STRESS LOAD
            </button>

            <div className="mt-4 flex gap-2">
              <div className="flex-1 bg-slate-950/80 border border-slate-850 rounded-xl p-3 text-center">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">CPU</span>
                <p className="text-xl font-extrabold text-white mt-1">{cpuLoad}%</p>
              </div>
              <div className="flex-1 bg-slate-950/80 border border-slate-850 rounded-xl p-3 text-center">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">RoC Telemetry</span>
                <p className={`text-xl font-extrabold mt-1 ${loadRoC > 0 ? "text-amber-500" : "text-slate-400"}`}>
                  {loadRoC > 0 ? `+${loadRoC}` : loadRoC}%
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-400 mb-4 flex items-center justify-between">
              <span>🌴 Ambient Override</span>
              <span className="text-xs font-mono font-bold text-emerald-400">Offset</span>
            </h2>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-400">Intake Temp Baseline</span>
                  <span className="text-white font-mono">{ambientTemp}°C</span>
                </div>
                <input
                  type="range"
                  min="22"
                  max="42"
                  value={ambientTemp}
                  onChange={(e) => handleAmbientChange(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-850 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-850 text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-200">The Dataset Moat:</strong> Changing this slider sends updated values to the FastAPI model script over WS, recalibrating target parameters dynamically.
              </div>
            </div>
          </div>
        </div>

        <div className="xl:col-span-3 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Inlet Fluid</span>
                <p className="text-2xl font-extrabold font-mono text-cyan-400 mt-1">{waterIn}°C</p>
              </div>
              <div className="p-3 bg-cyan-500/10 rounded-xl text-cyan-400">🌡️</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Outlet Fluid</span>
                <p className={`text-2xl font-extrabold font-mono mt-1 ${waterOut > 45 ? "text-amber-400" : "text-emerald-400"}`}>{waterOut}°C</p>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">🔥</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Pump PWM</span>
                <p className="text-2xl font-extrabold font-mono text-purple-400 mt-1">{pwmOutput}%</p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400">⚙️</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Est. PUE</span>
                <p className="text-2xl font-extrabold font-mono text-emerald-400 mt-1">{pueValue}</p>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">🌱</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex-1 min-h-[320px] flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-400">📊 Operations Graph</h2>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> Pump PWM</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-cyan-400"></span> CPU Load</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400"></span> Outlet Temp</span>
              </div>
            </div>

            <div className="w-full h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: "#020617", borderColor: "#1e293b" }} />
                  <Line type="monotone" dataKey="pwm" stroke="#a855f7" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="cpu" stroke="#06b6d4" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="outlet" stroke="#ef4444" strokeWidth={2.5} dot={false} />
                  <ReferenceLine y={CRITICAL_TEMP} stroke="#f43f5e" strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-[200px]">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">⚡ Console Logs</h3>
              <div ref={logRef} className="bg-slate-950 p-4 rounded-xl flex-1 font-mono text-[11px] text-emerald-400 overflow-y-auto space-y-1.5">
                {serialLogs.map((log, idx) => (
                  <div key={idx}>[{log.time}] <span className="text-cyan-400">[{log.source}]</span> {log.message}</div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between h-[200px]">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">🌿 Live Carbon Ledger</h3>
                <p className="text-xs text-slate-400 mt-2">Calculated dynamically against standard local coal power grid offset metrics.</p>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl flex items-center justify-between border border-slate-850">
                <div>
                  <span className="text-[10px] uppercase font-extrabold text-slate-500">Saved Cumulative CO2 Offset</span>
                  <p className="text-2xl font-extrabold text-white font-mono mt-1">{co2Saved.toFixed(6)} <span className="text-xs font-semibold text-emerald-400">kg CO2</span></p>
                </div>
                <div className="text-4xl">🌲</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
