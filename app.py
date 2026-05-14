#!/usr/bin/env python3
"""
FraudGuard AI — FastAPI Server
Serves the ML fraud detection API and frontend static files.

Run:
    uvicorn app:app --reload
    # or
    python app.py
"""
import os
import json
import random
from datetime import datetime
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

TYPE_MAP = {"CASH-IN": 0, "CASH-OUT": 1, "DEBIT": 2, "PAYMENT": 3, "TRANSFER": 4}

FEATURE_COLS = [
    "typeEncoded", "amount",
    "oldbalanceOrg", "newbalanceOrig",
    "oldbalanceDest", "newbalanceDest",
    "balanceDeltaOrg", "balanceDeltaDest",
    "errorBalanceOrg", "errorBalanceDest",
    "isZeroBalanceOrg", "isZeroNewBalanceOrg", "isZeroBalanceDest",
]

app = FastAPI(title="FraudGuard AI", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Runtime state
_model = None
_metrics: dict = {}
_feature_importance: list = []
_recent_predictions: list = []


def _load_artifacts():
    global _model, _metrics, _feature_importance
    _model = joblib.load("models/fraud_model.pkl")
    with open("models/metrics.json") as f:
        _metrics = json.load(f)
    with open("models/feature_importance.json") as f:
        _feature_importance = json.load(f)
    print("Model artifacts loaded.")


@app.on_event("startup")
async def startup():
    if not os.path.exists("models/fraud_model.pkl"):
        print("No model found — training on synthetic data (this may take ~60s)...")
        from train import train_model
        train_model(demo=True)
    _load_artifacts()


# ── Pydantic models ───────────────────────────────────────────────────────────

class Transaction(BaseModel):
    type: str = Field(..., example="TRANSFER")
    amount: float = Field(..., gt=0, example=181357.20)
    oldbalanceOrg: float = Field(..., ge=0, example=181357.20)
    newbalanceOrig: float = Field(..., ge=0, example=0.0)
    oldbalanceDest: float = Field(..., ge=0, example=0.0)
    newbalanceDest: float = Field(..., ge=0, example=0.0)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_feature_row(t: Transaction) -> pd.DataFrame:
    return pd.DataFrame([{
        "typeEncoded": TYPE_MAP.get(t.type, 2),
        "amount": t.amount,
        "oldbalanceOrg": t.oldbalanceOrg,
        "newbalanceOrig": t.newbalanceOrig,
        "oldbalanceDest": t.oldbalanceDest,
        "newbalanceDest": t.newbalanceDest,
        "balanceDeltaOrg": t.newbalanceOrig - t.oldbalanceOrg,
        "balanceDeltaDest": t.newbalanceDest - t.oldbalanceDest,
        "errorBalanceOrg": t.newbalanceOrig + t.amount - t.oldbalanceOrg,
        "errorBalanceDest": t.oldbalanceDest + t.amount - t.newbalanceDest,
        "isZeroBalanceOrg": 1 if t.oldbalanceOrg == 0 else 0,
        "isZeroNewBalanceOrg": 1 if t.newbalanceOrig == 0 else 0,
        "isZeroBalanceDest": 1 if t.oldbalanceDest == 0 else 0,
    }])


def _detect_risk_factors(t: Transaction) -> list[str]:
    factors = []
    if t.type in ("CASH-OUT", "TRANSFER") and t.amount > 100_000:
        factors.append(f"High-value {t.type} (${t.amount:,.0f})")
    if t.newbalanceOrig == 0 and t.oldbalanceOrg > 0:
        factors.append("Origin account drained to zero")
    dest_change = t.newbalanceDest - t.oldbalanceDest
    if abs(dest_change) < t.amount * 0.01 and t.type in ("TRANSFER", "PAYMENT"):
        factors.append("Destination balance discrepancy")
    if t.amount > 1_000_000:
        factors.append("Extreme transaction amount (>$1M)")
    if t.type not in ("CASH-OUT", "TRANSFER"):
        factors.append(f"Note: fraud rare in {t.type} transactions")
    return factors


def _run_predict(t: Transaction) -> dict:
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not ready")
    X = _build_feature_row(t)
    probability = float(_model.predict_proba(X)[0][1])
    is_fraud = bool(_model.predict(X)[0])
    confidence = (
        "High" if probability > 0.75 or probability < 0.25
        else "Medium" if probability > 0.5 or probability < 0.5
        else "Low"
    )
    result = {
        "isFraud": is_fraud,
        "probability": round(probability, 4),
        "confidence": confidence,
        "riskFactors": _detect_risk_factors(t),
        "recommendation": "Block Transaction" if is_fraud else "Approve Transaction",
        "timestamp": datetime.now().isoformat(),
    }
    _recent_predictions.insert(0, {**result, "transaction": t.model_dump()})
    if len(_recent_predictions) > 50:
        _recent_predictions.pop()
    return result


# ── API routes ────────────────────────────────────────────────────────────────

@app.post("/api/predict")
async def predict(transaction: Transaction):
    return _run_predict(transaction)


@app.get("/api/metrics")
async def get_metrics():
    if not _metrics:
        raise HTTPException(status_code=503, detail="Model not ready")
    return _metrics


@app.get("/api/feature-importance")
async def get_feature_importance():
    return _feature_importance


@app.get("/api/recent-predictions")
async def get_recent_predictions():
    return _recent_predictions[:20]


@app.post("/api/simulate")
async def simulate_transaction():
    """Return a randomly generated transaction with its prediction (30% fraud for demo visibility)."""
    rng = random.Random()
    is_demo_fraud = rng.random() < 0.35

    if is_demo_fraud:
        tx_type = rng.choice(["CASH-OUT", "TRANSFER"])
        amount = rng.uniform(50_000, 500_000)
        old_bal = rng.uniform(amount, amount * 1.5)
        t = Transaction(
            type=tx_type, amount=round(amount, 2),
            oldbalanceOrg=round(old_bal, 2), newbalanceOrig=0.0,
            oldbalanceDest=round(rng.uniform(0, 5000), 2),
            newbalanceDest=round(rng.uniform(0, 5000), 2),
        )
    else:
        tx_type = rng.choice(["CASH-IN", "PAYMENT", "DEBIT", "CASH-OUT", "TRANSFER"])
        amount = rng.uniform(10, 30_000)
        old_bal = rng.uniform(amount * 2, amount * 10)
        new_bal = max(0, old_bal - amount) if tx_type in ("CASH-OUT", "PAYMENT", "DEBIT") else old_bal + amount
        dest_old = rng.uniform(0, 100_000)
        t = Transaction(
            type=tx_type, amount=round(amount, 2),
            oldbalanceOrg=round(old_bal, 2), newbalanceOrig=round(new_bal, 2),
            oldbalanceDest=round(dest_old, 2),
            newbalanceDest=round(dest_old + amount if tx_type in ("TRANSFER", "PAYMENT") else dest_old, 2),
        )

    result = _run_predict(t)
    return {**result, "transaction": t.model_dump()}


# ── Static file serving ───────────────────────────────────────────────────────

if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
