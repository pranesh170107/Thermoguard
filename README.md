# ThermoGuard AI: Dual-Layer Predictive Edge Cooling System

An intelligent, full-stack data center thermal management application that transitions cooling infrastructure from legacy reactive threshold loops to proactive, feed-forward AI control. 

By capturing operating system telemetry *before* thermal energy physically propagates through hardware components, ThermoGuard AI mitigates severe transient temperature spikes and significantly optimizes structural cooling efficiency.

---

## 🚀 Core Novelty & Innovation

Traditional data center cooling units are blind to live computational spikes; they only react **after** a physical temperature sensor registers an overheat event. Due to the inherent structural thermal lag of liquid coolants, this delay causes thermal stress, temporary processor throttling, and inefficient "panic-blasting" of cooling pumps at 100% capacity.

**ThermoGuard AI introduces a proactive feed-forward mechanism:**
1. **Telemetry Interception:** Samples raw OS telemetry metrics (CPU load and its dynamic Rate of Change) every 500ms using low-overhead system hooks.
2. **Predictive Modeling:** A localized Machine Learning Regression model computes oncoming thermal wattage trajectories before heat can physically conduct to the coolant loop.
3. **Pre-Ramping Execution:** Automatically adjusts Pulse Width Modulation (PWM) pump duty cycles ahead of time. The coolant flow rate is already optimized by the time energy dissipates through the processor die, keeping the thermal curve flat.

---

## 📂 Repository Architecture

The project is split into decoupled backend automation and frontend analytical layers:

```text
Thermoguard/
├── backend/          # FastAPI Engine, OS Telemetry Harvester & ML Model
│   ├── main.py
│   ├── requirements.txt
│   └── models/
└── frontend/         # React Workspace & Responsive Recharts Visual Analytics
    ├── src/
    │   ├── App.jsx   # Live comparative dashboard UI
    │   └── main.jsx
    ├── package.json
    └── vite.config.js
