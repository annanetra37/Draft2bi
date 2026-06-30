"use client";

import { useState } from "react";

const DOC_TYPES = [
  { key: "product_list", label: "Product / price list", hint: "Seeds the catalogue — do this first" },
  { key: "sales_sheet", label: "Sales sheet", hint: "A day's sales at one kiosk" },
  { key: "expense", label: "Expense / receipt", hint: "Costs that aren't materials" },
  { key: "stock_count", label: "Raw-material / stock count", hint: "On-hand counts" },
];

export default function CapturePage() {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<any[]>([]);

  async function post(body: any) {
    setBusy(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      setLog((l) => [{ at: new Date().toLocaleTimeString(), data }, ...l]);
    } finally {
      setBusy(false);
    }
  }

  function snapDemo(docType: string) {
    post({ demo: true, docType });
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>, docType: string) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const images = await Promise.all(
      files.map(
        (f) =>
          new Promise<{ dataUrl: string; docType: string }>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve({ dataUrl: String(r.result), docType });
            r.readAsDataURL(f);
          }),
      ),
    );
    post({ images });
    e.target.value = "";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Capture</h1>
        <p className="text-sm text-muted">
          Photograph or upload one or many pages. With no API key set, one-tap demo pages run the full pipeline using the
          built-in mock reader; set <code className="text-accent">ANTHROPIC_API_KEY</code> to read real photos with Claude vision.
        </p>
      </div>

      <div className="card border-accent/30 bg-accent/5 text-sm">
        <strong>Onboarding order matters.</strong> Snap the <em>product / price list</em> first — nothing downstream can resolve a
        scribbled sale until the catalogue exists. Then snap a sales sheet and watch the dashboard fill in.
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        {DOC_TYPES.map((d) => (
          <div key={d.key} className="card">
            <h2 className="font-medium">{d.label}</h2>
            <p className="mb-3 text-xs text-muted">{d.hint}</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy} onClick={() => snapDemo(d.key)}>
                ◎ Snap demo page
              </button>
              <label className="btn cursor-pointer">
                ⤓ Upload photo(s)
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e, d.key)} />
              </label>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">Pipeline log</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted">Nothing captured yet. Try “Snap demo page” on the product list.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {log.map((entry, i) => (
              <li key={i} className="rounded-lg border border-edge bg-panel2 p-3">
                <div className="mb-1 text-xs text-muted">{entry.at}</div>
                {entry.data.results?.map((r: any, j: number) => (
                  <div key={j} className="flex flex-wrap items-center gap-2">
                    {r.error ? (
                      <span className="pill bg-bad/20 text-bad">error: {r.error}</span>
                    ) : r.duplicate ? (
                      <span className="pill bg-warn/20 text-warn">duplicate page skipped ({r.docType})</span>
                    ) : (
                      <>
                        <span className="pill bg-accent/20 text-accent">{r.docType}</span>
                        <span>{r.rows} rows</span>
                        <span className="text-good">{r.autoApproved} auto-approved</span>
                        {r.pendingReviews > 0 ? (
                          <a className="pill bg-warn/20 text-warn" href="/review">{r.pendingReviews} need review →</a>
                        ) : (
                          <span className="pill bg-good/15 text-good">committed</span>
                        )}
                        {r.notes?.length > 0 && <span className="text-xs text-muted">· {r.notes.join(" · ")}</span>}
                      </>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
