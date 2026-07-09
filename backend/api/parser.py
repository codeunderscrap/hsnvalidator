import fitz  # PyMuPDF
import re
import pandas as pd
from typing import List, Dict, Any
import os
try:
    from paddleocr import PaddleOCR
    PADDLE_AVAILABLE = True
except ImportError:
    PADDLE_AVAILABLE = False

class InvoiceParser:
    def __init__(self):
        # Pre-compile regex patterns for common invoice fields
        self.invoice_no_pattern = re.compile(r"(?i)(?:invoice|bill|so|inv|po)\s*(?:no|number|#)?\s*[:\-\n]*\s*([A-Z0-9\-\/_]{5,})")
        self.date_pattern = re.compile(r"(?i)date\s*[:\-]?\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})")
        self.gstin_pattern = re.compile(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b")
        
        # Lazy-initialize PaddleOCR — only load when first needed for scanned docs
        self._ocr = None
        self._ocr_initialized = False

    @property
    def ocr(self):
        """Lazy PaddleOCR initialization — only downloads models when first needed."""
        if not self._ocr_initialized:
            self._ocr_initialized = True
            if PADDLE_AVAILABLE:
                try:
                    print("Initializing PaddleOCR...")
                    self._ocr = PaddleOCR(use_angle_cls=True, lang='en')
                    print("PaddleOCR initialized successfully.")
                except Exception as e:
                    print(f"PaddleOCR initialization failed (scanned docs will be unavailable): {e}")
                    self._ocr = None
        return self._ocr


    def is_digital_pdf(self, file_path: str) -> bool:
        """
        Determines if a PDF is digital (text-based) or scanned (image-based).
        """
        if not file_path.lower().endswith('.pdf'):
            return False # Images are inherently scanned
            
        try:
            doc = fitz.open(file_path)
            text_length = 0
            for page in doc:
                text_length += len(page.get_text("text").strip())
            doc.close()
            
            # If there's very little selectable text, it's likely a scanned image inside a PDF
            return text_length > 100 
        except Exception:
            return False

    def extract_line_items(self, full_text: str) -> List[Dict[str, Any]]:
        line_items = []
        lines = [line.strip() for line in full_text.split('\n') if line.strip()]
        
        # Look for typical HSN codes (4, 6, or 8 digits)
        hsn_pattern = re.compile(r'\b(\d{4}|\d{6}|\d{8})\b')
        
        # Keywords indicating battery/metals scrap or products
        keywords = ['battery', 'batteries', 'cell', 'lipo', 'lithium', 'cobalt', 'nickel', 'mass', 'scrap', 'wire', 'copper', 'aluminum', 'foil', 'casing', 'polymer']
        
        # Noise words that indicate this is NOT a product description line
        noise_words = ['so no', 'po no', 'order', 'date', 'invoice', 'bill', 'gstin', 'total', 'tax', 'terms', 'bank', 'account', 'sign', 'authorized', 'ytcs', 'mihir']
        
        for i, line in enumerate(lines):
            line_lower = line.lower()
            has_keyword = any(kw in line_lower for kw in keywords)
            has_noise = any(noise in line_lower for noise in noise_words)
            
            # Skip noise lines or lines that are too short
            if has_noise or len(line) < 3:
                continue
                
            if has_keyword:
                hsn = None
                # Look for HSN on the same line or adjacent lines (up to 3 lines away)
                for offset in range(-3, 4):
                    idx = i + offset
                    if 0 <= idx < len(lines):
                        match = hsn_pattern.search(lines[idx])
                        if match:
                            hsn_candidate = match.group(1)
                            # Exclude date-like 8-digit numbers (e.g., 20240324, 20260324) and placeholder years
                            if (len(hsn_candidate) == 8 and hsn_candidate.startswith(('202', '201'))) or hsn_candidate in ['2026', '2025', '2024', '1234']:
                                continue
                            hsn = hsn_candidate
                            break
                
                # Clean up the extracted name
                clean_name = line
                if hsn and hsn in clean_name:
                    clean_name = clean_name.replace(hsn, '').strip(' -:,/\\')
                    
                # Ensure we don't add duplicates
                # First pass: Require HSN
                if clean_name and hsn and not any(item['name'].lower() == clean_name.lower() for item in line_items):
                    line_items.append({
                        "name": clean_name,
                        "hsn": hsn
                    })

        # Fallback: if absolutely nothing was found with the strict HSN rule, relax it to just keyword matches
        if not line_items:
            for i, line in enumerate(lines):
                line_lower = line.lower()
                has_keyword = any(kw in line_lower for kw in keywords)
                has_noise = any(noise in line_lower for noise in noise_words)
                
                if not has_noise and len(line) >= 4 and has_keyword:
                    if not any(item['name'].lower() == line.lower() for item in line_items):
                        line_items.append({
                            "name": line.strip(' -:,/\\'),
                            "hsn": None
                        })
                        
        return line_items

    def parse_scanned_document(self, file_path: str) -> Dict[str, Any]:
        """
        Uses PaddleOCR to extract text from a scanned PDF or Image.
        """
        extracted_data = {
            "invoice_number": None,
            "invoice_date": None,
            "supplier_gstin": None,
            "line_items": [],
            "raw_text_preview": ""
        }
        
        if not self.ocr:
            return {"error": "PaddleOCR not installed or initialized."}
            
        try:
            result = self.ocr.ocr(file_path, cls=True)
            full_text = ""
            if result:
                for idx in range(len(result)):
                    res = result[idx]
                    if res:
                        for line in res:
                            text = line[1][0]
                            full_text += text + "\n"
                            
            extracted_data["raw_text_preview"] = full_text[:500]
            
            # Extract Header Info using Regex on the OCR'd text
            # First, check for the specific Garuda Aerospace pattern
            ga_match = re.search(r"(?i)(GA[_/][A-Z0-9_\-/]+)", full_text)
            if ga_match:
                extracted_data["invoice_number"] = ga_match.group(1).strip()
            else:
                inv_match = self.invoice_no_pattern.search(full_text)
                if inv_match:
                    # Ignore common false positives like "Plot", "Date"
                    candidate = inv_match.group(1).strip()
                    if candidate.lower() not in ['plot', 'date', 'address']:
                        extracted_data["invoice_number"] = candidate
                
            date_match = self.date_pattern.search(full_text)
            if date_match:
                extracted_data["invoice_date"] = date_match.group(1).strip()
                
            gstin_matches = self.gstin_pattern.findall(full_text)
            if gstin_matches:
                extracted_data["supplier_gstin"] = gstin_matches[0]
                
            # Extract line items
            extracted_data["line_items"] = self.extract_line_items(full_text)
            return extracted_data
            
        except Exception as e:
            return {"error": str(e)}

    def parse_digital_pdf(self, file_path: str) -> Dict[str, Any]:
        """
        Parses a digital PDF to extract header info and line items.
        Returns a dictionary containing the extracted structured data.
        """
        extracted_data = {
            "invoice_number": None,
            "invoice_date": None,
            "supplier_gstin": None,
            "line_items": []
        }

        try:
            doc = fitz.open(file_path)
            full_text = ""
            
            # Extract text from all pages
            for page in doc:
                full_text += page.get_text("text") + "\n"
                
            # Extract Header Info using Regex
            inv_match = self.invoice_no_pattern.search(full_text)
            if inv_match:
                extracted_data["invoice_number"] = inv_match.group(1).strip()
                
            date_match = self.date_pattern.search(full_text)
            if date_match:
                extracted_data["invoice_date"] = date_match.group(1).strip()
                
            gstin_matches = self.gstin_pattern.findall(full_text)
            if gstin_matches:
                # Usually the first GSTIN is the supplier
                extracted_data["supplier_gstin"] = gstin_matches[0]

            # Extract line items
            extracted_data["line_items"] = self.extract_line_items(full_text)
            extracted_data["raw_text_preview"] = full_text[:500] 

            doc.close()
            return extracted_data

        except Exception as e:
            return {"error": str(e)}

if __name__ == "__main__":
    # Test block
    parser = InvoiceParser()
    print("Invoice Parser Initialized.")
