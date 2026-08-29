# Setup and Running Instructions

This project runs 100% offline. Follow these commands to set up and run both the backend and frontend.

## Prerequisites
- Python 3.10+
- Node.js v18+

---

## 1. Setup Backend

1. **Install python packages**:
   ```bash
   pip install fastapi uvicorn numpy opencv-python pillow scipy shapely rasterio scikit-learn
   ```

2. **Generate Sample Data**:
   ```bash
   python data/generate_data.py
   ```

3. **Start the API server**:
   From the project root:
   ```bash
   python backend/main.py
   ```
   The API will start on `http://127.0.0.1:8000`. You can inspect the interactive docs at `http://127.0.0.1:8000/docs`.

---

## 2. Setup Frontend

1. **Navigate to frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install node modules**:
   ```bash
   npm install
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:5173`.

---

## 3. Run Evaluation Suite

To run the automated precision/recall evaluation:
```bash
python eval/eval.py
```
This outputs F1 metrics, processing latency, and precision@k search retrieval.
