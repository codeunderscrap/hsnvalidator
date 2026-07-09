import pandas as pd
from rapidfuzz import process, fuzz
from sentence_transformers import SentenceTransformer, util
import torch

class HSNMatcher:
    def __init__(self):
        # Load a tiny, fast embedding model that runs well on CPU
        print("Loading semantic matching model...")
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        print("Semantic matching model loaded.")

    def match_product(self, extracted_name: str, master_df: pd.DataFrame, invoice_number: str, hsn_code: str = None) -> dict:
        """
        Matches an extracted product name against a Master DataFrame for a SPECIFIC Invoice Number.
        Uses Semantic Matching (AI) with a fallback to String Matching (RapidFuzz).
        """
        if master_df.empty:
            return {"match": None, "confidence": 0, "status": "No master data"}

        # Step 1: Filter by Invoice Number
        filtered_df = master_df
        if invoice_number and 'Invoice Number' in master_df.columns:
            # We convert both to strings and lowercase to be safe
            inv_matches = master_df[master_df['Invoice Number'].astype(str).str.lower() == str(invoice_number).lower()]
            if not inv_matches.empty:
                filtered_df = inv_matches
                
        master_names = filtered_df['Product Name'].dropna().tolist()
        if not master_names:
            return {"match": None, "confidence": 0, "status": "No valid products found", "hsn_filtered": False}

        # Step 2: Semantic Matching (AI)
        query_embedding = self.model.encode(extracted_name, convert_to_tensor=True)
        master_embeddings = self.model.encode(master_names, convert_to_tensor=True)
        
        cosine_scores = util.cos_sim(query_embedding, master_embeddings)[0]
        
        # Sort indices to find top matches for ambiguity check
        sorted_indices = torch.argsort(cosine_scores, descending=True)
        best_semantic_idx = sorted_indices[0].item()
        best_semantic_score = cosine_scores[best_semantic_idx].item() * 100
        best_semantic_match = master_names[best_semantic_idx]

        # Check for ambiguity (multiple products with very similar scores)
        ambiguous = False
        if len(sorted_indices) > 1:
            second_best_score = cosine_scores[sorted_indices[1].item()].item() * 100
            if (best_semantic_score - second_best_score) < 5 and best_semantic_score > 70:
                ambiguous = True

        # Step 3: Exact String Distance Matching (RapidFuzz)
        fuzz_result = process.extractOne(
            extracted_name, 
            master_names, 
            scorer=fuzz.token_sort_ratio
        )
        best_fuzz_match = fuzz_result[0]
        best_fuzz_score = fuzz_result[1]

        # Step 4: Decision Logic
        selected_match = best_semantic_match
        final_score = best_semantic_score
        method_used = "Semantic AI"
        
        matched_hsn = None
        if 'HSN' in filtered_df.columns:
            val = filtered_df[filtered_df['Product Name'] == selected_match]['HSN'].values[0]
            matched_hsn = "" if pd.isna(val) else str(val).strip()

        if best_fuzz_score > best_semantic_score and best_fuzz_score > 85:
            selected_match = best_fuzz_match
            final_score = best_fuzz_score
            method_used = "RapidFuzz (String)"
            if 'HSN' in filtered_df.columns:
                val = filtered_df[filtered_df['Product Name'] == selected_match]['HSN'].values[0]
                matched_hsn = "" if pd.isna(val) else str(val).strip()

        # Thresholding & Edge Cases
        status = "Valid"
        if hsn_code and matched_hsn and hsn_code != matched_hsn:
            status = "Review Suggested (HSN Mismatch)"
        elif final_score < 60:
            status = "Review Required (Low Confidence)"
        elif final_score < 85:
            status = "Review Suggested (Moderate Confidence)"
        elif ambiguous:
            status = "Review Suggested (Ambiguous Matches)"
            
        if not hsn_code:
            status += " - Missing HSN on Invoice"

        return {
            "extracted_name": extracted_name,
            "matched_product": selected_match,
            "confidence": round(final_score, 2),
            "method": method_used,
            "status": status,
            "hsn_filtered": False
        }

# For local testing if the script is run directly
if __name__ == "__main__":
    matcher = HSNMatcher()
    
    # Mock Master Data
    data = {
        'HSN': ['85491010', '85491010', '12345678'],
        'Product Name': ['Lithium Polymer Batteries', 'Battery Lithium Core', 'Generic Wire Setup'],
        'Rate': [100, 150, 10]
    }
    df = pd.DataFrame(data)

    test_item = "Lipo Power Cell 12V"
    print(f"\nTesting Extraction: '{test_item}'")
    result = matcher.match_product(test_item, df, invoice_number="INV-001", hsn_code="85491010")
    print(result)
