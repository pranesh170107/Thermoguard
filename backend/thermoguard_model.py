"""
ThermoGuard AI — Custom Dataset Model Pipeline
==============================================
This script loads your pre-processed 'thermoguard_dataset.csv', trains
a Random Forest Regressor to predict optimal cooling pump speed (PWM),
evaluates validation performance, and saves the serialized model (.pkl).
"""

import numpy as np
import pandas as pd
import joblib
import os
import warnings
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score

warnings.filterwarnings("ignore")

# ── CONFIGURATION & PATHS ──────────────────────────────────────────────────
DATASET_PATH = "thermoguard_dataset.csv"
MODEL_SAVE_PATH = "thermoguard_model.pkl"

def load_and_train():
    print("="*60)
    print("🛰️  ThermoGuard AI ML Training pipeline initiated...")
    print("="*60)

    # 1. Check for custom dataset
    if not os.path.exists(DATASET_PATH):
        raise FileNotFoundError(
            f"[!] Error: Could not find '{DATASET_PATH}' in the current working directory.\n"
            "Please make sure your preprocessed CSV is placed alongside this script."
        )

    print(f"[✓] Found local custom dataset: '{DATASET_PATH}'")
    
    # 2. Load and parse the dataset
    df = pd.read_csv(DATASET_PATH)
    print(f"[✓] Loaded {df.shape[0]} training telemetry rows with {df.shape[1]} metrics.")

    # 3. Define Features (X) and Target (y)
    # Target variable is optimal_pwm (the pump speed output command, 0-100%)
    target_col = 'optimal_pwm'
    
    if target_col not in df.columns:
        raise KeyError(f"[!] Critical: Target column '{target_col}' not found in the dataset headers!")

    # Features represent our complete software-hardware telemetry matrix
    feature_cols = [
        'cpu_load', 
        'load_roc', 
        'rolling_avg_load', 
        'thermal_watts', 
        'inlet_temp', 
        'outlet_temp', 
        'delta_T', 
        'flow_rate_lpm', 
        'ambient_temp'
    ]

    # Verify all feature columns exist in the dataset
    missing_cols = [col for col in feature_cols if col not in df.columns]
    if missing_cols:
        raise KeyError(f"[!] Warning: Missing expected columns in your CSV: {missing_cols}")

    X = df[feature_cols]
    y = df[target_col]

    print("\n🔬 Features Selected for Training:")
    for idx, col in enumerate(feature_cols, 1):
        print(f"  {idx}. {col}")

    # 4. Train-Test Split (80% Training, 20% Validation/Testing)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    print(f"\n[✓] Executed 80/20 train-test split.")
    print(f"    - Training set size: {X_train.shape[0]} rows")
    print(f"    - Testing set size: {X_test.shape[0]} rows")

    # 5. Initialize and Train Random Forest Regressor
    print("\n⚡ Training Random Forest Regressor (Ensemble of Decision Trees)...")
    model = RandomForestRegressor(
        n_estimators=100, 
        max_depth=12, 
        random_state=42, 
        n_jobs=-1
    )
    model.fit(X_train, y_train)
    print("[✓] Model Training Complete!")

    # 6. Evaluate Performance on Holdout Set
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)

    print("\n" + "="*50)
    print("📊 Validation Metrics:")
    print(f"   - Mean Absolute Error (MAE): {mae:.3f}% PWM")
    print(f"   - Coefficient of Determination (R²): {r2:.6f}")
    print("="*50)

    # 7. Check if model meets production readiness criteria
    if r2 > 0.95:
        print("  [✓✓] Model meets PRODUCTION READY status (>0.95 R²).")
    else:
        print("  [✓] Model trained successfully but metrics indicate a high variance limit.")

    # 8. Serialize and Save Model
    joblib.dump(model, MODEL_SAVE_PATH)
    print(f"\n[✓] Saved serialized predictive brain to: '{MODEL_SAVE_PATH}'")
    print("="*60 + "\n")

    return model

if __name__ == "__main__":
    load_and_train()