import sys

file_path = 'src/App.jsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add state variables
state_additions = '''
  const [sheetTabName, setSheetTabName]       = useState(() => localStorage.getItem('sheetTabName') || 'Sheet1');
  const [verifiedItems, setVerifiedItems]     = useState(new Set());
  const [masterFilterName, setMasterFilterName] = useState('All');
  
  useEffect(() => { localStorage.setItem('sheetTabName', sheetTabName); }, [sheetTabName]);
  useEffect(() => { setVerifiedItems(new Set()); }, [selectedInvoice]);
'''
content = content.replace(
    "const [webhookUrl, setWebhookUrl]           = useState(() => localStorage.getItem('webhookUrl') || '');",
    "const [webhookUrl, setWebhookUrl]           = useState(() => localStorage.getItem('webhookUrl') || '');" + state_additions
)

# 2. Update handleManualWriteBack body to include sheetTabName
content = content.replace(
    "body: JSON.stringify({ product_name: productName, hsn_code: hsnCode, invoice_number: invoiceNumber || \"\", webhook_url: webhookUrl })",
    "body: JSON.stringify({ product_name: productName, hsn_code: hsnCode, invoice_number: invoiceNumber || \"\", webhook_url: webhookUrl, sheet_tab_name: sheetTabName })"
)

# 3. Update handleBulkWriteBack body to include sheetTabName and verified validation
content = content.replace(
    "webhook_url: webhookUrl ",
    "webhook_url: webhookUrl, sheet_tab_name: sheetTabName "
)
content = content.replace(
    "item.ai_validation.matched_product !== 'No match found' &&",
    "item.ai_validation.matched_product !== 'No match found' && verifiedItems.has(item.extracted_name) &&"
)

# 4. Add Tab Name Config UI
tab_config_ui = '''
              <div className="bg-teal-900 shadow-sm border border-teal-800 rounded-xl p-4">
                <label className="text-[10px] uppercase tracking-widest text-teal-400/80 font-bold block mb-2">Target Sheet Tab Name</label>
                <input
                  type="text"
                  value={sheetTabName}
                  onChange={e => setSheetTabName(e.target.value)}
                  placeholder="e.g. Sheet3"
                  className="w-full text-xs bg-teal-950 border border-teal-700 focus:border-teal-500 rounded-lg px-3 py-2.5 text-teal-100 focus:outline-none"
                />
              </div>
'''
content = content.replace(
    "<div className=\"grid grid-cols-1 lg:grid-cols-2 gap-4\">",
    "<div className=\"grid grid-cols-1 lg:grid-cols-3 gap-4\">"
)
content = content.replace(
    "className=\"w-full text-xs bg-teal-950 border border-teal-700 focus:border-teal-500 rounded-lg px-3 py-2.5 text-teal-100 focus:outline-none\"\n                />\n              </div>\n            </div>",
    "className=\"w-full text-xs bg-teal-950 border border-teal-700 focus:border-teal-500 rounded-lg px-3 py-2.5 text-teal-100 focus:outline-none\"\n                />\n              </div>\n" + tab_config_ui + "\n            </div>"
)

# 5. Master Filter UI
filter_ui = '''
            <div className="flex space-x-4 max-w-2xl">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-teal-400/80" />
                <input
                  type="text"
                  placeholder="Search product name or HSN code…"
                  value={masterSearch}
                  onChange={e => setMasterSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-teal-900 shadow-sm border border-teal-800 focus:border-teal-500 focus:outline-none rounded-xl text-sm text-teal-100 placeholder-slate-500"
                />
              </div>
              <div className="relative w-64">
                <select
                  value={masterFilterName}
                  onChange={e => setMasterFilterName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-teal-900 shadow-sm border border-teal-800 focus:border-teal-500 focus:outline-none rounded-xl text-sm text-teal-100 appearance-none"
                >
                  <option value="All">All Products</option>
                  {Array.from(new Set(masterItems.map(i => i.name).filter(Boolean))).sort().map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
'''
content = content.replace(
    """            <div className="relative max-w-lg">\n              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-teal-400/80" />\n              <input\n                type="text"\n                placeholder="Search product name or HSN code…"\n                value={masterSearch}\n                onChange={e => setMasterSearch(e.target.value)}\n                className="w-full pl-10 pr-4 py-2.5 bg-teal-900 shadow-sm border border-teal-800 focus:border-teal-500 focus:outline-none rounded-xl text-sm text-teal-100 placeholder-slate-500"\n              />\n            </div>""",
    filter_ui
)

content = content.replace(
    "masterItems\n                      .filter(i => i.name?.toLowerCase().includes(masterSearch.toLowerCase()) || i.HSN?.includes(masterSearch))",
    "masterItems\n                      .filter(i => masterFilterName === 'All' || i.name === masterFilterName)\n                      .filter(i => i.name?.toLowerCase().includes(masterSearch.toLowerCase()) || i.HSN?.includes(masterSearch))"
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('App.jsx partially updated successfully.')
