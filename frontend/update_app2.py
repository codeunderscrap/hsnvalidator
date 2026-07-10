import sys

file_path = 'src/App.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add "Verified" header to the table
content = content.replace(
    '<th className="px-4 py-3">Extracted Name</th>',
    '<th className="px-4 py-3">Verified</th>\n                                  <th className="px-4 py-3">Extracted Name</th>'
)

# 2. Add checkbox cell
checkbox_ui = '''
                                      <td className="px-4 py-3">
                                        <input 
                                          type="checkbox" 
                                          checked={verifiedItems.has(item.extracted_name)}
                                          onChange={(e) => {
                                            const newSet = new Set(verifiedItems);
                                            if (e.target.checked) newSet.add(item.extracted_name);
                                            else newSet.delete(item.extracted_name);
                                            setVerifiedItems(newSet);
                                          }}
                                          className="w-4 h-4 text-teal-600 bg-teal-950 border-teal-700 rounded focus:ring-teal-500 focus:ring-2 cursor-pointer"
                                        />
                                      </td>
'''
content = content.replace(
    '<td className="px-4 py-3">\n                                        {isEditing ? (',
    checkbox_ui + '                                      <td className="px-4 py-3">\n                                        {isEditing ? ('
)

# 3. Disable the manual write back button if not verified
content = content.replace(
    'onClick={() => handleManualWriteBack(ai.matched_product, item.extracted_hsn, selectedInvoice.extracted_header.invoice_number)}',
    'onClick={() => { if (!verifiedItems.has(item.extracted_name)) { alert("Please check the Verified box for this row first."); return; } handleManualWriteBack(ai.matched_product, item.extracted_hsn, selectedInvoice.extracted_header.invoice_number); }}'
)

# 4. Make sure bulk write back button alerts if nothing is verified.
content = content.replace(
    'if (validItems.length === 0) {\\n      alert(\"No valid items with matched products and HSN codes to write back.\");\\n      return;\\n    }',
    'if (validItems.length === 0) {\\n      alert("No valid, VERIFIED items with matched products and HSN codes to write back. Did you forget to check the boxes?");\\n      return;\\n    }'
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('App.jsx table updated successfully.')
