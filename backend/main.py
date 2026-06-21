"""
ThermoGuard AI — Unified FastAPI & WebSocket Server
===================================================
This server acts as the operational bridge between:
1. The Core ML Model (thermoguard_model.pkl)
2. The Local Host Telemetry (psutil)
3. The Physical ESP32 Hardware (via Serial/COM port)
4. The React Frontend Dashboard (via WebSockets)
"""

import os
import json
import time
import asyncio
import threading
import warnings
from typing import List

import numpy as np
import pandas as pd
import psutil
import joblib
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Ignore sklearn version mismatch warnings if compiling across environments
warnings.filterwarnings("ignore")

app = FastAPI(title="ThermoGuard AI Operational Gateway")

# Enable CORS so our React frontend can connect securely
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── GLOBAL STATE & TELEMETRY BUFFERS ───────────────────────────────────────
MODEL_PATH = "thermoguard_model.pkl"
serial_conn = None
serial_port_name = "COM3"  # Adjust for Windows (COM3/4) or Linux/Mac (/dev/ttyUSB0)

# In-memory tracking for features
cpu_history = [0.0] * 5
inlet_temp = 32.0
outlet_temp = 34.0
ambient_temp = 31.5
optimal_pwm = 15.0

# Active WebSockets clients list
connected_clients: List[WebSocket] = []

# Load serialized RandomForest predictive brain
try:
    if os.path.exists(MODEL_PATH):
        model = joblib.load(MODEL_PATH)
        print(f"[✓] Machine Learning model '{MODEL_PATH}' loaded successfully.")
    else:
        print(f"[!] Model file '{MODEL_PATH}' not found. Using algorithmic fallback.")
        model = None
except Exception as e:
    print(f"[!] Error loading {MODEL_PATH}: {e}")
    model = None

# ── PHYSICAL HARDWARE LOOP: SERIAL PROTOCOL THREAD ──────────────────────────
def esp32_serial_thread():
    """Background worker thread to continuously read sensor data from ESP32."""
    global inlet_temp, outlet_temp, serial_conn
    try:
        import serial  # Import inside thread to prevent server crashes if pyserial is missing
        print(f"🔌 Trying to establish Serial Handshake on {serial_port_name}...")
        serial_conn = serial.Serial(port=serial_port_name, baudrate=115200, timeout=1)
        time.sleep(2)  # Wait for ESP32 bootloader
        print(f"[✓] Physical Serial connection active on {serial_port_name}")
    except Exception as e:
        print(f"[!] Serial connection skipped: {e}. Running in emulation hardware-loop.")
        return

    while True:
        try:
            if serial_conn and serial_conn.is_open and serial_conn.in_waiting > 0:
                raw_line = serial_conn.readline().decode('utf-8').strip()
                # Assuming ESP32 outputs telemetry as: "IN:32.4,OUT:34.8"
                if "IN:" in raw_line and "OUT:" in raw_line:
                    parts = raw_line.split(",")
                    inlet_temp = float(parts[0].split(":")[1])
                    outlet_temp = float(parts[1].split(":")[1])
        except Exception as err:
            print(f"[!] Serial stream error: {err}")
            time.sleep(1)

# Start Serial Thread
threading.Thread(target=esp32_serial_thread, daemon=True).start()

# ── TELEMETRY STREAM & MODEL PREDICTION COROUTINE ──────────────────────────
async def telemetry_and_prediction_loop():
    """Asynchronous background loop to pull system stats, run ML, and broadcast to React."""
    global cpu_history, inlet_temp, outlet_temp, ambient_temp, optimal_pwm, serial_conn
    
    while True:
        # 1. Grab bare-metal host telemetry
        current_load = psutil.cpu_percent(interval=None)
        cpu_history.append(current_load)
        cpu_history = cpu_history[-5:]  # Keep rolling 5 elements
        
        # Calculate features dynamically
        load_roc = cpu_history[-1] - cpu_history[-2] if len(cpu_history) >= 2 else 0.0
        rolling_avg = sum(cpu_history) / len(cpu_history)
        delta_T = max(0.1, outlet_temp - inlet_temp)
        thermal_watts = (current_load / 100.0) * 100.0  # Safe scaled 100W approximation
        flow_rate = 0.5 + (optimal_pwm / 100.0) * (3.0 - 0.5)  # Scale active flow based on active PWM
        
        # 2. Run Random Forest model prediction if model is loaded
        if model:
            # Reconstruct the exact DataFrame format matching the ML training structure
            features_df = pd.DataFrame([{
                'cpu_load': current_load,
                'load_roc': load_roc,
                'rolling_avg_load': rolling_avg,
                'thermal_watts': thermal_watts,
                'inlet_temp': inlet_temp,
                'outlet_temp': outlet_temp,
                'delta_T': delta_T,
                'flow_rate_lpm': flow_rate,
                'ambient_temp': ambient_temp
            }])
            try:
                predicted_pwm = model.predict(features_df)[0]
                optimal_pwm = float(np.clip(predicted_pwm, 15, 100))
            except Exception as ml_err:
                # Basic fallback safety
                optimal_pwm = 15.0 if current_load < 20 else 55.0
        else:
            # Standard reactive/heuristic fallback if model not trained
            optimal_pwm = 15.0 + (current_load * 0.8)

        # 3. If real hardware is connected, write the target PWM speed over serial instantly
        if serial_conn and serial_conn.is_open:
            try:
                command = f"{int(optimal_pwm)}\n"
                serial_conn.write(command.encode('utf-8'))
            except Exception as e:
                print(f"[!] Serial write fail: {e}")

        # 4. Compile the full operational telemetry packet
        telemetry_payload = {
            "time": time.strftime("%H:%M:%S"),
            "cpu_load": round(current_load, 1),
            "load_roc": round(load_roc, 1),
            "rolling_avg": round(rolling_avg, 1),
            "inlet_temp": round(inlet_temp, 2),
            "outlet_temp": round(outlet_temp, 2),
            "ambient_temp": round(ambient_temp, 2),
            "pwm_output": int(optimal_pwm),
            "delta_T": round(delta_T, 2),
            "flow_rate_lpm": round(flow_rate, 2),
            "model_status": "ACTIVE" if model else "FALLBACK"
        }

        # 5. Broadcast to all active browser clients over WebSockets
        for client in list(connected_clients):
            try:
                await client.send_text(json.dumps(telemetry_payload))
            except WebSocketDisconnect:
                connected_clients.remove(client)
            except Exception:
                try:
                    connected_clients.remove(client)
                except ValueError:
                    pass

        await asyncio.sleep(0.5)  # Poll and transmit every 500ms (Match standard DT)

# Register background task during server lifespan
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(telemetry_and_prediction_loop())

# ── WEBSOCKET INGRESS GATEWAY ──────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global ambient_temp, inlet_temp, outlet_temp
    await websocket.accept()
    connected_clients.append(websocket)
    print(f"[✓] React Frontend Client Connected. Active WebSockets: {len(connected_clients)}")
    
    try:
        while True:
            # Listen to incoming commands or overrides from React frontend
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Handle real-time environmental configuration overrides from UI sliders
            if "set_ambient" in message:
                ambient_temp = float(message["set_ambient"])
                # Adjust water temp constraints relative to ambient shift
                inlet_temp = ambient_temp
                outlet_temp = ambient_temp + 2.0
                print(f"[UI Offset] Adjusting ambient baseline environment target to: {ambient_temp}°C")
                
    except WebSocketDisconnect:
        try:
            connected_clients.remove(websocket)
        except ValueError:
            pass
        print("[!] Client disconnected.")