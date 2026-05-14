# FraudGuard AI — ML Fraud Detection System

A full-stack fraud detection application using **XGBoost** and **FastAPI**, trained on the PaySim-style financial transaction dataset from Kaggle.

## Features

- **XGBoost classifier** with engineered balance-error features and automatic class-imbalance handling
- **Real-time prediction API** — submit a transaction and get an instant fraud probability
- **Interactive dashboard** — animated gauge, feature importance chart, ROC curve, confusion matrix
- **Simulate mode** — generate and score random transactions with one click
- **Transaction log** — color-coded history of all analyzed transactions

## Tech Stack

| Layer      | Technology              |
|------------|-------------------------|
| ML Model   | XGBoost, scikit-learn   |
| Backend    | FastAPI + Uvicorn       |
| Frontend   | Vanilla JS, Chart.js    |
| Data       | Pandas, NumPy           |

## Quick Start

### 1. Install dependencies

```bash
cd fraud-detection
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. (Optional) Use the real Kaggle dataset

Download from: https://www.kaggle.com/datasets/amanalisiddiqui/fraud-detection-dataset

Place the CSV at `data/transactions.csv`, then train with real data:

```bash
python train.py --data data/transactions.csv
```

If you skip this step the server auto-trains on **synthetic data** (150k transactions, ~60 seconds) on first startup — the app is fully functional either way.

### 3. Run the server

```bash
uvicorn app:app --reload
# or
python app.py
```

Open **http://localhost:8000** in your browser.

## Dataset Schema

| Column          | Description                          |
|-----------------|--------------------------------------|
| `step`          | Time unit (1 step = 1 hour)         |
| `type`          | CASH-IN / CASH-OUT / DEBIT / PAYMENT / TRANSFER |
| `amount`        | Transaction amount                   |
| `oldbalanceOrg` | Origin balance before transaction    |
| `newbalanceOrig`| Origin balance after transaction     |
| `oldbalanceDest`| Destination balance before           |
| `newbalanceDest`| Destination balance after            |
| `isFraud`       | **Target** — 1 = fraud, 0 = legit   |

> Fraud only occurs in `CASH-OUT` and `TRANSFER` transactions in this dataset.

## Engineered Features

The model uses raw columns plus these derived features that significantly boost performance:

| Feature              | Formula / Description                          |
|----------------------|------------------------------------------------|
| `errorBalanceOrg`    | `newbalanceOrig + amount − oldbalanceOrg`      |
| `errorBalanceDest`   | `oldbalanceDest + amount − newbalanceDest`     |
| `balanceDeltaOrg`    | `newbalanceOrig − oldbalanceOrg`               |
| `balanceDeltaDest`   | `newbalanceDest − oldbalanceDest`              |
| `isZeroNewBalanceOrg`| Flag: origin account drained to zero           |

## API Endpoints

| Method | Path                    | Description                    |
|--------|-------------------------|--------------------------------|
| POST   | `/api/predict`          | Predict fraud for a transaction|
| GET    | `/api/metrics`          | Model performance metrics      |
| GET    | `/api/feature-importance` | Feature importances          |
| GET    | `/api/recent-predictions` | Last 20 analyzed transactions|
| POST   | `/api/simulate`         | Generate a random transaction  |

### Example predict request

```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "type": "TRANSFER",
    "amount": 181357.20,
    "oldbalanceOrg": 181357.20,
    "newbalanceOrig": 0.0,
    "oldbalanceDest": 0.0,
    "newbalanceDest": 0.0
  }'
```

## Project Structure

```
fraud-detection/
├── app.py                  # FastAPI server + static file serving
├── train.py                # XGBoost training script
├── requirements.txt
├── models/                 # Auto-created; stores .pkl + metrics.json
├── data/                   # Place Kaggle CSV here (gitignored)
└── static/
    ├── index.html
    ├── css/styles.css
    └── js/app.js
```
