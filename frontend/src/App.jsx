import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  LayoutDashboard, UploadCloud, Database, AlertCircle, CheckCircle2,
  RefreshCw, FileText, Plus, Search, ArrowRight, Edit2, Save,
  TrendingUp, Layers, ShieldCheck, Info, Clock, Cpu, Eye, X, Download
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────
const statusMeta = (status = '') => {
  if (status === 'Valid' || status.includes('Override')) return { color: 'text-teal-300', bg: 'bg-teal-800/40', dot: 'bg-teal-400' };
  if (status.includes('Low') || status.includes('Missing')) return { color: 'text-red-600', bg: 'bg-red-50', dot: 'bg-red-500' };
  return { color: 'text-yellow-600', bg: 'bg-yellow-50', dot: 'bg-yellow-500' };
};

const confBar = (score) => {
  if (score > 85) return 'bg-teal-800/400';
  if (score > 60) return 'bg-yellow-500';
  return 'bg-red-500';
};

// ── OCR Progress Steps ────────────────────────────────────────────────────────
const PROGRESS_STEPS = [
  { label: 'Uploading file to server…',        pct: 10 },
  { label: 'Detecting document type…',          pct: 20 },
  { label: 'Running OCR text extraction…',      pct: 45 },
  { label: 'Parsing invoice fields (regex)…',   pct: 60 },
  { label: 'Extracting line items…',            pct: 72 },
  { label: 'Running Semantic AI matching…',     pct: 88 },
  { label: 'Writing back HSN to Master Sheet…', pct: 95 },
];

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [activeTab, setActiveTab]             = useState('dashboard');
  const [invoices, setInvoices]               = useState([]); // Start completely empty! No rough data.
  const [masterItems, setMasterItems]         = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  // Upload state
  const [selectedFile, setSelectedFile]       = useState(null);
  const [isDragging, setIsDragging]           = useState(false);
  const [isUploading, setIsUploading]         = useState(false);
  const [uploadProgress, setUploadProgress]   = useState(0);
  const [progressLabel, setProgressLabel]     = useState('');
  const [uploadError, setUploadError]         = useState(null);
  const fileInputRef                          = useRef(null);
  
  // Master Sheet Upload State
  const [sheetUrl, setSheetUrl]               = useState(() => localStorage.getItem('sheetUrl') || 'https://docs.google.com/spreadsheets/d/10FKTvgZN2osKq2KsO26Ua0BGnndgC0cA/edit?usp=sharing');
  const [webhookUrl, setWebhookUrl]           = useState(() => localStorage.getItem('webhookUrl') || '');
  
  useEffect(() => { localStorage.setItem('sheetUrl', sheetUrl); }, [sheetUrl]);
  useEffect(() => { localStorage.setItem('webhookUrl', webhookUrl); }, [webhookUrl]);
  const [isSyncingMaster, setIsSyncingMaster] = useState(false);
  const [masterUploadError, setMasterUploadError] = useState(null);

  // Edit state
  const [isEditing, setIsEditing]             = useState(false);
  const [editedHeader, setEditedHeader]       = useState({});
  const [editedLineItems, setEditedLineItems] = useState([]);

  // Master state
  const [masterSearch, setMasterSearch]       = useState('');
  const [showAddModal, setShowAddModal]       = useState(false);
  const [newItem, setNewItem]                 = useState({ HSN: '', name: '', rate: '' });

  // Logs state
  const [systemLogs, setSystemLogs]           = useState([]);

  const addLog = useCallback((type, message) => {
    const timestamp = new Date().toLocaleTimeString();
    setSystemLogs(prev => [{ id: Date.now() + Math.random(), type, message, timestamp }, ...prev]);
  }, []);

  // ── Fetch Master Data ──────────────────────────────────────────────────────
  const loadMasterData = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/master-catalogue');
      if (res.ok) {
        const data = await res.json();
        // Standardize format for frontend
        const items = data.map(d => ({
          HSN: d.HSN || '',
          name: d['Product Name'] || d['Description'] || '',
          rate: d.Rate || ''
        }));
        setMasterItems(items);
      }
    } catch (e) {
      console.error("Failed to load master catalogue", e);
      addLog('error', `Failed to load master catalogue: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const validInvoices   = invoices.filter(inv => inv.line_items.every(i => i.ai_validation.status === 'Valid')).length;
  const pendingReviews  = invoices.filter(inv => inv.line_items.some(i => i.ai_validation.status.includes('Review'))).length;
  const avgConfidence   = invoices.length
    ? (invoices.reduce((acc, inv) => acc + (inv.line_items[0]?.ai_validation.confidence || 0), 0) / invoices.length).toFixed(1)
    : '0.0';

  // ── Progress ticker ────────────────────────────────────────────────────────
  const runProgressTicker = useCallback(() => {
    let stepIdx = 0;
    const advance = () => {
      if (stepIdx >= PROGRESS_STEPS.length) return;
      const step = PROGRESS_STEPS[stepIdx];
      setUploadProgress(step.pct);
      setProgressLabel(step.label);
      stepIdx++;
      const delay = stepIdx <= 2 ? 800 : stepIdx <= 4 ? 3500 : 6000;
      setTimeout(advance, delay);
    };
    advance();
  }, []);

  // ── File selection ─────────────────────────────────────────────────────────
  const handleFileChange = (file) => {
    if (!file) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(file.type)) {
      setUploadError('Only PDF, JPG, or PNG files are accepted.');
      return;
    }
    setSelectedFile(file);
    setUploadError(null);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFileChange(file);
  }, []);

  // ── Master Sheet Live Sync ──────────────────────────────────────────────────
  const handleSyncMaster = async () => {
    if (!sheetUrl) return;
    setIsSyncingMaster(true);
    setMasterUploadError(null);
    const formData = new FormData();
    formData.append('sheet_url', sheetUrl);
    
    try {
      const res = await fetch('/api/v1/sync-master', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Sync failed');
      await loadMasterData();
      alert(data.message);
    } catch (e) {
      setMasterUploadError(e.message);
    } finally {
      setIsSyncingMaster(false);
    }
  };

  // ── Upload Invoice ─────────────────────────────────────────────────────────
  const triggerUpload = async () => {
    if (!selectedFile || isUploading) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    setProgressLabel('Preparing upload…');

    runProgressTicker();

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600_000); // 10 min max

      const response = await fetch('/api/v1/upload-invoice', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      if (data.status === 'error') throw new Error(data.message || 'Processing failed');

      // Reload master data just in case HSN codes were written back to it
      loadMasterData();

      const lineItems = (data.line_items || []).map(item => ({
        extracted_name: item.extracted_name || item.name || 'Unknown item',
        extracted_hsn: item.extracted_hsn || item.hsn || null,
        ai_validation: item.ai_validation || {
          extracted_name: item.extracted_name || 'Unknown',
          matched_product: 'No match found',
          confidence: 0,
          method: 'N/A',
          status: 'Review Required (Low Confidence)',
          hsn_filtered: false,
        },
      }));

      const newInv = {
        id: Date.now(),
        filename: data.filename || selectedFile.name,
        status: 'success',
        processing_type: data.processing_type || 'Unknown',
        extracted_header: data.extracted_header || { invoice_number: null, invoice_date: null, supplier_gstin: null },
        line_items: lineItems,
        raw_text_preview: data.raw_text_preview || '',
      };

      setUploadProgress(100);
      setProgressLabel('Done! ✓');
      setInvoices(prev => [newInv, ...prev]);
      setSelectedInvoice(newInv);
      setSelectedFile(null);

      setTimeout(() => {
        setIsUploading(false);
        setActiveTab('upload');
      }, 800);

    } catch (err) {
      setIsUploading(false);
      setUploadProgress(0);
      if (err.name === 'AbortError') {
        setUploadError('Request timed out after 10 minutes. The PDF may be too large or have too many pages for CPU OCR. Try a smaller file.');
      } else {
        setUploadError(err.message || 'Upload failed.');
      }
    }
  };

  // ── Edit & Write-back handlers ─────────────────────────────────────────────
  const startEditing = (inv) => {
    setIsEditing(true);
    setEditedHeader({ ...inv.extracted_header });
    setEditedLineItems(inv.line_items.map(i => ({ ...i, ai_validation: { ...i.ai_validation } })));
  };

  const handleManualWriteBack = async (productName, hsnCode, invoiceNumber) => {
    if (!productName || !hsnCode || productName === 'No match found' || productName === '—') {
      alert("Please ensure you have matched a product and have a valid HSN code.");
      return;
    }
    
    if (!webhookUrl) {
      alert("Please configure your Google Apps Script Webhook URL in the Master Database tab first.");
      return;
    }
    
    try {
      const res = await fetch('/api/v1/manual-write-back', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: productName, hsn_code: hsnCode, invoice_number: invoiceNumber || "", webhook_url: webhookUrl })
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert(data.message);
        addLog('success', data.message);
        loadMasterData(); // Refresh the master data table
      } else {
        alert("Error: " + data.message);
        addLog('error', `Manual write error: ${data.message}`);
      }
    } catch (e) {
      alert("Failed to write to sheet: " + e.message);
      addLog('error', `Failed to write to sheet: ${e.message}`);
    }
  };

  const handleBulkWriteBack = async (invoice) => {
    if (!webhookUrl) {
      alert("Please configure your Google Apps Script Webhook URL in the Master Database tab first.");
      return;
    }
    
    // We only bulk write items that are valid/matched and have an HSN code
    const validItems = invoice.line_items.filter(item => 
      item.ai_validation && 
      item.ai_validation.matched_product && 
      item.ai_validation.matched_product !== '—' &&
      item.ai_validation.matched_product !== 'No match found' &&
      item.extracted_hsn
    );
    
    if (validItems.length === 0) {
      alert("No valid items with matched products and HSN codes to write back.");
      return;
    }
    
    setIsUploading(true);
    setProgressLabel(`Writing ${validItems.length} items to sheet...`);
    
    let successCount = 0;
    for (const item of validItems) {
      try {
        const res = await fetch('/api/v1/manual-write-back', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            product_name: item.ai_validation.matched_product, 
            hsn_code: item.extracted_hsn, 
            invoice_number: invoice.extracted_header.invoice_number || "", 
            webhook_url: webhookUrl 
          })
        });
        const data = await res.json();
        if (data.status === 'success') {
          successCount++;
          addLog('success', `Bulk item written: ${item.ai_validation.matched_product}`);
        } else {
          addLog('error', `Bulk write failed for ${item.ai_validation.matched_product}: ${data.message}`);
        }
      } catch (e) {
        console.error("Bulk write error:", e);
        addLog('error', `Bulk write exception for ${item.ai_validation.matched_product}: ${e.message}`);
      }
    }
    
    setIsUploading(false);
    alert(`Successfully wrote ${successCount}/${validItems.length} items to the Google Sheet!`);
    loadMasterData();
  };

  const saveEdits = (invoiceId) => {
    const updated = editedLineItems.map(item => ({
      ...item,
      ai_validation: { ...item.ai_validation, status: 'User Verified (Manual Override)', confidence: 100.0 },
    }));
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invoiceId) return inv;
      const u = { ...inv, extracted_header: editedHeader, line_items: updated };
      setSelectedInvoice(u);
      return u;
    }));
    setIsEditing(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-teal-950 text-teal-50 flex" style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}>

      {/* ── GLOBAL UPLOAD OVERLAY ─────────────────────────────────────── */}
      {isUploading && (
        <div className="fixed inset-0 z-50 bg-teal-900/90 backdrop-blur-md flex flex-col items-center justify-center">
          <div className="w-full max-w-md px-8 text-center space-y-6">
            <div className="relative mx-auto w-20 h-20">
              <div className="absolute inset-0 rounded-full border-4 border-teal-500/20 "></div>
              <div className="absolute inset-0 rounded-full border-4 border-teal-500/40 "></div>
              <div className="relative w-full h-full rounded-full bg-teal-800/40 border border-teal-700 flex items-center justify-center">
                <Cpu className="w-9 h-9 text-teal-300 " />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold text-teal-50">Processing Invoice</h2>
              <p className="text-sm text-teal-400/80 mt-1">Extracting data & reconciling with Master Sheet...</p>
            </div>

            <div className="space-y-2">
              <div className="w-full bg-teal-900 border border-teal-800 hover:bg-teal-950 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-teal-800/400 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-teal-400/80">
                <span>{progressLabel}</span>
                <span className="font-mono font-semibold text-teal-300">{uploadProgress}%</span>
              </div>
            </div>

            <div className="flex items-center justify-center space-x-2 text-xs text-teal-400/80">
              <Clock className="w-3.5 h-3.5" />
              <span>File: <strong className="text-teal-200">{selectedFile?.name}</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ───────────────────────────────────────────────────── */}
      <aside className="w-64 bg-teal-900 shadow-sm border-r border-teal-800 flex flex-col justify-between shrink-0">
        <div>
          <div className="px-5 py-6 border-b border-teal-800 flex flex-col items-center justify-center space-y-2 text-center bg-teal-950 border-b border-teal-800">
            <img src="/minimines.jpg" alt="MiniMines Logo" className="h-12 object-contain" />
            <span className="block text-[9px] text-teal-300 font-medium uppercase tracking-[0.2em] mt-1">HSN Reconciliation Engine</span>
          </div>

          <nav className="p-4 space-y-1">
            {[
              { id: 'dashboard', label: 'Overview Dashboard',    Icon: LayoutDashboard },
              { id: 'upload',    label: 'Invoice Upload & Scan', Icon: UploadCloud },
              { id: 'master',    label: 'Master HSN Directory',  Icon: Database },
              { id: 'logs',      label: 'System Logs',           Icon: FileText },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => { setActiveTab(id); if (id !== 'upload') setSelectedInvoice(null); }}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  activeTab === id
                    ? 'bg-teal-800/40 text-teal-300 border border-teal-600 shadow-inner'
                    : 'text-teal-400/80 hover:bg-teal-900/60 hover:text-teal-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {activeTab === id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-teal-400"></div>}
              </button>
            ))}
          </nav>

          {invoices.length > 0 && (
            <div className="px-4 mt-4">
              <p className="text-[10px] uppercase tracking-widest text-teal-400 font-bold px-2 mb-2">Recent Invoices</p>
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {invoices.slice(0, 8).map(inv => {
                  const meta = statusMeta(inv.line_items[0]?.ai_validation?.status);
                  return (
                    <button
                      key={inv.id}
                      onClick={() => { setSelectedInvoice(inv); setActiveTab('upload'); setIsEditing(false); }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center space-x-2 ${
                        selectedInvoice?.id === inv.id ? 'bg-teal-800/40 border border-teal-700' : 'hover:bg-teal-950'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`}></div>
                      <div className="truncate min-w-0">
                        <span className="text-xs font-semibold text-teal-100 block truncate">
                          {inv.extracted_header.invoice_number || inv.filename}
                        </span>
                        <span className="text-[10px] text-teal-400/80 block truncate">{inv.filename}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 m-3 bg-teal-900 shadow-sm border border-teal-800 rounded-xl text-xs">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-teal-800/400 "></div>
            <span className="font-semibold text-teal-200">Semantic AI Engine</span>
          </div>
          <p className="text-[10px] text-teal-400/80 mt-1">all-MiniLM-L6-v2 · CPU</p>
        </div>
      </aside>

      {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-8">

        {/* ══════════════════ TAB: DASHBOARD ══════════════════════════ */}
        {activeTab === 'dashboard' && (
          <div className="max-w-7xl mx-auto space-y-8">
            <div>
              <h1 className="text-3xl font-semibold text-teal-50 tracking-tight">Invoice Reconciliation Portal</h1>
              <p className="text-teal-400/80 text-sm mt-1">Upload an Excel Master Sheet, scan your invoices, and let AI automatically write the extracted HSN codes back to your sheet.</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                { label: 'Invoices Scanned',   value: invoices.length,  color: 'text-indigo-400',  icon: <FileText className="w-5 h-5" />,   bg: 'bg-indigo-500/10' },
                { label: 'Auto-Reconciled',    value: validInvoices,    color: 'text-teal-300',    icon: <ShieldCheck className="w-5 h-5" />, bg: 'bg-teal-800/40' },
                { label: 'Needs Review',       value: pendingReviews,   color: 'text-yellow-600',  icon: <AlertCircle className="w-5 h-5" />, bg: 'bg-yellow-50' },
                { label: 'Avg AI Confidence',  value: `${avgConfidence}%`, color: 'text-teal-50', icon: <TrendingUp className="w-5 h-5" />, bg: 'bg-teal-9500/10' },
              ].map(({ label, value, color, icon, bg }) => (
                <div key={label} className="bg-teal-900 shadow-sm border border-teal-800 rounded-2xl p-5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-teal-400/80 font-bold block">{label}</span>
                    <span className={`text-3xl font-semibold mt-1 block ${color}`}>{value}</span>
                  </div>
                  <div className={`p-3 rounded-xl ${bg} ${color}`}>{icon}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div
                onClick={() => setActiveTab('master')}
                className="cursor-pointer bg-teal-900 border border-teal-800 shadow-sm border border-teal-800 rounded-2xl p-6 flex items-center justify-between hover:border-teal-700 transition-all group"
              >
                <div>
                  <h3 className="font-bold text-teal-100 text-lg group-hover:text-teal-300 transition">1. Setup Live Google Sheet</h3>
                  <p className="text-sm text-teal-400/80 mt-1">Provide your public Google Sheet link and Webhook URL so the AI can read and write directly to the cloud.</p>
                </div>
                <div className="p-4 bg-teal-900 border border-teal-800 hover:bg-teal-950/50 rounded-xl group-hover:bg-teal-800/40 transition">
                  <Database className="w-6 h-6 text-teal-400/80 group-hover:text-teal-300" />
                </div>
              </div>

              <div
                onClick={() => setActiveTab('upload')}
                className="cursor-pointer bg-teal-900 border border-teal-800 shadow-sm border border-teal-800 rounded-2xl p-6 flex items-center justify-between hover:border-teal-700 transition-all group"
              >
                <div>
                  <h3 className="font-bold text-teal-100 text-lg group-hover:text-teal-300 transition">2. Upload & Scan Invoice</h3>
                  <p className="text-sm text-teal-400/80 mt-1">Upload a PDF or Image. The AI extracts line items and reconciles them with your Master Sheet.</p>
                </div>
                <div className="p-4 bg-teal-900 border border-teal-800 hover:bg-teal-950/50 rounded-xl group-hover:bg-teal-800/40 transition">
                  <UploadCloud className="w-6 h-6 text-teal-400/80 group-hover:text-teal-300" />
                </div>
              </div>
            </div>

            {invoices.length > 0 ? (
              <div className="bg-teal-900 border border-teal-800 shadow-sm border border-teal-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-teal-800 flex justify-between items-center">
                  <h3 className="font-bold text-teal-50">Global Validation Queue</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-teal-900 shadow-sm border-b border-teal-800">
                      <tr className="text-[10px] uppercase tracking-widest text-teal-400/80">
                        <th className="px-6 py-3">Extracted Name</th>
                        <th className="px-6 py-3">HSN</th>
                        <th className="px-6 py-3">AI Match</th>
                        <th className="px-6 py-3">Confidence</th>
                        <th className="px-6 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-teal-800">
                      {invoices.map(inv => {
                        return inv.line_items.map((item, idx) => {
                          const ai = item.ai_validation || {};
                          const meta = statusMeta(ai.status);
                          return (
                            <tr key={`${inv.id}-${idx}`} className="hover:bg-teal-950 transition-colors">
                              <td className="px-6 py-4 font-semibold text-teal-100 text-sm">{item.extracted_name}</td>
                              <td className="px-6 py-4 font-mono font-bold text-teal-300 text-xs">{item.extracted_hsn || '—'}</td>
                              <td className="px-6 py-4 text-xs text-teal-200 font-semibold">{ai.matched_product || '—'}</td>
                              <td className="px-6 py-4">
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono text-xs text-teal-200">{ai.confidence ?? '—'}%</span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${meta.color} ${meta.bg}`}>
                                  <div className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></div>
                                  <span>{ai.status || '—'}</span>
                                </span>
                              </td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-teal-800 rounded-2xl p-12 text-center text-teal-400/80">
                <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No invoices processed yet. Start by uploading a master sheet or an invoice above.</p>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB: UPLOAD ══════════════════════════════ */}
        {activeTab === 'upload' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <div>
              <h2 className="text-3xl font-semibold text-teal-50 tracking-tight">Invoice Upload & Scan</h2>
              <p className="text-teal-400/80 text-sm mt-1">AI strictly extracts valid line items and auto-writes HSN codes back to your Master Sheet.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-5">
                <div className="bg-teal-950 border-b border-teal-800 border border-teal-800 rounded-2xl p-5">
                  <h3 className="text-sm font-bold text-teal-100 mb-4">Upload File</h3>
                  <div
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
                      isDragging ? 'border-teal-400 bg-teal-800/40' : 'border-teal-700 hover:border-teal-600/60 hover:bg-teal-900 border border-teal-800 hover:bg-teal-950/30'
                    }`}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => handleFileChange(e.target.files[0])} className="hidden" />
                    <UploadCloud className={`w-10 h-10 mb-3 ${isDragging ? 'text-teal-300' : 'text-teal-400'}`} />
                    <p className="text-sm font-semibold text-teal-200 text-center">{selectedFile ? selectedFile.name : 'Drag & drop or click to select'}</p>
                  </div>

                  {selectedFile && (
                    <button
                      onClick={triggerUpload}
                      disabled={isUploading}
                      className="w-full mt-4 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-slate-950 font-bold text-sm rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg shadow-sm"
                    >
                      <Cpu className="w-4 h-4" />
                      <span>Start OCR + Reconciliation</span>
                    </button>
                  )}
                  {uploadError && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-500/25 rounded-xl flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-300 leading-relaxed">{uploadError}</p>
                    </div>
                  )}
                </div>

                <div className="bg-teal-950 border-b border-teal-800 border border-teal-800 rounded-2xl p-5">
                  <h3 className="text-sm font-bold text-teal-100 mb-3">Session Queue ({invoices.length})</h3>
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {invoices.map(inv => {
                      const meta = statusMeta(inv.line_items[0]?.ai_validation?.status);
                      return (
                        <button
                          key={inv.id}
                          onClick={() => { setSelectedInvoice(inv); setIsEditing(false); }}
                          className={`w-full text-left px-3 py-3 rounded-xl border transition-all flex items-center space-x-3 ${
                            selectedInvoice?.id === inv.id ? 'bg-teal-800/40 border-teal-600/40' : 'bg-teal-900 border border-teal-800 shadow-sm border-teal-800 hover:bg-teal-900 border border-teal-800 hover:bg-teal-950/30'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`}></div>
                          <div className="truncate min-w-0 flex-1">
                            <span className="text-xs font-semibold text-teal-100 block truncate">{inv.extracted_header.invoice_number || 'No number'}</span>
                            <span className="text-[10px] text-teal-400/80 block truncate">{inv.filename}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2">
                {selectedInvoice ? (
                  <div className="bg-teal-950 border-b border-teal-800 border border-teal-800 rounded-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-teal-800 flex items-center justify-between bg-teal-900 shadow-sm">
                      <div>
                        <h3 className="font-bold text-teal-50">Inspection Panel</h3>
                        <p className="text-[11px] text-teal-400/80 mt-0.5">{selectedInvoice.processing_type} · {selectedInvoice.filename}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdits(selectedInvoice.id)} className="bg-teal-600 hover:bg-teal-800/400 text-slate-950 px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5">
                              <Save className="w-3.5 h-3.5" /><span>Save</span>
                            </button>
                            <button onClick={() => setIsEditing(false)} className="bg-teal-900 border border-teal-800 hover:bg-teal-950 hover:bg-teal-900/60 text-teal-200 px-4 py-1.5 rounded-lg text-xs font-bold transition">Cancel</button>
                          </>
                        ) : (
                          <button onClick={() => startEditing(selectedInvoice)} className="bg-teal-900 border border-teal-800 hover:bg-teal-950 hover:bg-teal-900/60 text-teal-200 px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5">
                            <Edit2 className="w-3.5 h-3.5" /><span>Override / Edit</span>
                          </button>
                        )}
                        <button onClick={() => handleBulkWriteBack(selectedInvoice)} className="bg-teal-900/60 hover:bg-teal-800 text-teal-300 px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 border border-teal-700/50 ml-2">
                          <Database className="w-3.5 h-3.5" /><span>Sync All to Sheet</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-6 space-y-6">
                      <div className="grid grid-cols-3 gap-4">
                        {[
                          { label: 'Invoice Number', field: 'invoice_number', mono: false },
                          { label: 'Invoice Date',   field: 'invoice_date',   mono: false },
                          { label: 'Supplier GSTIN', field: 'supplier_gstin', mono: true  },
                        ].map(({ label, field, mono }) => (
                          <div key={field} className="bg-teal-900 shadow-sm border border-teal-800 rounded-xl p-4">
                            <label className="text-[10px] uppercase tracking-widest text-teal-400/80 font-bold block mb-1">{label}</label>
                            {isEditing ? (
                              <input type="text" value={editedHeader[field] || ''} onChange={e => setEditedHeader({ ...editedHeader, [field]: e.target.value })} className="w-full text-xs font-semibold bg-teal-950 border border-teal-700 focus:border-teal-500 focus:outline-none rounded-lg px-2 py-1 text-teal-100" />
                            ) : (
                              <span className={`text-sm font-bold text-teal-50 ${mono ? 'font-mono text-teal-300' : ''}`}>
                                {selectedInvoice.extracted_header[field] || <span className="text-teal-400 italic font-normal text-xs">Not detected</span>}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-widest text-teal-400/80 mb-3">
                          Extracted & Validated Line Items ({selectedInvoice.line_items.length})
                        </h4>
                        {selectedInvoice.line_items.length === 0 ? (
                          <div className="border border-teal-800 rounded-xl p-8 text-center">
                            <AlertCircle className="w-8 h-8 text-teal-400 mx-auto mb-2" />
                            <p className="text-sm text-teal-400/80">No line items were extracted by the strict heuristics. If OCR missed a product, you can use Override/Edit to add it manually.</p>
                          </div>
                        ) : (
                          <div className="border border-teal-800 rounded-xl overflow-hidden">
                            <table className="w-full text-sm text-left">
                              <thead className="bg-teal-900/60 border-b border-teal-800">
                                <tr className="text-[10px] uppercase tracking-widest text-teal-400/80">
                                  <th className="px-4 py-3">Extracted Name</th>
                                  <th className="px-4 py-3">HSN</th>
                                  <th className="px-4 py-3">AI Match</th>
                                  <th className="px-4 py-3">Confidence</th>
                                  <th className="px-4 py-3">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-teal-800/30">
                                {(isEditing ? editedLineItems : selectedInvoice.line_items).map((item, idx) => {
                                  const ai   = item.ai_validation;
                                  const meta = statusMeta(ai.status);
                                  return (
                                    <tr key={idx} className="bg-teal-900/20 hover:bg-teal-950 transition-colors">
                                      <td className="px-4 py-3">
                                        {isEditing ? (
                                          <input type="text" value={item.extracted_name} onChange={e => { const c = [...editedLineItems]; c[idx] = { ...c[idx], extracted_name: e.target.value }; setEditedLineItems(c); }} className="w-full text-xs bg-teal-950 border border-teal-700 focus:border-teal-500 rounded px-2 py-1 text-teal-100 focus:outline-none" />
                                        ) : (
                                          <span className="text-xs font-semibold text-teal-100">{item.extracted_name}</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        {isEditing ? (
                                          <input type="text" value={item.extracted_hsn || ''} onChange={e => { const c = [...editedLineItems]; c[idx] = { ...c[idx], extracted_hsn: e.target.value }; setEditedLineItems(c); }} className="w-24 text-xs font-mono bg-teal-950 border border-teal-700 focus:border-teal-500 rounded px-2 py-1 text-teal-100 focus:outline-none" />
                                        ) : (
                                          <span className="text-xs font-mono text-teal-300 font-bold">{item.extracted_hsn || <span className="text-red-600/70">MISSING</span>}</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        {isEditing ? (
                                          <div className="flex flex-col space-y-2">
                                            <select value={ai.matched_product} onChange={e => { const c = [...editedLineItems]; c[idx] = { ...c[idx], ai_validation: { ...c[idx].ai_validation, matched_product: e.target.value } }; setEditedLineItems(c); }} className="w-full text-xs bg-teal-950 border border-teal-700 focus:border-teal-500 rounded px-2 py-1 text-teal-100 focus:outline-none">
                                              <option value="—">Select Master Product</option>
                                              {masterItems.map((mi, mi_idx) => (<option key={mi_idx} value={mi.name}>{mi.name}</option>))}
                                            </select>
                                            <button 
                                              onClick={() => handleManualWriteBack(ai.matched_product, item.extracted_hsn, selectedInvoice.extracted_header.invoice_number)}
                                              className="bg-teal-900/50 hover:bg-teal-800 text-teal-300 border border-teal-700/50 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide flex items-center justify-center space-x-1"
                                            >
                                              <Database className="w-3 h-3" />
                                              <span>Add to Sheet</span>
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="text-xs font-semibold text-teal-200">{ai.matched_product || '—'}</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex items-center space-x-2">
                                          <span className="font-mono text-xs font-bold text-teal-200">{ai.confidence ?? '—'}%</span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className={`inline-flex items-center space-x-1.5 px-2 py-1 rounded-full text-[10px] font-bold ${meta.color} ${meta.bg}`}>
                                          <div className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></div>
                                          <span>{ai.status}</span>
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-teal-900 border border-teal-800 shadow-sm border border-teal-800 rounded-2xl h-full flex flex-col items-center justify-center p-12 text-center min-h-[400px]">
                    <div className="w-20 h-20 rounded-2xl bg-teal-900/60 border border-teal-700/40 flex items-center justify-center mb-5">
                      <FileText className="w-10 h-10 text-teal-400" />
                    </div>
                    <h3 className="text-lg font-bold text-teal-200">No Invoice Selected</h3>
                    <p className="text-sm text-teal-400/80 mt-2 max-w-sm">Upload a new invoice file using the panel on the left, or click any invoice from the queue to inspect its results.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ TAB: MASTER ══════════════════════════════ */}
        {activeTab === 'master' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-3xl font-semibold text-teal-50 tracking-tight">Live Google Sheet Config</h2>
                <p className="text-teal-400/80 text-sm mt-1">Configure your public spreadsheet link for reading, and your Webhook URL for writing.</p>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleSyncMaster}
                  disabled={isSyncingMaster}
                  className="bg-teal-600 hover:bg-teal-800/400 text-slate-950 px-4 py-2.5 rounded-xl text-sm font-bold transition flex items-center space-x-2 shadow-lg shadow-sm"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncingMaster ? 'animate-spin' : ''}`} />
                  <span>{isSyncingMaster ? 'Syncing...' : 'Sync Live Sheet'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-teal-900 shadow-sm border border-teal-800 rounded-xl p-4">
                <label className="text-[10px] uppercase tracking-widest text-teal-400/80 font-bold block mb-2">Public Google Sheet URL (For Reading)</label>
                <input
                  type="text"
                  value={sheetUrl}
                  onChange={e => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  className="w-full text-xs bg-teal-950 border border-teal-700 focus:border-teal-500 rounded-lg px-3 py-2.5 text-teal-100 focus:outline-none"
                />
              </div>
              <div className="bg-teal-900 shadow-sm border border-teal-800 rounded-xl p-4">
                <label className="text-[10px] uppercase tracking-widest text-teal-400/80 font-bold block mb-2">Google Apps Script Webhook URL (For Writing)</label>
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full text-xs bg-teal-950 border border-teal-700 focus:border-teal-500 rounded-lg px-3 py-2.5 text-teal-100 focus:outline-none"
                />
              </div>
            </div>

            {masterUploadError && (
              <div className="p-4 bg-red-50 border border-red-500/25 rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                <p className="text-sm text-red-300 font-medium">{masterUploadError}</p>
              </div>
            )}

            <div className="relative max-w-lg">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-teal-400/80" />
              <input
                type="text"
                placeholder="Search product name or HSN code…"
                value={masterSearch}
                onChange={e => setMasterSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-teal-900 shadow-sm border border-teal-800 focus:border-teal-500 focus:outline-none rounded-xl text-sm text-teal-100 placeholder-slate-500"
              />
            </div>

            <div className="bg-teal-900 border border-teal-800 shadow-sm border border-teal-800 rounded-2xl overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-teal-900/60 border-b border-teal-800">
                  <tr className="text-[10px] uppercase tracking-widest text-teal-400/80">
                    <th className="px-6 py-3">Product Reference Name</th>
                    <th className="px-6 py-3">HSN Code</th>
                    <th className="px-6 py-3">Base Rate (₹/kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-teal-800">
                  {masterItems.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="px-6 py-12 text-center text-teal-400/80 italic">No master data loaded. Upload an Excel or CSV file above.</td>
                    </tr>
                  ) : (
                    masterItems
                      .filter(i => i.name?.toLowerCase().includes(masterSearch.toLowerCase()) || i.HSN?.includes(masterSearch))
                      .map((item, idx) => (
                        <tr key={idx} className="hover:bg-teal-950 transition-colors">
                          <td className="px-6 py-4 font-semibold text-teal-100 text-sm">{item.name}</td>
                          <td className="px-6 py-4 font-mono font-bold text-teal-300 text-sm">
                            {item.HSN ? item.HSN : <span className="text-teal-400 text-xs italic font-normal">Pending AI Match</span>}
                          </td>
                          <td className="px-6 py-4 font-mono text-teal-200 text-sm">{item.rate ? `₹${item.rate}` : '—'}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'logs' && (
          <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-semibold text-teal-50 tracking-tight flex items-center">
                  System Logs
                </h1>
                <p className="text-teal-400/80 mt-2">Real-time system events, errors, and webhook responses.</p>
              </div>
              <button onClick={() => setSystemLogs([])} className="bg-teal-900 border border-teal-800 hover:bg-teal-950 hover:bg-teal-900/60 text-teal-200 px-4 py-2 rounded-lg text-sm font-bold transition">
                Clear Logs
              </button>
            </div>

            <div className="bg-teal-900 shadow-sm border border-teal-800 rounded-2xl overflow-hidden font-mono text-sm">
              {systemLogs.length === 0 ? (
                <div className="p-12 text-center text-teal-400/80 italic">No logs recorded yet.</div>
              ) : (
                <div className="divide-y divide-teal-800 max-h-[600px] overflow-y-auto">
                  {systemLogs.map(log => (
                    <div key={log.id} className="p-4 flex gap-4 hover:bg-teal-950 transition-colors items-start">
                      <span className="text-teal-400/80 shrink-0">{log.timestamp}</span>
                      <span className={`shrink-0 uppercase font-bold text-[10px] px-2 py-0.5 rounded w-16 text-center mt-0.5 ${log.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-teal-800/40 text-teal-300'}`}>
                        {log.type}
                      </span>
                      <span className="text-teal-200 break-all">{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
