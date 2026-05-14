#!/usr/bin/env python3
"""
FraudGuard AI — Model Training Script

Usage:
    python train.py                                 # Synthetic demo data (default)
    python train.py --data data/transactions.csv   # Kaggle dataset
"""
import os
import sys
import json
import argparse
import numpy as np
import pandas as pd
import joblib
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, confusion_matrix, roc_curve,
)

TYPE_MAP = {"CASH-IN": 0, "CASH-OUT": 1, "DEBIT": 2, "PAYMENT": 3, "TRANSFER": 4}

FEATURE_COLS = [
    "typeEncoded", "amount",
    "oldbalanceOrg", "newbalanceOrig",
    "oldbalanceDest", "newbalanceDest",
    "balanceDeltaOrg", "balanceDeltaDest",
    "errorBalanceOrg", "errorBalanceDest",
    "isZeroBalanceOrg", "isZeroNewBalanceOrg", "isZeroBalanceDest",
]


def generate_synthetic_data(n: int = 150_000, seed: int = 42) -> pd.DataFrame:
    """Generate PaySim-style synthetic transaction data with realistic fraud patterns."""
    rng = np.random.default_rng(seed)

    types = rng.choice(
        ["CASH-IN", "CASH-OUT", "DEBIT", "PAYMENT", "TRANSFER"],
        size=n,
        p=[0.22, 0.35, 0.08, 0.22, 0.13],
    )

    amounts = np.exp(rng.normal(7.0, 1.5, n)).clip(1, 10_000_000)
    old_bal_org = np.exp(rng.normal(8.0, 2.0, n)).clip(0, 50_000_000)
    old_bal_dest = np.exp(rng.normal(8.0, 2.0, n)).clip(0, 50_000_000)

    debit_types = np.isin(types, ["CASH-OUT", "TRANSFER", "PAYMENT", "DEBIT"])
    new_bal_orig = np.where(debit_types, np.maximum(0, old_bal_org - amounts), old_bal_org + amounts)
    new_bal_dest = np.where(
        np.isin(types, ["CASH-IN", "TRANSFER", "PAYMENT"]),
        old_bal_dest + amounts,
        old_bal_dest,
    )

    # Fraud: only in CASH-OUT / TRANSFER, drain origin account, dest doesn't receive
    fraud_candidates = np.isin(types, ["CASH-OUT", "TRANSFER"])
    fraud_mask = fraud_candidates & (rng.random(n) < 0.025)
    new_bal_orig[fraud_mask] = 0.0
    new_bal_dest[fraud_mask] = old_bal_dest[fraud_mask]

    return pd.DataFrame({
        "step": rng.integers(1, 744, n),
        "type": types,
        "amount": amounts,
        "nameOrig": ["C" + str(rng.integers(1_000_000, 9_999_999)) for _ in range(n)],
        "oldbalanceOrg": old_bal_org,
        "newbalanceOrig": new_bal_orig,
        "nameDest": ["M" + str(rng.integers(1_000_000, 9_999_999)) for _ in range(n)],
        "oldbalanceDest": old_bal_dest,
        "newbalanceDest": new_bal_dest,
        "isFraud": fraud_mask.astype(int),
        "isFlaggedFraud": (amounts > 200_000).astype(int),
    })


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["typeEncoded"] = df["type"].map(TYPE_MAP).fillna(2).astype(int)
    df["balanceDeltaOrg"] = df["newbalanceOrig"] - df["oldbalanceOrg"]
    df["balanceDeltaDest"] = df["newbalanceDest"] - df["oldbalanceDest"]
    df["errorBalanceOrg"] = df["newbalanceOrig"] + df["amount"] - df["oldbalanceOrg"]
    df["errorBalanceDest"] = df["oldbalanceDest"] + df["amount"] - df["newbalanceDest"]
    df["isZeroBalanceOrg"] = (df["oldbalanceOrg"] == 0).astype(int)
    df["isZeroNewBalanceOrg"] = (df["newbalanceOrig"] == 0).astype(int)
    df["isZeroBalanceDest"] = (df["oldbalanceDest"] == 0).astype(int)
    return df


def train_model(data_path: str = None, demo: bool = False) -> tuple:
    os.makedirs("models", exist_ok=True)

    if demo or not data_path or not os.path.exists(data_path):
        print("Generating synthetic training data (150k transactions)...")
        df = generate_synthetic_data(150_000)
        data_mode = "Synthetic (Demo)"
    else:
        print(f"Loading data from {data_path}...")
        df = pd.read_csv(data_path)
        if len(df) > 500_000:
            print(f"  Sampling 500k from {len(df):,} rows for faster training...")
            df = df.sample(500_000, random_state=42)
        data_mode = "Kaggle (Real)"

    fraud_rate = df["isFraud"].mean()
    print(f"  Transactions: {len(df):,}  |  Fraud rate: {fraud_rate:.4%}")

    df = engineer_features(df)
    X = df[FEATURE_COLS].values
    y = df["isFraud"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    n_neg = (y_train == 0).sum()
    n_pos = max((y_train == 1).sum(), 1)
    scale_pos_weight = n_neg / n_pos
    print(f"  Training: {len(X_train):,}  |  scale_pos_weight: {scale_pos_weight:.1f}")

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos_weight,
        eval_metric="logloss",
        use_label_encoder=False,
        n_jobs=-1,
        random_state=42,
        verbosity=0,
    )

    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    cm = confusion_matrix(y_test, y_pred)
    fpr, tpr, _ = roc_curve(y_test, y_proba)
    step = max(1, len(fpr) // 100)

    metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "auc_roc": float(roc_auc_score(y_test, y_proba)),
        "training_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "fraud_rate": float(fraud_rate),
        "model_type": "XGBoost",
        "data_mode": data_mode,
        "confusion_matrix": {
            "tn": int(cm[0][0]),
            "fp": int(cm[0][1]),
            "fn": int(cm[1][0]),
            "tp": int(cm[1][1]),
        },
        "roc_curve": {
            "fpr": fpr[::step].tolist(),
            "tpr": tpr[::step].tolist(),
        },
    }

    feature_importance = sorted(
        [{"feature": f, "importance": float(i)}
         for f, i in zip(FEATURE_COLS, model.feature_importances_)],
        key=lambda x: x["importance"],
        reverse=True,
    )

    joblib.dump(model, "models/fraud_model.pkl")
    with open("models/metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    with open("models/feature_importance.json", "w") as f:
        json.dump(feature_importance, f, indent=2)

    print(f"\n  Training complete!")
    print(f"  Accuracy:  {metrics['accuracy']:.4f}")
    print(f"  Precision: {metrics['precision']:.4f}")
    print(f"  Recall:    {metrics['recall']:.4f}")
    print(f"  F1 Score:  {metrics['f1']:.4f}")
    print(f"  AUC-ROC:   {metrics['auc_roc']:.4f}")
    print(f"  TP={cm[1][1]:,}  FP={cm[0][1]:,}  FN={cm[1][0]:,}  TN={cm[0][0]:,}")

    return model, metrics, feature_importance


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train FraudGuard AI model")
    parser.add_argument("--data", default=None, help="Path to Kaggle CSV dataset")
    parser.add_argument("--demo", action="store_true", help="Force synthetic data")
    args = parser.parse_args()
    train_model(data_path=args.data, demo=args.demo)
