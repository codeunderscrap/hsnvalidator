from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import uvicorn

app = FastAPI(
    title="Invoice Intelligence & HSN Validation System API",
    description="Backend API for IIHVS. Handles 100% local OCR and Semantic AI Matching.",
    version="1.0.0"
)

# Configure CORS for Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "online", "message": "IIHVS Backend API is running."}

import os
import shutil
import pandas as pd
from api.matcher import HSNMatcher
from api.parser import InvoiceParser

# Initialize models
matcher = HSNMatcher()
parser = InvoiceParser()

# Master DataFrame loader with fallback
def load_master_data():
    csv_path = "master_catalogue.csv"
    if os.path.exists(csv_path):
        try:
            return pd.read_csv(csv_path)
        except Exception as e:
            print(f"Error loading master CSV: {e}")
            
    # Comprehensive default product registry for battery recycling
    default_data = {
        'HSN': [
            '85491010', '85491010', '38249900', '28369100', 
            '28259090', '28252000', '74040012', '76020010'
        ],
        'Product Name': [
            'Lithium Polymer Batteries', 'Battery Lithium Core', 'Black Mass Material (Co/Ni/Li)', 
            'Lithium Carbonate Pure', 'Cobalt Sulfate Recycled', 'Lithium Hydroxide',
            'Copper Foil Scrap', 'Aluminum Battery Casing Scrap'
        ],
        'Rate': [1000, 1200, 2500, 4500, 3800, 4200, 650, 180]
    }
    return pd.DataFrame(default_data)

master_df = load_master_data()

@app.post("/api/v1/upload-invoice")
async def upload_invoice(
    file: UploadFile = File(...),
):
    """
    Endpoint to receive an invoice file, extract data, and perform AI semantic matching.
    """
    # 1. Save uploaded file temporarily
    temp_path = f"temp_{file.filename}"
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        # 2. Parse the PDF or Image
        is_digital = parser.is_digital_pdf(temp_path)
        
        if is_digital:
            parsed_data = parser.parse_digital_pdf(temp_path)
            processing_type = "Digital PDF (PyMuPDF)"
        else:
            parsed_data = parser.parse_scanned_document(temp_path)
            processing_type = "Scanned/Image (PaddleOCR)"
            
        if "error" in parsed_data:
            return {"status": "error", "message": parsed_data["error"]}
        
        # 3. Process all extracted line items and run Semantic Matching
        line_items_results = []
        global master_df
        
        extracted_inv_no = parsed_data.get("invoice_number", "")
        
        for item in parsed_data.get("line_items", []):
            item_name = item.get("name")
            item_hsn = item.get("hsn")
            
            match_result = matcher.match_product(item_name, master_df, extracted_inv_no, item_hsn)
            
            # --- WEBHOOK WRITE-BACK LOGIC ---
            if item_hsn and match_result.get("confidence", 0) >= 70 and match_result.get("matched_product"):
                matched_name = match_result["matched_product"]
                
                # Check memory state first
                if extracted_inv_no and 'Invoice Number' in master_df.columns:
                    idx = master_df.index[
                        (master_df['Product Name'] == matched_name) & 
                        (master_df['Invoice Number'].astype(str).str.lower() == str(extracted_inv_no).lower())
                    ]
                else:
                    idx = master_df.index[master_df['Product Name'] == matched_name]
                    
                if not idx.empty:
                    master_df.loc[idx, 'HSN'] = item_hsn
                    match_result["hsn_written_back"] = True
                    
                # NOTE: The frontend will pass the webhook URL when clicking "Save / Sync" or we can trigger it automatically
                # To keep it safe and avoid spamming Google Sheets on every upload scan, we will let the user explicitly trigger 
                # the write-back from the UI via the /manual-write-back endpoint after they verify the extractions.
            
            line_items_results.append({
                "extracted_name": item_name,
                "extracted_hsn": item_hsn,
                "ai_validation": match_result
            })
            
        # Combine results
        final_response = {
            "filename": file.filename,
            "status": "success",
            "processing_type": processing_type,
            "extracted_header": {
                "invoice_number": parsed_data.get("invoice_number"),
                "invoice_date": parsed_data.get("invoice_date"),
                "supplier_gstin": parsed_data.get("supplier_gstin"),
            },
            "line_items": line_items_results,
            "raw_text_preview": parsed_data.get("raw_text_preview", "")
        }
        
        return final_response
        
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.get("/api/v1/master-catalogue")
async def get_master_catalogue():
    """
    Returns the current master catalogue as JSON.
    """
    global master_df
    # Replace NaNs with empty strings to prevent JSON serialization errors
    safe_df = master_df.fillna("")
    return safe_df.to_dict(orient="records")

import requests

@app.post("/api/v1/sync-master")
async def sync_master(sheet_url: str = Form(...)):
    """
    Fetches the live Master Catalogue directly from a public Google Sheet link.
    Expects a standard Google Sheets URL, converts it to a CSV export URL.
    """
    global master_df
    try:
        # Convert standard sheets URL to CSV export URL
        import re
        sheet_id_match = re.search(r"/d/([a-zA-Z0-9-_]+)", sheet_url)
        if not sheet_id_match:
            return {"status": "error", "message": "Invalid Google Sheets URL."}
            
        sheet_id = sheet_id_match.group(1)
        csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
        
        # Download the CSV
        response = requests.get(csv_url)
        if response.status_code != 200:
            return {"status": "error", "message": "Failed to fetch Google Sheet. Ensure it is set to 'Anyone with the link can view'."}
            
        temp_path = "temp_live_master.csv"
        with open(temp_path, "wb") as f:
            f.write(response.content)
            
        df = pd.read_csv(temp_path)
        
        # Standardize column names based on the client's specific format
        col_map = {
            'Type of Scrap': 'Product Name',
            'Description': 'Product Name',
            'HSN No.': 'HSN',
            'HSN Code': 'HSN',
            'Invoice number': 'Invoice Number' # Fixing capitalization inconsistency in their sheet
        }
        df.rename(columns=col_map, inplace=True)
        # Drop duplicated columns to prevent returning a DataFrame when selecting a single column
        df = df.loc[:, ~df.columns.duplicated()]
            
        if 'Product Name' not in df.columns:
            return {
                "status": "error",
                "message": f"Spreadsheet must contain a 'Type of Scrap' or 'Product Name' column."
            }
            
        if 'Invoice Number' not in df.columns:
            df['Invoice Number'] = None
            
        if 'HSN' not in df.columns:
            df['HSN'] = None
            
        master_df = df
        return {
            "status": "success", 
            "message": "Live Master catalogue synced successfully.", 
            "row_count": len(master_df)
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to sync sheet: {str(e)}"}
    finally:
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)

from pydantic import BaseModel
class WriteBackRequest(BaseModel):
    product_name: str
    hsn_code: str
    invoice_number: str
    webhook_url: str
    sheet_tab_name: str = "Sheet1"

@app.post("/api/v1/manual-write-back")
async def manual_write_back(request: WriteBackRequest):
    """
    Sends the validated HSN code directly to the Live Google Sheet via the Apps Script Webhook.
    """
    global master_df
    try:
        # 1. Update local memory dataframe first
        if not master_df.empty and 'HSN' in master_df.columns:
            if 'Invoice Number' in master_df.columns and request.invoice_number:
                idx = master_df.index[
                    (master_df['Product Name'] == request.product_name) & 
                    (master_df['Invoice Number'].astype(str).str.lower() == str(request.invoice_number).lower())
                ]
            else:
                idx = master_df.index[master_df['Product Name'] == request.product_name]
                
            if not idx.empty:
                master_df.loc[idx, 'HSN'] = request.hsn_code
                
        # 2. Send POST request to Google Apps Script Webhook
        if not request.webhook_url:
            return {"status": "error", "message": "Webhook URL is missing. Please configure it in the UI."}
            
        payload = {
            "invoiceNumber": request.invoice_number,
            "productName": request.product_name,
            "hsnCode": request.hsn_code,
            "sheetTabName": request.sheet_tab_name
        }
        
        response = requests.post(request.webhook_url, json=payload)
        
        if response.status_code in [200, 201] and response.text.strip() == "Success":
            return {"status": "success", "message": "HSN Code saved to Live Sheet and local memory."}
        else:
            return {"status": "error", "message": f"Webhook returned: {response.text.strip()}"}
            
    except Exception as e:
        return {"status": "error", "message": str(e)}

from fastapi.responses import FileResponse
@app.get("/api/v1/download-master")
async def download_master():
    """
    Download the current master sheet (including any AI write-backs) as an Excel file.
    """
    global master_df
    export_path = "updated_master_catalogue.xlsx"
    master_df.to_excel(export_path, index=False)
    return FileResponse(
        path=export_path, 
        filename="Enriched_Master_Catalogue.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
