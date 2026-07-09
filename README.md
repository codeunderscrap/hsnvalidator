# Invoice Intelligence & HSN Validation System (IIHVS)

This repository contains a 100% free, local, open-source pipeline for extracting data from invoices (Digital PDFs & Scanned Images) and validating the products against a Master Sheet using Semantic AI.

## 🚀 Antigravity / Agent Context (START HERE)
If you are an AI agent picking up this codebase on a new system, here is the architectural context and current state of the project:

### The Architecture
1. **Frontend**: Next.js 15, React 19, TailwindCSS, Shadcn UI (`/frontend`).
2. **Backend**: FastAPI, Python 3.12 (`/backend`).
3. **Extraction Pipeline (`backend/api/parser.py`)**: 
   - Uses `PyMuPDF` (fitz) for rapid text extraction from Digital PDFs.
   - Uses `PaddleOCR` to handle Scanned PDFs and Images natively.
   - Extracts: Invoice Number, Invoice Date, Supplier GSTIN, and Line Items.
4. **Validation Pipeline (`backend/api/matcher.py`)**:
   - Uses `sentence-transformers` (`all-MiniLM-L6-v2`) to run **Semantic Matching** on the CPU for free. (e.g. matching "Lipo Cell" to "Lithium Polymer Battery").
   - Falls back to `RapidFuzz` for character-level spelling mistakes.
   - Implements edge case handling for Missing HSNs and Ambiguous Semantic matches.

### Current State
- ✅ Frontend scaffolding complete with a modern Dashboard (`frontend/src/app/page.tsx`).
- ✅ Backend scaffolding complete (`main.py`, `matcher.py`, `parser.py`).
- ✅ Frontend `fetch` is wired to the backend upload endpoint.
- 🚧 **Pending/Next Steps**: 
  - Hooking up the real table extraction logic inside `parser.py` (currently it extracts headers but mocks the line item for demonstration).
  - Linking a real Master CSV/Excel sheet to replace the `mock_master_data` DataFrame in `main.py`.

---

## 💻 Local Setup & Execution Guide

### Prerequisites
- Node.js (v18+)
- Python (3.12+)

### 1. Backend Setup
Navigate to the `backend` directory, create a virtual environment, and install the heavy ML dependencies:

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

# Install dependencies (Downloads ML Models)
pip install -r requirements.txt

# Start the API
uvicorn api.main:app --reload --port 8000
```
*Note: The first time it runs, it will download the lightweight `all-MiniLM-L6-v2` model from HuggingFace.*

### 2. Frontend Setup
Navigate to the `frontend` directory and install the UI dependencies:

```bash
cd frontend
npm install

# Start the dashboard
npm run dev
```

### 3. Usage
Navigate to `http://localhost:3000`. Drag and drop an invoice file into the UI. The frontend will hit `http://127.0.0.1:8000/api/v1/upload-invoice`, parse the document locally, validate the items semantically, and return the table results.
